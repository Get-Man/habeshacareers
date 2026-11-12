// TEMP: LOCAL harvest of the three Vercel-egress-blocked origins (403 from serverless IPs,
// fine from this machine) + one etcareers tail pass. Writes through the exact production
// sync path in lib/jobs/sync.mjs -> repository (same upsert/progress/expiry logic).
// Loads .env.local itself; never logs secret values; progress-only output.
import fs from "node:fs";

function loadEnvFile(fp) {
  const out = {};
  for (const line of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnvFile(".env.local");
for (const [k, v] of Object.entries(env)) {
  if (v.includes("[SENSITIVE]")) continue; // keep placeholder out of the runtime env
  process.env[k] = v;
}
const candidates = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL_UNPOOLED"];
const dbUrl = candidates.map((n) => process.env[n]).find((v) => v && !v.includes("[SENSITIVE]"));
if (!dbUrl) { console.log("FATAL: no real DB connection string in .env.local (placeholders present). Fill it and rerun."); process.exit(1); }
console.log("env loaded (values not shown); db connection present");

const { syncSourceBySlug } = await import("../lib/jobs/sync.mjs");

const SLUGS = [
  { slug: "ethiopian-reporter", maxBatches: 320 },
  { slug: "alljobspo", maxBatches: 185 },
  { slug: "ethiojobs-net-et", maxBatches: 170 },
  { slug: "etcareers", maxBatches: 10 },
];
const GAP_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);

async function runSource({ slug, maxBatches }) {
  const acc = { batches: 0, fetched: 0, new: 0, updated: 0, dup: 0, err: 0 };
  let errors = 0;
  let notAdv = 0;
  let lastNext = null;
  for (let i = 1; i <= maxBatches; i++) {
    let r;
    try {
      r = await syncSourceBySlug(slug, "manual");
    } catch (e) {
      console.log(`[${slug} ${i}] LOCAL exception: ${String(e.message || e).slice(0, 160)}`);
      if (++errors >= 6) break;
      await sleep(5000);
      continue;
    }
    acc.batches++;
    const f = r.fetched_count ?? 0, nn = r.new_count ?? 0, u = r.updated_count ?? 0, d = r.duplicate_count ?? 0, er = r.error_count ?? 0;
    acc.fetched += f; acc.new += nn; acc.updated += u; acc.dup += d; acc.err += er;
    const p = r.progress || {};
    const bad = r.ok === false || r.skipped;
    console.log(
      `[${ts()} ${slug} ${i}] ok=${!bad} fetched=${f} new=${nn} upd=${u} dup=${d} err=${er} next=${p.nextOffset ?? "?"} done=${p.done ?? "?"} total=${p.totalFound ?? "?"}` +
      (bad && r.error ? ` msg=${String(r.error).slice(0, 140)}` : "") +
      (r.skipped ? ` skipped(${r.reason})` : "")
    );
    errors = bad ? errors + 1 : 0;
    if (errors >= 6) { console.error(`[${slug}] repeated errors - stopping`); break; }
    if (!bad && f > 0) {
      if (p.nextOffset === lastNext) { if (++notAdv >= 3) { console.error(`[${slug}] not advancing - stopping`); break; } }
      else { notAdv = 0; lastNext = p.nextOffset ?? null; }
    }
    if (p.done === true) { console.log(`[${slug}] catalog pass complete.`); break; }
    await sleep(GAP_MS);
  }
  console.log(`[${slug}] DONE ${JSON.stringify(acc)}`);
  return acc;
}

try {
  const results = await Promise.all(SLUGS.map((s) => runSource(s).catch((e) => ({ error: String(e.message || e) }))));
  try {
    const t = await (await fetch("https://habeshacareers.vercel.app/api/jobs?limit=1")).json();
    console.log(`\nAPI total: ${t.total}`);
  } catch {}
  console.log("\n== SUMMARY ==\n" + JSON.stringify(results, null, 2));
} catch (e) {
  console.error("FATAL:", String(e.message || e));
}
