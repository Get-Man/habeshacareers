// Probe public source pages and save small HTML samples for adapter development.
// Only public pages, one request per source, respectful UA. No DB writes.
import fs from "node:fs";
import path from "node:path";

const UA = "HabeshaCareers/1.0 (public vacancy aggregation; respectful; adapter development)";
const outDir = path.join(process.cwd(), "scripts", "fixtures");
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ["ethiojobs-sitemap", "https://ethiojobs.net/sitemap-jobs.xml"],
  ["workethiopia-sitemap", "https://workethiopia.net/sitemap.xml"],
  ["geezjobs-home", "https://geezjobs.com/"],
  ["ethiojobs-net-et-home", "https://www.ethiojobs.net/"],
  ["etcareers-home", "https://etcareers.com/"],
  ["alljobspo-home", "https://alljobspo.com/"],
  ["ethiopianreporter-jobs", "https://www.ethiopianreporter.com/jobs"],
  ["careersun-home", "https://careersun.com/"],
  ["unjobs-ethiopia", "https://unjobs.org/duty_stations/ethiopia"],
  ["reliefweb-api", "https://api.reliefweb.int/v1/jobs?appname=habeshacareers&filter[field]=country&filter[value]=Ethiopia&limit=2&profile=list"],
  ["live-home", "https://habeshacareers.vercel.app/"],
  ["live-api", "https://habeshacareers.vercel.app/api/jobs?limit=2&brief=1"],
  ["live-job", "https://habeshacareers.vercel.app/job-details.html?id=1"],
];

for (const [name, url] of targets) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml,application/json" }, redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    const text = await res.text();
    const ext = /json/.test(res.headers.get("content-type") || "") ? "json" : /xml/.test(res.headers.get("content-type") || "") ? "xml" : "html";
    fs.writeFileSync(path.join(outDir, `${name}.${ext}`), text.slice(0, 500000));
    console.log(`${name}: ${res.status} ${text.length}b ${Date.now() - started}ms -> ${name}.${ext}`);
  } catch (e) {
    console.log(`${name}: ERROR ${String(e.message || e).slice(0, 160)}`);
  }
}
