// TEMP: full-catalog backfill via admin API using the throwaway SYNC_TOKEN (gitignored .env.tmp-token).
// Runs the three sources in parallel, resumable batches (offset persists in DB). Prints non-sensitive progress only.
import fs from "node:fs";
import path from "node:path";

const BASE = "https://habeshacareers.vercel.app";
const TOKEN_FILE = path.resolve(".env.tmp-token");
const SLUGS = [
  { slug: "geezjobs", maxBatches: 420 },
  { slug: "ethiojobs", maxBatches: 120 },
  { slug: "workethiopia", maxBatches: 60 },
];
const GAP_MS = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function syncOnce(slug, token) {
  const res = await fetch(`${BASE}/api/admin/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": token },
    body: JSON.stringify({ slug }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
  return { status: res.status, json };
}

async function runSource({ slug, maxBatches }, token) {
  const acc = { batches: 0, fetched: 0, new: 0, updated: 0, dup: 0, err: 0 };
  let errors = 0;
  let lastNext = null;
  let stale = 0;
  for (let i = 1; i <= maxBatches; i++) {
    let out;
    try { out = await syncOnce(slug, token); }
    catch (e) { console.log(`[${slug} ${i}] request error: ${String(e.message || e)}`); if (++errors >= 6) break; await sleep(4000); continue; }
    if (out.status === 401 || out.json?.error === "unauthorized") { console.error(`[${slug}] unauthorized - stopping token loop`); process.exit(1); }
    const r = out.json?.result || out.json || {};
    const p = r.progress || r?.details?.progress || {};
    acc.batches++;
    const f = r.fetched_count ?? 0, nn = r.new_count ?? 0, u = r.updated_count ?? 0, d = r.duplicate_count ?? 0, er = r.error_count ?? 0;
    acc.fetched += f; acc.new += nn; acc.updated += u; acc.dup += d; acc.err += er;
    console.log(`[${slug} ${i}] ok=${out.json?.ok===true && r?.ok!==false && out.status<500} fetched=${f} new=${nn} upd=${u} dup=${d} err=${er} next=${p.nextOffset ?? "?"} done=${p.done ?? "?"} total=${p.totalFound ?? "?"}`);
    const okRun = out.json?.ok === true && r?.ok !== false && out.status < 500;
    errors = okRun ? 0 : errors + 1;
    if (errors >= 6) { console.error(`[${slug}] repeated errors - stopping`); break; }
    if (okRun && f > 0) { if (p.nextOffset === lastNext) { if (++stale >= 3) { console.error(`[${slug}] not advancing - stopping`); break; } } else { stale = 0; lastNext = p.nextOffset ?? null; } }
    if (p.done === true) { console.log(`[${slug}] catalog pass complete.`); break; }
    await sleep(GAP_MS);
  }
  console.log(`[${slug}] DONE ${JSON.stringify(acc)}`);
  return acc;
}

try {
  const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  if (!token) throw new Error("token file empty");
  const results = await Promise.all(SLUGS.map((s) => runSource(s, token).catch((e) => ({ error: String(e.message || e) }))));
  try {
    const t = await (await fetch(`${BASE}/api/jobs?limit=1`)).json();
    console.log(`\nAPI total: ${t.total}`);
  } catch {}
  console.log("\n== SUMMARY ==\n" + JSON.stringify(results, null, 2));
} catch (e) {
  console.error("FATAL:", String(e.message || e));
} finally {
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  console.log("token file deleted");
}
