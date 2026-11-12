// Local diagnostic: inspect database shape and catalog counts.
// Loads .env.local (Vercel CLI) without printing secret values.
import fs from "node:fs";

function loadEnvLocal() {
  for (const file of [".env.local", ".env.production.local"]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (value.includes("[SENSITIVE]")) continue;
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}
loadEnvLocal();

const { hasDatabase, query } = await import("../lib/db.mjs");
if (!hasDatabase()) {
  console.log("no database url");
  process.exit(1);
}

const applied = await query("select name from _migrations order by name").catch(() => []);
console.log("migrations:", applied.map((r) => r.name).join(", ") || "(none)");

const cols = await query(`select column_name, data_type from information_schema.columns where table_name='job_listings' order by ordinal_position`);
console.log("\njob_listings columns:");
for (const c of cols) console.log(` - ${c.column_name} (${c.data_type})`);

const counts = await query(`select status, count(*)::int n from job_listings group by status order by n desc`);
console.log("\nstatus counts:", JSON.stringify(counts));

const bySource = await query(`
  select coalesce(s.slug,'(direct)') slug, count(*)::int n,
         count(*) filter (where l.status='active')::int active
  from job_listings l left join job_sources s on s.id=l.primary_source_id
  group by 1 order by n desc`);
console.log("\nby source:", JSON.stringify(bySource));

const sources = await query(`select slug, name, enabled, integration_status, listing_url from job_sources order by enabled desc, slug`);
console.log("\nsources:");
for (const s of sources) console.log(` - ${s.slug} | enabled=${s.enabled} | ${s.integration_status} | ${s.listing_url}`);

const samples = await query(`
  select l.id, l.title, l.company, l.original_url, s.slug source_slug, l.status, l.deadline
  from job_listings l left join job_sources s on s.id=l.primary_source_id
  order by l.id desc limit 8`);
console.log("\nlatest rows:");
for (const r of samples) console.log(JSON.stringify(r));

process.exit(0);
