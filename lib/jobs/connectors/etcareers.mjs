// ET Careers (etcareers.com) connector (public, respectful).
// robots.txt allows sitemap + /jobs/* detail pages; only /?sort=|?q=|?page= and private paths disallowed.
// Uses public sitemap.xml (single urlset with /jobs/... URLs) + public detail pages (JobPosting JSON-LD).

import { cleanText, toDate } from "../utils.mjs";

export const slug = "etcareers";
const BASE = "https://etcareers.com";
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
    if (!res.ok) throw new Error(`ETCareers HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function parseSitemapLocs(xml) {
  const urls = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    let u;
    try { u = new URL(m[1], BASE).toString(); } catch { continue; }
    if (/\/jobs\/[a-z0-9-]+-[0-9a-f]{8}$/i.test(u)) urls.push(u);
  }
  return Array.from(new Set(urls));
}

function htmlToText(html = "") {
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
  if (/(sentry|\.png|\.jpg|example\.com|email-protection|etcareers\.com$)/i.test(e)) return null;
  return cleanText(e, 200);
}

function pickMainText(html = "") {
  const raw = String(html);
  const candidates = [];
  const re = /<(?:article|main|section|div)\b[^>]*(?:class|id)=["'][^"']*(?:job[-_ ]?(?:detail|description|content|body)|description|content|vacancy|posting|post[-_ ]?content|entry[-_ ]?content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|main|section|div)>/gi;
  let m;
  while ((m = re.exec(raw))) {
    const text = htmlToText(m[1]);
    if (text && text.length > 120) candidates.push(text);
  }
  if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0];
  const body = raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || raw;
  return htmlToText(body);
}

function extractExternalApplyLinks(text = "") {
  const urls = [];
  const seen = new Set();
  const add = (u) => {
    let url = String(u || "").trim().replace(/[),.;]+$/, "");
    if (!/^https?:\/\//i.test(url)) return;
    if (/etcareers\.com/i.test(url)) return;
    if (/facebook\.com|twitter\.com|linkedin\.com|t\.me|telegram\.me|whatsapp\.com/i.test(url)) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(url);
  };
  for (const m of String(text).matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)) add(m[0]);
  return urls;
}

function mergeTextParts(...parts) {
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const t = cleanText(p, 50000);
    if (!t) continue;
    const k = t.slice(0, 200).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join("\n\n").trim() || null;
}

function parseJobPosting(html, pageUrl) {
  const mainText = pickMainText(html);
  const externalApplyLinks = extractExternalApplyLinks(mainText);
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
        .map((a) => [a?.addressLocality || a?.addressRegion || a?.streetAddress].filter(Boolean).join(" "))
        .filter(Boolean).join(" | ")
        || cleanText(it.jobLocationType, 120)
        || (cleanText([it.applicantLocationRequirements?.name, it.jobLocationType].filter(Boolean).join(", "), 120) || null);
      let logoRaw = org.logo;
      let logo = typeof logoRaw === "string" ? logoRaw : (logoRaw?.url || logoRaw?.contentUrl || null);
      if (logo && (new URL(logo, pageUrl)).hostname.includes("etcareers.com")) logo = null;
      let logoAbs = null;
      try { logoAbs = logo ? new URL(String(logo), pageUrl).toString() : null; } catch {}
      const evidenced = location ? location.replace(/\s*\|.*$/, "") : null;
      const bodyText = htmlToText(it.description || "");
      const applyText = htmlToText([it.applicationInstructions, it.applicationContact?.value, it.howToApply].filter(Boolean).join("\n"));
      const description = mergeTextParts(bodyText, mainText && mainText.length > (bodyText?.length || 0) ? mainText : null);
      const contactEmail = firstEmail([applyText, bodyText, mainText].filter(Boolean).join("\n"));
      const applyUrlFromData = it.url || it.directApply || it.applicationContact?.url || null;
      const allApplyLinks = extractExternalApplyLinks([applyText, bodyText, mainText, typeof applyUrlFromData === "string" ? applyUrlFromData : ""].filter(Boolean).join("\n"));
      const chosenApplyLinks = allApplyLinks.length ? allApplyLinks : externalApplyLinks;
      let applicationInstructions = "";
      if (chosenApplyLinks.length) {
        applicationInstructions = `Apply using the official application link: ${chosenApplyLinks[0]}`;
        if (chosenApplyLinks.length > 1) applicationInstructions += `\nAdditional application link(s): ${chosenApplyLinks.slice(1, 3).join(", ")}`;
      } else if (applyText) {
        applicationInstructions = applyText;
      } else if (contactEmail) {
        applicationInstructions = `Apply via the official/original vacancy page (contact: ${contactEmail}).`;
      } else {
        applicationInstructions = "Apply via the official/original vacancy page on ET Careers.";
      }
      return {
        external_id: String(it.identifier?.value || it.identifier || pageUrl),
        title: cleanText(it.title, 250),
        company: cleanText(org.name || org.legalName, 200),
        logo: logoAbs,
        location: cleanText(evidenced || location, 200),
        job_type: normalizeEmploymentType(it.employmentType),
        posted_date: toDate(it.datePosted),
        deadline: toDate(it.validThrough),
        description: description || mainText || "Open the official/original vacancy page for full details.",
        requirements: htmlToText([it.qualifications, it.experienceRequirements, it.educationRequirements].filter(Boolean).join("\n")) || null,
        application_instructions: applicationInstructions,
        contact_email: contactEmail,
        original_url: pageUrl,
        source_page: pageUrl,
        category: null,
        raw_source: "etcareers-jsonld",
      };
    }
  }
  const og = (prop) => {
    const r = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i").exec(html)
      || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i").exec(html);
    return r ? cleanText(r[1], 5000) : null;
  };
  const title = og("og:title");
  const description = mergeTextParts(og("og:description") || og("description"), mainText);
  const contactEmail = firstEmail(mainText || "");
  let applicationInstructions = "Apply via the official/original vacancy page on ET Careers.";
  if (externalApplyLinks.length) {
    applicationInstructions = `Apply using the official application link: ${externalApplyLinks[0]}`;
  } else if (contactEmail) {
    applicationInstructions = `Apply via the official/original vacancy page (contact: ${contactEmail}).`;
  }
  return title ? {
    external_id: pageUrl,
    title: title.replace(/\s*[|\-–]\s*ET\s*Careers.*$/i, "").trim(),
    company: null,
    logo: null,
    location: null,
    job_type: null,
    posted_date: null,
    deadline: null,
    description: description || null,
    requirements: null,
    application_instructions: applicationInstructions,
    contact_email: contactEmail,
    original_url: pageUrl,
    source_page: pageUrl,
    category: null,
    raw_source: "etcareers-meta",
  } : null;
}

﻿export async function fetchJobs(source) {
  const cfg = source?.fetch_config || {};
  const limit = Math.max(1, Math.min(20, parseInt(cfg.limit || "8", 10) || 8));
  const offset = Math.max(0, parseInt(cfg.offset || "0", 10) || 0);
  const delayMs = Math.max(200, Math.min(2500, parseInt(cfg.delayMs || "400", 10) || 400));
  const sitemapUrl = String(cfg.sitemapUrl || `${BASE}/sitemap.xml`);

  const xml = await fetchText(sitemapUrl, 15000, "application/xml,text/xml,*/*");
  const all = parseSitemapLocs(xml);
  const urls = all.slice(offset, offset + limit);
  const consumed = offset + urls.length;
  const done = consumed >= all.length || urls.length === 0;
  const nextOffset = done ? 0 : consumed;

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
            original_url: job.original_url || url,
            source_page: url,
            category: job.category || null,
            raw_source: job.raw_source || "etcareers",
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
