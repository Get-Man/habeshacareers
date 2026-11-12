// ethio-jobs.net.et connector (public, respectful).
// robots.txt (User-agent: *): Content-Signal search=yes, use=reference; Allow: /
// (only AI-training crawlers disallowed). We are a search/reference aggregator, not a trainer.
// Uses the public sitemap-jobs.xml urlset + public vacancy-detail pages (JobPosting JSON-LD).
// The site's own Organization JSON-LD (platform logo) is never used as an employer logo.

import { cleanText, toDate } from "../utils.mjs";

export const slug = "ethiojobs-net-et";
const BASE = "https://ethio-jobs.net.et";
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
    if (!res.ok) throw new Error(`EthioJobsET HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function decodeXml(s = "") {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSitemapLocs(xml) {
  const urls = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    let u;
    try { u = new URL(decodeXml(m[1]), BASE).toString(); } catch { continue; }
    if (/vacancy-detail\.php\?id=\d+$/i.test(u)) urls.push(u);
  }
  return Array.from(new Set(urls));
}

function htmlToText(html = "") {
  // JSON-LD values here are HTML-entity escaped (&lt;p&gt;) — decode BEFORE stripping tags.
  const pre = String(html)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return cleanText(pre
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h\d|section|article|tr|td)>/gi, "\n")
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
  return cleanText(Array.isArray(v) ? v[0] : v, 80);
}

function firstEmail(text) {
  const m = String(text || "").match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  if (!m) return null;
  const e = m[0].replace(/[.,;)\]]+$/, "");
  // ignore obvious asset/example noise
  if (/(sentry|\.png|\.jpg|example\.com|email-protection)/i.test(e)) return null;
  return cleanText(e, 200);
}

function parseJobPosting(html, pageUrl) {
  const scripts = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of scripts) {
    let obj;
    try { obj = JSON.parse(m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "").trim()); } catch { continue; }
    const items = Array.isArray(obj) ? obj : (Array.isArray(obj?.["@graph"]) ? obj["@graph"] : [obj]);
    for (const it of items) {
      const types = [].concat(it?.["@type"] || []).map(String);
      if (!types.includes("JobPosting")) continue;
      const org = it.hiringOrganization || {};
      const locs = [].concat(it.jobLocation || []).map((jl) => jl?.address || jl).filter(Boolean);
      const location = locs
        .map((a) => [a?.addressLocality || a?.addressRegion || a?.streetAddress, a?.addressCountry?.name || a?.addressCountry].filter(Boolean).join(", "))
        .filter(Boolean).join(" | ")
        || cleanText(it.jobLocationType, 120) || null;
      let logoRaw = org.logo;
      let logo = typeof logoRaw === "string" ? logoRaw : (logoRaw?.url || logoRaw?.contentUrl || null);
      // Drop platform/owner logos pointing at the aggregator's own domain (org logos must be exact)
      if (logo && (new URL(logo, pageUrl)).hostname.includes("ethio-jobs.net.et")) logo = null;
      let logoAbs = null;
      try { logoAbs = logo ? new URL(String(logo), pageUrl).toString() : null; } catch {}
      const descHtml = it.description || "";
      const applyExtra = [it.applicationInstructions, it.applicationContact?.value, it.howToApply]
        .filter(Boolean).map(String).join("\n");
      const bodyText = htmlToText(descHtml) + (applyExtra ? "\n" + htmlToText(applyExtra) : "");
      // Hiring org fallback: page title often ends with "| Job at <Organization>"
      const titleTag = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "";
      const atOrg = decodeXml(titleTag).match(/job\s+at\s+(.+)$/i);
      return {
        external_id: String(it.identifier?.value || it.identifier || pageUrl),
        title: cleanText(it.title, 250),
        company: cleanText(org.name || org.legalName, 200) || cleanText(atOrg?.[1], 200),
        logo: logoAbs,
        location: cleanText(location, 200),
        job_type: normalizeEmploymentType(it.employmentType),
        posted_date: toDate(it.datePosted),
        deadline: toDate(it.validThrough),
        description: bodyText ? bodyText : null,
        requirements: htmlToText([it.qualifications, it.experienceRequirements, it.educationRequirements].filter(Boolean).join("\n")) || null,
        application_instructions: applyExtra
          ? htmlToText(applyExtra)
          : "Apply via the official posting page on the source.",
        contact_email: firstEmail(bodyText),
        original_url: pageUrl,
        source_page: pageUrl,
        category: null,
        raw_source: "ethiojobs-netet-jsonld",
      };
    }
  }
  // Fallback: hero meta + job_discription container (best effort, public page)
  const h1 = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1], 250);
  if (!h1) return null;
  const hero = [...String(html).matchAll(/<h6[^>]+class=["']vd-hero-meta__item["'][^>]*>([\s\S]*?)<\/h6>/gi)]
    .map((m) => cleanText(m[1], 120)).filter(Boolean);
  const heroDate = hero.find((x) => toDate(x)) || null;
  const heroLoc = hero[hero.length - 1] || null;
  const container = (/<div[^>]+id=["']job_discription["'][^>]*>([\s\S]*?)<\/div>/i.exec(html) || [])[1] || "";
  const closeTag = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "";
  const atOrg = decodeXml(closeTag).match(/job\s+at\s+(.+)$/i);
  const bodyText = htmlToText(container);
  return h1 ? {
    external_id: (() => { const m = /id=(\d+)/.exec(pageUrl); return m ? m[1] : pageUrl; })(),
    title: h1,
    company: cleanText(atOrg?.[1], 200),
    logo: null,
    location: cleanText(heroLoc, 200),
    job_type: null,
    posted_date: heroDate ? toDate(heroDate) : null,
    deadline: null,
    description: bodyText || null,
    requirements: null,
    application_instructions: "Apply via the official posting page on the source.",
    contact_email: firstEmail(bodyText),
    original_url: pageUrl,
    source_page: pageUrl,
    category: cleanText(hero[0], 120) !== cleanText(heroDate, 120) ? cleanText(hero[0], 120) : null,
    raw_source: "ethiojobs-netet-html",
  } : null;
}

export async function fetchJobs(source) {
  const cfg = source?.fetch_config || {};
  // Serverless-safe defaults: small batches + respectful delay.
  const limit = Math.max(1, Math.min(20, parseInt(cfg.limit || "8", 10) || 8));
  const offset = Math.max(0, parseInt(cfg.offset || "0", 10) || 0);
  const delayMs = Math.max(200, Math.min(2500, parseInt(cfg.delayMs || "400", 10) || 400));
  const sitemapUrl = String(cfg.sitemapUrl || `${BASE}/sitemap-jobs.xml`);

  const xml = await fetchText(sitemapUrl, 15000, "application/xml,text/xml,*/*");
  const all = parseSitemapLocs(xml);
  const urls = all.slice(offset, offset + limit);
  const consumed = offset + urls.length;
  const done = consumed >= all.length || urls.length === 0;
  const nextOffset = done ? 0 : consumed;

  // Staggered-parallel fetch (>=200ms between request starts; pool never exceeds 6 concurrent).
  const out = [];
  const seen = new Set();
  const batchAt = Date.now();
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
        const job = parseJobPosting(html, url);
        if (job?.title) {
          jobsRaw[idx] = {
            external_id: job.external_id || url,
            title: job.title,
            company: job.company || null,
            logo: job.logo || null,
            location: job.location || "Ethiopia",
            job_type: job.job_type || null,
            posted_date: job.posted_date || null,
            deadline: job.deadline || null,
            description: job.description || "Open the official/original vacancy page for full details.",
            requirements: job.requirements || null,
            application_instructions: job.application_instructions || "Apply via the official/original vacancy page.",
            contact_email: job.contact_email || null,
            original_url: url,
            source_page: url,
            category: job.category || null,
            raw_source: job.raw_source || "ethiojobs-net-et",
          };
        }
      } catch (e) {
        errors++;
      }
    }
  };
  await Promise.all(Array.from({ length: poolCount }, worker));
  for (const j of jobsRaw) if (j) out.push(j);
  if (out.length === 0 && errors >= urls.length && urls.length > 0) throw errors;
  try {
    out.progress = { offset, limit, totalFound: all.length, nextOffset, done, listingMode: "sitemap", fetched: urls.length, ok: out.length, errors };
  } catch {}
  return out;
}

export default { slug, fetchJobs };
