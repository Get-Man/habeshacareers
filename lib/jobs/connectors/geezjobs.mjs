// GeezJobs connector (public, respectful).
// robots.txt (User-agent: *) allows /job-detail/*, /rss, /sitemap-detail; disallows search/filter query pages.
// Uses public RSS feed and/or public sitemap-detail + public job detail pages.
// Extracts structured JobPosting JSON-LD from public detail pages. No login/CAPTCHA/bypass.

import { cleanText, toDate } from "../utils.mjs";

export const slug = "geezjobs";
const BASE = "https://geezjobs.com";
const UA = "HabeshaCareers/1.0 (+https://habeshacareers.vercel.app; public vacancy aggregation; respectful)";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchText(url, timeoutMs = 12000, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8") {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`GeezJobs HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function decodeXml(s = "") {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRss(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const get = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
      return r ? decodeXml(r[1]) : null;
    };
    const link = get("link");
    const title = get("title");
    if (!link || !title) continue;
    let abs;
    try { abs = new URL(link, BASE).toString(); } catch { continue; }
    if (!/\/job-detail\//i.test(abs)) continue;
    items.push({ title, original_url: abs, description: get("description"), posted_date: toDate(get("pubDate")), external_id: abs });
  }
  return items;
}

function parseSitemapLocs(xml) {
  const urls = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    let u;
    try { u = new URL(decodeXml(m[1]), BASE).toString(); } catch { continue; }
    if (/\/job-detail\//i.test(u)) urls.push(u);
  }
  return Array.from(new Set(urls));
}

function htmlToText(html = "") {
  return cleanText(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h\d|section|article|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " "), 50000);
}

function normalizeEmploymentType(v) {
  const s = String(Array.isArray(v) ? v[0] : v || "").toUpperCase();
  if (!s) return null;
  if (s.includes("FULL")) return "Full Time";
  if (s.includes("PART")) return "Part Time";
  if (s.includes("CONTRACT")) return "Contract";
  if (s.includes("TEMP")) return "Temporary";
  if (s.includes("INTERN")) return "Internship";
  return cleanText(String(Array.isArray(v) ? v[0] : v), 80);
}

function parseJobPosting(html, pageUrl) {
  const scripts = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of scripts) {
    let obj;
    try { obj = JSON.parse(m[1].trim()); } catch { continue; }
    const items = Array.isArray(obj) ? obj : (Array.isArray(obj?.["@graph"]) ? obj["@graph"] : [obj]);
    for (const it of items) {
      const types = [].concat(it?.["@type"] || []).map((t) => String(t));
      if (!types.includes("JobPosting")) continue;
      const org = it.hiringOrganization || {};
      const locs = [].concat(it.jobLocation || []).map((jl) => jl?.address || jl).filter(Boolean);
      const location = locs.map((a) => [a?.addressLocality || a?.addressRegion || a?.streetAddress, a?.addressCountry?.name || a?.addressCountry].filter(Boolean).join(", ")).filter(Boolean).join(" | ")
        || cleanText(it.jobLocationType, 120) || null;
      const logoRaw = org.logo;
      const logo = typeof logoRaw === "string" ? logoRaw : (logoRaw?.url || logoRaw?.contentUrl || null);
      let logoAbs = null;
      try { logoAbs = logo ? new URL(String(logo), pageUrl).toString() : null; } catch {}
      return {
        external_id: String(it.identifier?.value || it.identifier || pageUrl),
        title: cleanText(it.title, 250),
        company: cleanText(org.name || org.legalName, 200),
        logo: logoAbs,
        location: cleanText(location, 200),
        job_type: normalizeEmploymentType(it.employmentType),
        posted_date: toDate(it.datePosted),
        deadline: toDate(it.validThrough),
        description: cleanText(it.description, 50000) ? htmlToText(it.description) : null,
        requirements: cleanText(it.qualifications || it.experienceRequirements || it.educationRequirements, 30000)
          ? htmlToText([it.qualifications, it.experienceRequirements, it.educationRequirements].filter(Boolean).join("\n"))
          : null,
        application_instructions: cleanText(it.applicationInstructions || it.directApply, 5000),
        original_url: pageUrl,
        category: null,
        raw_source: "geezjobs-jsonld",
      };
    }
  }
  // Fallback: basic meta/title parsing (best effort, public page)
  const title = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1], 250);
  const og = (prop) => {
    const r = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i").exec(html)
      || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i").exec(html);
    return r ? cleanText(r[1], 5000) : null;
  };
  return title ? {
    external_id: pageUrl,
    title: title.replace(/\s*[|\-–]\s*GeezJobs.*$/i, "").trim(),
    company: null,
    logo: og("og:image"),
    location: null,
    job_type: null,
    posted_date: null,
    deadline: null,
    description: og("og:description") || og("description"),
    requirements: null,
    application_instructions: "Apply via the official/original vacancy page.",
    original_url: pageUrl,
    category: null,
    raw_source: "geezjobs-meta",
  } : null;
}

export async function fetchJobs(source) {
  const cfg = source?.fetch_config || {};
  // Serverless-safe defaults: small batches + respectful delay to stay within Hobby timeouts.
  const limit = Math.max(1, Math.min(20, parseInt(cfg.limit || "8", 10) || 8));
  const offset = Math.max(0, parseInt(cfg.offset || "0", 10) || 0);
  const delayMs = Math.max(200, Math.min(2500, parseInt(cfg.delayMs || "500", 10) || 500));
  const listingMode = String(cfg.listingMode || "rss").toLowerCase(); // rss | sitemap
  const feedUrl = String(cfg.feedUrl || `${BASE}/rss`);
  const sitemapUrl = String(cfg.sitemapUrl || `${BASE}/sitemap-detail`);

  let candidates = [];
  let totalFound = null;
  let nextOffset = null;
  let done = false;

  if (listingMode === "sitemap") {
    const xml = await fetchText(sitemapUrl, 15000, "application/xml,text/xml,*/*");
    const locs = parseSitemapLocs(xml);
    totalFound = locs.length;
    candidates = locs.slice(offset, offset + limit).map((url) => ({ original_url: url, external_id: url }));
    const consumed = offset + candidates.length;
    done = consumed >= locs.length || candidates.length === 0;
    nextOffset = done ? 0 : consumed;
  } else {
    const xml = await fetchText(feedUrl, 15000, "application/rss+xml,application/xml,text/xml,*/*");
    candidates = parseRss(xml).slice(0, limit);
    totalFound = candidates.length;
    done = true; // RSS is recent-only; use sitemap mode for backfill
    nextOffset = 0;
  }

  // Staggered-parallel fetch: honors spacing between request starts (never above ~3 concurrent bursts)
  // while staying well under serverless time caps. Public job-detail pages only (robots allows).
  const out = [];
  const seen = new Set();
  const batchAt = Date.now();
  let next = 0;
  let errors = 0;
  const jobsRaw = new Array(candidates.length).fill(null);
  const poolCount = Math.max(1, Math.min(6, candidates.length));
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= candidates.length) return;
      const c = candidates[idx];
      const url = c.original_url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const at = batchAt + idx * delayMs;
      const now = Date.now();
      if (at > now) await sleep(at - now);
      try {
        const html = await fetchText(url, 12000);
        const job = parseJobPosting(html, url);
        if (job?.title) {
          jobsRaw[idx] = {
            external_id: job.external_id || url,
            title: job.title,
            company: job.company || cleanText(c.company, 200) || "Employer on GeezJobs (see source)",
            logo: job.logo || null,
            location: job.location || "Ethiopia",
            job_type: job.job_type || null,
            posted_date: job.posted_date || c.posted_date || null,
            deadline: job.deadline || null,
            description: job.description || c.description || "Open the official/original vacancy page for full details.",
            requirements: job.requirements || null,
            application_instructions: job.application_instructions || "Apply via the official/original vacancy page linked from GeezJobs.",
            original_url: url,
            category: job.category || null,
            raw_source: job.raw_source || "geezjobs",
          };
        }
      } catch (e) {
        errors++;
        jobsRaw._errors = jobsRaw._errors || [];
        jobsRaw._errors.push({ url, error: String(e?.message || e).slice(0, 180) });
      }
    }
  };
  await Promise.all(Array.from({ length: poolCount }, worker));
  for (const j of jobsRaw) if (j) out.push(j);
  if (out.length === 0 && errors >= candidates.length && candidates.length > 0) throw errors; // nothing usable in whole batch
  // Attach progress for sync.mjs to persist (non-breaking: extra property on Array).
  try {
    out.progress = { offset, limit, totalFound, nextOffset, done, listingMode, fetched: candidates.length, ok: out.length, errors };
  } catch {}
  return out;
}

export default { slug, fetchJobs };
