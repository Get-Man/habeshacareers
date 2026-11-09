// TEMP probe: calibrate Ethiopian Reporter valid-page template. Delete after use.
const UA = { "User-Agent": "HabeshaCareers/1.0 (public vacancy aggregation; parser calibration)", Accept: "text/html,application/xml" };
async function fetchText(url, accept, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ctrl.signal });
    return { status: r.status, text: await r.text() };
  } finally { clearTimeout(t); }
}
let sitemapUrl = "https://www.ethiopianreporterjobs.com/job-sitemap1.xml";
const idx = await fetchText("https://www.ethiopianreporterjobs.com/sitemap_index.xml").catch(() => null);
if (idx && idx.ok === undefined) {}
const sm = await fetchText(sitemapUrl).catch(() => ({ status: 0, text: "" }));
const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
console.log("sitemap:", sitemapUrl, "locs:", locs.length, "first:", locs[0]);
let html = "", pageUrl = "";
for (const testUrl of locs.slice(0, 4)) {
  const r = await fetchText(testUrl).catch(() => ({ status: 0, text: "" }));
  console.log(`try ${testUrl} -> ${r.status} len=${r.text.length} expired=${/jobexpire/i.test(r.text)}`);
  if (r.status === 200 && r.text.length > 60000 && !/jobexpire/i.test(r.text)) { html = r.text; pageUrl = testUrl; break; }
}
if (!html) { console.log("no valid page"); process.exit(0); }
console.log("PAGE:", pageUrl);
function around(needle, back = 180, fwd = 520) {
  const i = html.indexOf(needle);
  return i < 0 ? `${needle}: NOTFOUND` : html.slice(Math.max(0, i - back), i + fwd).replace(/\s+/g, " ");
}
for (const n of ["Posted Date", "Job ID", "Career Level", "Industry", "How to", "Duties", "Requirements"]) {
  console.log(`\n== ${n} ==\n` + around(n));
}
const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n").replace(/\n{2,}/g, "\n").replace(/^\s+$/gm, "").trim();
const pd = text.indexOf("Posted Date");
console.log("\n== text around Posted Date ==\n" + text.slice(Math.max(0, pd - 400), pd + 700));
