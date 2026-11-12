// Ethiojobs connector (public, respectful).
// Uses public sitemap + public job pages only (no /api/*; /api is disallowed in robots.txt).
// Extracts structured data embedded in __NEXT_DATA__ on public job pages.
// robots.txt: allows / and publishes sitemap-jobs.xml; disallows /api/*, /auth/*, /users/*.

import { cleanText, toDate } from "../utils.mjs";

export const slug = "ethiojobs";
const BASE = "https://ethiojobs.net";
const UA = "HabeshaCareers/1.0 (+https://habeshacareers.vercel.app; public vacancy aggregation; respectful; no /api)";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ethiojobs HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

function htmlToPlain(html) {
  if (!html) return null;
  return cleanText(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>(?=\s*<)/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h\d|section|article|tr|td)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " "), 60000);
}

function extractNextData(html) {
  const m = String(html).match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function joinLoc(...parts) {
  const v = parts.map(p => cleanText(p, 120)).filter(Boolean);
  return v.length ? [...new Set(v)].join(", ") : null;
}

function mapJob(d, pageUrl) {
  if (!d || !d.title) return null;
  const company = (d.company && typeof d.company === "object") ? (d.company.name || d.company.name_legal || d.company.company_name) : (d.company || d.company_name || d.employer_name || d.organization_name);
  const companySite = d.company && typeof d.company === "object" ? (d.company.website || d.company.url) : null;
  const location = joinLoc(d.city, d.state, d.region, d.country, d.location) || cleanText(d.address, 200);
  const descHtml = [d.description, d.responsibility, d.responsibilities].filter(Boolean).join("\n");
  const reqHtml = [d.requirement, d.requirements, d.qualification, d.qualifications].filter(Boolean).join("\n");
  const applyHtml = [d.how_to_apply, d.application_instructions].filter(Boolean).join("\n");
  const description = htmlToPlain(descHtml);
  const requirements = htmlToPlain(reqHtml);
  const application = htmlToPlain(applyHtml);
  const email = cleanText(d.application_email || d.email, 200);
  const external = cleanText(d.career_page_link || d.external_url || d.apply_url || d.url, 500);
  // Prefer explicit external application/career link; else use Ethiojobs page as source (apply via source)
  const originalUrl = (/^https?:/i.test(external || "") && !/ethiojobs\.net/i.test(external)) ? external : pageUrl;
  const type = Array.isArray(d.type_name) ? d.type_name.filter(Boolean).join(", ") : cleanText(d.type_name || d.job_type || d.employment_type, 120);
  const cat = Array.isArray(d.catalog_names) ? d.catalog_names.filter(Boolean)[0] : (Array.isArray(d.category_name) ? d.category_name[0] : cleanText(d.catalog_names || d.category_name || d.category, 120));
  const deadline = toDate(d.date_expiry || d.deadline || d.closing_date || d.expiry_date);
  const posted = toDate(d.date_published || d.posted_date || d.created_at);
  return {
    external_id: String(d.slug || d.id || pageUrl),
    title: cleanText(d.title, 300),
    company: cleanText(company, 200) || null,
    logo: null, // resolved via fallbacks; Ethiojobs logo paths are not reliably public-resolvable here
    location: location || "Ethiopia",
    region_city: location || "Ethiopia",
    original_url: originalUrl,
    posted_date: posted,
    deadline,
    description: description || `${cleanText(d.title, 300)}${company ? ` — ${cleanText(company, 200)}` : ""}. See the official source page for full vacancy details.`,
    requirements,
    application_instructions: application || (email ? `Apply via the official source. Contact: ${email}` : "Apply via the official source page."),
    contact_email: email || null,
    job_type: type || null,
    category: cat || null,
    raw_source: "ethiojobs-next-data",
    source_page: pageUrl,
    company_website: companySite || null,
  };
}

export async function fetchJobs(source) {
  const cfg = source?.fetch_config || {};
  // Serverless-safe batched sitemap backfill (public pages only; no /api).
  const limit = Math.max(1, Math.min(20, parseInt(cfg.limit || "8", 10) || 8));
  const offset = Math.max(0, parseInt(cfg.offset || "0", 10) || 0);
  const delayMs = Math.max(200, Math.min(3000, parseInt(cfg.delayMs || "450", 10) || 450));
  const sitemapUrl = String(cfg.sitemapUrl || `${BASE}/sitemap-jobs.xml`);

  const xml = await fetchText(sitemapUrl, 15000);
  const locs = [...String(xml).matchAll(/<loc>\s*(https:\/\/ethiojobs\.net\/job\/[^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
  const all = [...new Set(locs)];
  const urls = all.slice(offset, offset + limit);
  const consumed = offset + urls.length;
  const done = consumed >= all.length || urls.length === 0;
  const nextOffset = done ? 0 : consumed;

  // Staggered-parallel fetch (public job pages only; respects spacing between request starts).
  const jobsRaw = new Array(urls.length).fill(null);
  const batchAt = Date.now();
  let next = 0;
  let errors = 0;
  const poolCount = Math.max(1, Math.min(6, urls.length));
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= urls.length) return;
      const url = urls[idx];
      const at = batchAt + idx * delayMs;
      const now = Date.now();
      if (at > now) await sleep(at - now);
      try {
        const html = await fetchText(url, 12000);
        const nextData = extractNextData(html);
        const data = nextData?.props?.pageProps?.data || nextData?.props?.pageProps?.job || null;
        if (data) {
          const job = mapJob(data, url);
          if (job && job.title) jobsRaw[idx] = job;
        }
      } catch (e) {
        errors++;
        if (!jobsRaw._errors) jobsRaw._errors = [];
        jobsRaw._errors.push({ url, error: String(e?.message || e).slice(0, 180) });
      }
    }
  };
  await Promise.all(Array.from({ length: poolCount }, worker));
  const jobs = [];
  for (const j of jobsRaw) if (j) jobs.push(j);
  if (jobs.length === 0 && errors >= urls.length && urls.length > 0) throw errors;
  try {
    jobs.progress = { offset, limit, totalFound: all.length, nextOffset, done, listingMode: "sitemap", fetched: urls.length, ok: jobs.length, errors };
  } catch {}
  return jobs;
}

export default { slug, fetchJobs };
