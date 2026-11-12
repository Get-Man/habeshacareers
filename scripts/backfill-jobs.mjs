#!/usr/bin/env node
/**
 * Repeatedly triggers admin sync for batched, compliant backfill (public sitemaps/pages only).
 * Requires rotated ADMIN_API_KEY in env - do NOT hardcode secrets.
 *
 * Usage (PowerShell):
 *   $env:ADMIN_API_KEY="...rotated..."; $env:BASE_URL="https://habeshacareers.vercel.app"; node scripts/backfill-jobs.mjs geezjobs ethiojobs
 *
 * Stops when a source reports progress.done=true (after a full catalog pass) or on repeated errors.
 * Respects delays between batches. Upserts/dedup make runs idempotent.
 */
const base = (process.env.BASE_URL || "https://habeshacareers.vercel.app").replace(/\/$/, "");
const adminKey = process.env.ADMIN_API_KEY;
const slugs = process.argv.slice(2).filter(Boolean);
if (!adminKey) { console.error("Set ADMIN_API_KEY (rotated). Never commit or share it."); process.exit(1); }
if (!slugs.length) { console.error("Usage: node scripts/backfill-jobs.mjs <slug> [slug...]"); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function syncOnce(slug) {
  const res = await fetch(`${base}/api/admin/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
    body: JSON.stringify({ slug }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

for (const slug of slugs) {
  console.log(`\n== Backfill ${slug} ==`);
  let errors = 0;
  for (let i = 1; i <= 80; i++) { // safety cap
    const { status, json } = await syncOnce(slug);
    const r = json?.result || json || {};
    const p = r.progress || r?.details?.progress;
    const ok = json?.ok && r?.ok !== false && status < 500;
    console.log(`[${slug} batch ${i}] http=${status} ok=${json?.ok} fetched=${r.fetched_count ?? "?"} new=${r.new_count ?? "?"} updated=${r.updated_count ?? "?"} dup=${r.duplicate_count ?? "?"} err=${r.error_count ?? "?"} offset=${p?.nextOffset ?? p?.offset ?? "?"} done=${p?.done ?? "?"} totalFound=${p?.totalFound ?? "?"}`);
    if (json?.error === "unauthorized") { console.error("Unauthorized - rotate/check ADMIN_API_KEY."); process.exit(1); }
    if (!ok) errors++; else errors = 0;
    if (errors >= 5) { console.error(`Stopping ${slug}: repeated errors.`); break; }
    if (p?.done === true && (r.fetched_count ?? 0) === 0) { console.log(`${slug}: catalog pass complete.`); break; }
    if (p?.done === true) { console.log(`${slug}: reached end of catalog; will cycle on future runs (idempotent).`); break; }
    await sleep(2500); // respectful gap between admin-triggered batches
  }
}
console.log("\nDone. Check total: GET /api/jobs?limit=1");
