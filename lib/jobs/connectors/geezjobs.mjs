// GeezJobs connector (public, respectful).
// robots.txt (User-agent: *) allows /job-detail/*, /rss, /sitemap-detail; disallows search/filter query pages.
// Uses public RSS feed and/or public sitemap-detail + public job detail pages.
// Extracts structured JobPosting JSON-LD from public detail pages. No login/CAPTCHA/bypass.

import { cleanText, toDate } from "../utils.mjs";

export const slug = "geezjobs";
const BASE = "https://geezjobs.com";
const UA = "HabeshaCareers/1.0 (+https://habeshacareers-brown.vercel.app; public vacancy aggregation; respectful)";

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
    .replace(/&nbsp;/g, " ");
}

function htmlToPlain(html) {
  if (!html) return null;
  return cleanText(
    decodeXml(String(html))
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>(?=\s*<)/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|ul|ol|h\d|section|article|tr|td)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
    60000
  );
}

function pickSection(text, labels, stopLabels = []) {
  if (!text) return null;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelRe = labels.map(escRe).join("|");
  const stopRe = (stopLabels.length
    ? stopLabels
    : [
        "How to apply", "Apply now", "Application instructions", "Application process",
        "About the company", "About us", "Qualifications", "Requirements", "Responsibilities",
        "Duties", "Key responsibilities", "What you will do", "Description", "Job description",
        "Role overview", "Summary", "Benefits", "Salary", "Location", "Deadline", "Education",
        "Experience", "Skills", "Great to have", "Preferred qualifications",
      ]).map(escRe).join("|");
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:${labelRe})\\s*:?\\s*\\n([\\s\\S]{20,}?)(?=\\n\\s*(?:${stopRe})\\s*:?\\s*(?:\\n|$)|$)`,
    "i"
  );
  const m = String(text).match(re);
  return m ? cleanText(m[1], 25000) : null;
}

function parseRss(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const get = (tag) => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return mm ? decodeXml(mm[1]).trim() : null;
    };
    const title = cleanText(get("title"), 300);
    const link = cleanText(get("link"), 500);
    const description = htmlToPlain(get("description"));
    if (title && link && /geezjobs\.com\/job-detail\//i.test(link)) {
      items.push({ title, link, description });
    }
  }
  return items;
}

function parseSitemap(xml) {
  const locs = [];
  for (const m of String(xml).matchAll(/<loc>\s*(https:\/\/geezjobs\.com\/job-detail\/[^<\s]+)\s*<\/loc>/gi)) {
    locs.push(m[1].trim());
  }
  return [...new Set(locs)];
}

function extractJobPostingLd(html) {
  for (const m of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = JSON.parse(m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ""));
      const items = Array.isArray(raw) ? raw : Array.isArray(raw?.["@graph"]) ? raw["@graph"] : [raw];
      for (const it of items) {
        const type = Array.isArray(it?.["@type"]) ? it["@type"].join(" ") : String(it?.["@type"] || "");
        if (/JobPosting/i.test(type)) return it;
      }
    } catch {}
  }
  return null;
}

function joinLoc(addr) {
  if (!addr) return null;
  if (typeof addr === "string") return cleanText(addr, 200);
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).map((v) => cleanText(v, 80)).filter(Boolean);
  const dedup = [...new Set(parts)];
  return dedup.length ? dedup.join(", ") : cleanText(addr.streetAddress || addr.name, 200);
}

function formatSalary(base) {
  try {
    if (!base) return null;
    const v = base.value || base;
    const currency = base.currency || v?.currency || "ETB";
    const min = v?.minValue ?? v?.min ?? null;
    const max = v?.maxValue ?? v?.max ?? null;
    const unit = v?.unitText ? ` / ${cleanText(v.unitText, 30)}` : "";
    if (min != null && max != null) return `${currency} ${min}-${max}${unit}`;
    if (min != null) return `${currency} ${min}+${unit}`;
    if (max != null) return `Up to ${currency} ${max}${unit}`;
    if (v?.value != null) return `${currency} ${v.value}${unit}`;
  } catch {}
  return null;
}

function normalizeEmploymentType(et) {
  if (!et) return null;
  const arr = Array.isArray(et) ? et : [et];
  const map = { FULL_TIME: "Full-time", PART_TIME: "Part-time", CONTRACT: "Contract", TEMPORARY: "Temporary", INTERN: "Internship", VOLUNTEER: "Volunteer", PER_DIEM: "Per diem", OTHER: "Other" };
  const vals = arr.map((v) => map[String(v).toUpperCase().replace(/[^A-Z_]/g, "")] || cleanText(v, 60)).filter(Boolean);
  return vals.length ? [...new Set(vals)].join(", ") : null;
}

function isGenericLogo(url) {
  const u = String(url || "").toLowerCase();
  return !u || /default-logo|placeholder|no[-_]?logo|avatar/.test(u);
}

function extractExternalId(ld, pageUrl) {
  const v = ld?.identifier?.value || ld?.identifier;
  if (v && typeof v === "string") return v.trim();
  try {
    const p = new URL(pageUrl).pathname.split("/").filter(Boolean);
    return p[p.length - 1] || null;
  } catch {
    return null;
  }
}

function mapJob(ld, pageUrl, fallback = {}) {
  if (!ld) return null;
  const rawTitle = cleanText(ld.title, 300) || fallback.title;
  const title = rawTitle ? rawTitle.replace(/\s+(?:via|on)\s+GeezJobs\s*$/i, "").trim() : rawTitle;
  if (!title) return null;
  const org = ld.hiringOrganization || {};
  const company = cleanText(typeof org === "string" ? org : org.name, 200) || null;
  const descHtml = ld.description || ld.responsibilities || null;
  const descText = htmlToPlain(descHtml) || cleanText(fallback.description, 60000);
  const reqLd = htmlToPlain(ld.qualifications || ld.skills || ld.experienceRequirements || ld.educationRequirements);
  const requirements = reqLd || pickSection(descText, ["Requirements", "Qualifications", "Required qualifications", "Minimum requirements", "Who you are"]);
  const application = pickSection(descText, ["How to apply", "Application instructions", "Application process", "To apply"]);
  const location = joinLoc(ld.jobLocation?.address || ld.jobLocation?.[0]?.address || ld.applicantLocationRequirements) || joinLoc(ld.jobLocation) || null;
  const logoRaw = typeof org.logo === "string" ? org.logo : org.logo?.url || null;
  const logo = !isGenericLogo(logoRaw) && /^https?:/i.test(String(logoRaw || "")) ? String(logoRaw) : null;
  const deadline = toDate(ld.validThrough || ld.expires || null);
  const posted = toDate(ld.datePosted || null);
  const sourceUrl = cleanText(ld.url, 500) || pageUrl;

  // Keep the full public description on-site. Avoid fabricating employer-apply links; GeezJobs detail page is the public source.
  let description = descText;
  if (!description && company) description = `${title} at ${company}. See the official source page for full vacancy details.`;
  if (!description) description = `${title}. See the official source page for full vacancy details.`;

  return {
    external_id: extractExternalId(ld, pageUrl),
    title,
    company,
    logo,
    location: location || "Ethiopia",
    region_city: location || "Ethiopia",
    original_url: /^https?:/i.test(sourceUrl) ? sourceUrl : pageUrl,
    posted_date: posted,
    deadline,
    description,
    requirements,
    application_instructions: application || "Apply via the official source page.",
    contact_email: cleanText(ld.applicationContact?.email, 200) || null,
    job_type: normalizeEmploymentType(ld.employmentType),
    category: null,
    salary: formatSalary(ld.baseSalary),
    raw_source: "geezjobs-jobposting-jsonld",
    source_page: pageUrl,
  };
}

async function fetchDetailJob(url, fallback = {}) {
  const html = await fetchText(url, 12000);
  const ld = extractJobPostingLd(html);
  if (ld) return mapJob(ld, url, fallback);
  // Fallback: if JSON-LD missing, use minimal data from listing; do not guess restricted details.
  if (fallback.title) {
    return {
      external_id: extractExternalId(null, url),
      title: fallback.title,
      company: null,
      logo: null,
      location: "Ethiopia",
      region_city: "Ethiopia",
      original_url: url,
      posted_date: null,
      deadline: null,
      description: cleanText(fallback.description, 60000) || `${fallback.title}. See the official source page for full vacancy details.`,
      requirements: null,
      application_instructions: "Apply via the official source page.",
      contact_email: null,
      job_type: null,
      category: null,
      raw_source: "geezjobs-rss-fallback",
      source_page: url,
    };
  }
  return null;
}

export async function fetchJobs(source) {
  const limit = Math.max(1, Math.min(25, parseInt(source?.fetch_config?.limit || "15", 10) || 15));
  const delayMs = Math.max(300, Math.min(3000, parseInt(source?.fetch_config?.delayMs || "800", 10) || 800));
  const mode = String(source?.fetch_config?.listingMode || "rss").toLowerCase();
  const feedUrl = source?.fetch_config?.feedUrl || `${BASE}/rss`;
  const sitemapUrl = source?.fetch_config?.sitemapUrl || `${BASE}/sitemap-detail`;

  let targets = [];
  if (mode === "sitemap") {
    const xml = await fetchText(sitemapUrl, 20000, "application/xml,text/xml,*/*");
    targets = parseSitemap(xml).slice(0, limit).map((link) => ({ link }));
  } else {
    const xml = await fetchText(feedUrl, 15000, "application/rss+xml,application/xml,text/xml,*/*");
    targets = parseRss(xml).slice(0, limit);
  }

  const jobs = [];
  for (const item of targets) {
    const url = item.link;
    if (!url) continue;
    try {
      const job = await fetchDetailJob(url, item);
      if (job?.title) jobs.push(job);
    } catch (e) {
      if (!jobs._errors) jobs._errors = [];
      jobs._errors.push({ url, error: String(e?.message || e).slice(0, 180) });
    }
    if (delayMs) await sleep(delayMs);
  }
  return jobs;
}
