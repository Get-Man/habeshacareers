// Ethiopian Reporter Jobs (ethiopianreporterjobs.com) connector (public, respectful).
// robots.txt: standard WordPress (Yoast) rules — /jobs/<id>/ pages and job-sitemaps allowed.
// Uses public sitemap_index.xml -> job-sitemapN.xml urlsets + public /jobs/<id>/ pages.
// Note: their origin intermittently returns Cloudflare 520; per-page errors are tolerated and
// repeated cron/manual syncs fill gaps (offset only advances after a successful batch).

import { cleanText, toDate } from "../utils.mjs";

export const slug = "ethiopian-reporter";
const BASE = "https://www.ethiopianreporterjobs.com";
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
    if (!res.ok) throw new Error(`ReporterJobs HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchIndexWithRetry() {
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try { return await fetchText(`${BASE}/sitemap_index.xml`, 15000, "application/xml,text/xml,*/*"); }
    catch (e) { lastErr = e; await sleep(900); }
  }
  throw lastErr;
}

function parseSitemapLocs(xml) {
  const urls = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    let u;
    try { u = new URL(m[1], BASE).toString(); } catch { continue; }
    if (/\/jobs\/\d+\/?$/i.test(u)) urls.push(u.replace(/\/$/, "/"));
  }
  return Array.from(new Set(urls));
}

function htmlToText(html = "") {
  return cleanText(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h\d|section|article|tr|td|table)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " "), 60000);
}

function firstEmail(text) {
  const m = String(text || "").match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  if (!m) return null;
  const e = m[0].replace(/[.,;)\]]+$/, "");
  if (/(sentry|\.png|\.jpg|example\.com|email-protection|ethiopianreporterjobs\.com$)/i.test(e)) return null;
  return cleanText(e, 200);
}

const DATE_RE = "[A-Za-z]+ \\d{1,2},? \\d{4}";

function parseDetail(html, pageUrl) {
  const raw = String(html);
  if (!raw || raw.length < 5000) return null;
  // Expired/removed postings render an "unavailable" notice page (HTTP 200) — skip.
  if (/jobexpire-notifyerr|no longer available/i.test(raw.slice(0, 300000))) return null;
  if (!/(Posted Date|Job ID)/i.test(raw)) return null;

  const og = (prop) => {
    const r = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i").exec(raw)
      || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i").exec(raw);
    return r ? cleanText(r[1], 5000) : null;
  };
  let title = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(raw) || [])[1], 250) || og("og:title") || "";
  title = String(title || "").replace(/\s*[|\-–]\s*Ethiopian\s*Reporter\s*Jobs.*$/i, "").trim();
  if (!title || /^(404|error|page not found)/i.test(title)) return null;

  const company = cleanText((raw.match(/<h2[^>]*>@\s*([^<]{1,90})<\/h2>/i) || [])[1], 200) || null;

  const metaVal = (label) => {
    const m = raw.match(new RegExp(`<strong>\\s*${label}\\s*</strong>\\s*<span[^>]*>([^<]+)<\\/span>`, "i"));
    return m ? cleanText(m[1], 200) : null;
  };
  const smallVal = (label) => {
    const m = raw.match(new RegExp(`<span[^>]*>\\s*${label}\\s*(?:&nbsp;)*</span>\\s*<small[^>]*>([\\s\\S]*?)</small>`, "i"));
    return m ? cleanText(m[1], 300) : null;
  };

  const posted = toDate(metaVal("Posted\\ Date"));
  const closed = toDate(metaVal("Closed\\ Date|Deadline"));
  let location = cleanText(metaVal("Location") || "", 200);
  if (location) location = location.replace(/\s*,\s*Ethiopia\s*$/i, "").replace(/\s+ET\s*$/i, "").trim() || null;

  const jobId = (raw.match(/Job ID\s*<small[^>]*>(\d+)<\/small>/i) || [])[1]
    || (pageUrl.match(/\/jobs\/(\d+)/) || [])[1]
    || pageUrl;
  const salary = smallVal("Monthly Salary") || smallVal("Salary");
  const qualifications = smallVal("Qualifications");

  // Description block: starts at the "Job Description" heading, ends before the after-description ad wrapper.
  let descRaw = "";
  const dStart = raw.search(/Job Description/i);
  if (dStart >= 0) {
    const dEnd = raw.slice(dStart).search(/jobsearch-det-adver-wrap/i);
    descRaw = raw.slice(dStart, dEnd >= 0 ? dStart + dEnd : Math.min(raw.length, dStart + 60000));
  }
  // Split the requirements sub-section out of the description when present.
  let reqRaw = null;
  const rq = descRaw.match(/<p[^>]*>\s*<strong[^>]*>\s*(?:Requirements|Required Qualifications|Qualifications)[^<]{0,60}<\/strong>\s*<\/p>\s*(?:<ul[\s\S]*?<\/ul>|<ol[\s\S]*?<\/ol>|[\s\S]*?<\/p>)/i);
  if (rq) {
    reqRaw = htmlToText(rq[0]);
    descRaw = descRaw.replace(rq[0], " ");
  }
  let description = descRaw ? htmlToText(descRaw).replace(/^\s*Job Description\s*:?\s*\n?/i, "").trim() : null;
  if (description) description = description.replace(/^[\s•]+|[\s•]+$/g, "").trim();

  const jobType = (raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, "\n").match(/^\s*(Full[- ]?time|Part[- ]?time|Contract|Temporary|Internship|Freelance)\s*$/im) || [])[1] || null;
  const email = firstEmail(description || descRaw ? (description || htmlToText(descRaw)) : "");
  const applyText = email
    ? `Apply via the official posting page. Contact/email given in the posting: ${email}`
    : "Apply via the official/original vacancy page on Ethiopian Reporter Jobs.";

  return {
    external_id: jobId,
    title,
    company,
    logo: null,
    location: location || "Ethiopia",
    job_type: jobType,
    posted_date: posted,
    deadline: closed,
    description: description || "Open the official/original vacancy page for full details.",
    requirements: reqRaw,
    education: qualifications,
    salary,
    application_instructions: applyText,
    contact_email: email,
    original_url: pageUrl,
    source_page: pageUrl,
    category: null,
    raw_source: "reporterjobs-careerfy",
  };
}

export async function fetchJobs(source) {
  const cfg = source?.fetch_config || {};
  const limit = Math.max(1, Math.min(12, parseInt(cfg.limit || "8", 10) || 8));
  const offset = Math.max(0, parseInt(cfg.offset || "0", 10) || 0);
  const delayMs = Math.max(250, Math.min(2500, parseInt(cfg.delayMs || "400", 10) || 400));
  const indexUrl = String(cfg.sitemapUrl || `${BASE}/sitemap_index.xml`);

  const index = await fetchIndexWithRetry();
  const jobSitemaps = [...String(index).matchAll(/<loc>\s*([^<]*job-sitemap\d+\.xml)\s*<\/loc>/gi)].map((m) => new URL(m[1], BASE).toString());
  if (!jobSitemaps.length) throw new Error("No job-sitemapN.xml in index");

  // Collect all job URLs (cheap XML fetches, small stagger). Sitemaps are tiny (~100 KB max).
  const all = [];
  const batchAt = Date.now();
  let eIdx = 0;
  const xmlWalker = async () => {
    for (;;) {
      const i = eIdx++;
      if (i >= jobSitemaps.length) return;
      const at = batchAt + i * Math.max(200, Math.min(600, delayMs));
      const now = Date.now();
      if (at > now) await sleep(at - now);
      try {
        const xml = await fetchText(jobSitemaps[i], 15000, "application/xml,text/xml,*/*");
        for (const u of parseSitemapLocs(xml)) all.push(u);
      } catch { /* tolerate per-file origin errors */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobSitemaps.length) }, () => xmlWalker()));
  if (!all.length) throw new Error("All job sitemaps failed (origin may be returning 520). Will retry on next run.");

  const urls = all.slice(offset, offset + limit);
  const consumed = offset + urls.length;
  const done = consumed >= all.length || urls.length === 0;
  const nextOffset = done ? 0 : consumed;

  const out = [];
  const seen = new Set();
  let next = 0;
  let errors = 0;
  const jobsRaw = new Array(urls.length).fill(null);
  const poolCount = Math.max(1, Math.min(6, urls.length));
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= urls.length) return;
      const url = urls[idx];
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const at = batchAt + idx * delayMs;
      const now = Date.now();
      if (at > now) await sleep(at - now);
      try {
        const html = await fetchText(url, 12000);
        const job = parseDetail(html, url);
        if (job?.title) jobsRaw[idx] = job;
      } catch (e) {
        errors++;
      }
    }
  };
  await Promise.all(Array.from({ length: poolCount }, worker));
  for (const j of jobsRaw) if (j) out.push(j);
  if (out.length === 0 && errors >= urls.length && urls.length > 0) throw errors;
  try {
    out.progress = { offset, limit, totalFound: all.length, nextOffset, done, listingMode: "sitemap", sitemaps: jobSitemaps.length, fetched: urls.length, ok: out.length, errors };
  } catch {}
  return out;
}

export default { slug, fetchJobs };
