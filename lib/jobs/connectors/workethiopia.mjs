// WorkEthiopia public job listings (compliant, respectful).
// robots.txt allows all agents and publishes sitemap.xml (+ sitemap-employers/archive).
// Uses public sitemap.xml /jobs/* entries + public job detail pages; follows official employer application links.
// Batched with offset/progress for serverless timeouts.

import { cleanText, fetchPublicJobDetails, fetchPublicLogo, logoFromUrl, toDate } from "../utils.mjs";

export const slug = "workethiopia";
const BASE = "https://workethiopia.net";
const UA = "HabeshaCareers/1.0 (+https://habeshacareers-brown.vercel.app; public vacancy aggregation; respectful)";

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
    if (!res.ok) throw new Error(`WorkEthiopia HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

function decodeHtml(s = "") {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h\d|section|article|tr|td|th|header|footer|nav|main|aside)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function stripChrome(text = "") {
  let t = String(text || "");
  const cuts = [
    /\n\s*Apply on the employer['’]s application page\b[\s\S]*$/i,
    /\n\s*Open [^\n]{0,120}\s*\n\s*This role was found through the identifiable official source[\s\S]*$/i,
    /\n\s*View advert & apply\b[\s\S]*$/i,
    /\n\s*Related open jobs\b[\s\S]*$/i,
    /\n\s*workethiopia\.net\b[\s\S]*$/i,
    /\n\s*Your friend in the job hunt\.?[\s\S]*$/i,
    /\n\s*Join us\b[\s\S]*$/i,
    /\n\s*We use Google Analytics cookies[\s\S]*$/i,
    /\n\s*Cookie settings\b[\s\S]*$/i,
    /\n\s*Find jobs Post a job Employers\b[\s\S]*$/i,
    /\n\s*←\s*All open jobs\b/i,
    /^\s*Read full role\s*/i,
  ];
  for (const re of cuts) t = t.replace(re, "\n");
  // remove leading breadcrumb/title echo
  t = t.replace(/^\s*(?:←\s*)?All open jobs\s*/i, "");
  return cleanText(t, 50000);
}

function absUrl(href, base = BASE) {
  try { if (!href) return null; const u = new URL(href, base).toString(); return /^https?:/i.test(u) ? u : null; } catch { return /^https?:/i.test(href) ? href : null; }
}

function parseSitemapJobLocs(xml) {
  const urls = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    let u; try { u = new URL(m[1].trim(), BASE).toString(); } catch { continue; }
    if (!/^https:\/\/workethiopia\.net\/jobs\/[^/?#]+\/?$/i.test(u)) continue;
    const slug = u.replace(/\/$/, "").split("/").pop() || "";
    // exclude category/location/listing pages (usually short/single words) and keep job slugs (long, hashed)
    if (/^(this-week|weekly|addis-ababa|addis-abeba|remote|entry-level|internships|tech|ngo|bank|healthcare|drivers|technology|finance-and-accounting|administration|engineering|human-resources|education|logistics-and-supply-chain|operations|procurement|project-and-programme-management|sales-and-marketing|information-technology|legal-and-compliance|public-policy-and-government|research|skilled-trades|customer-service|hospitality|agriculture|remote-entry-level|software-engineers|hr-officers)$/i.test(slug)) continue;
    if (slug.length < 18) continue; // job slugs are long
    urls.push(u.replace(/\/$/, ""));
  }
  return Array.from(new Set(urls));
}

function pickMeta(html, propOrName) {
  const esc = propOrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const r = new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["']`, "i").exec(html)
    || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["']`, "i").exec(html);
  return r ? cleanText(r[1], 500) : null;
}

function parseDeadline(text) {
  if (!text) return null;
  const m = String(text).match(/(\d{1,2}\s+\w+\s+\d{4})/i);
  return m ? toDate(m[1]) : toDate(text);
}

function extractJsonLdJob(html) {
  const scripts = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of scripts) {
    let obj; try { obj = JSON.parse(m[1].trim()); } catch { continue; }
    const items = Array.isArray(obj) ? obj : (Array.isArray(obj?.["@graph"]) ? obj["@graph"] : [obj]);
    for (const it of items) {
      const types = [].concat(it?.["@type"] || []).map(String);
      if (!types.includes("JobPosting")) continue;
      const org = it.hiringOrganization || {};
      const loc = [].concat(it.jobLocation || []).map(jl => jl?.address?.addressLocality || jl?.address?.addressRegion || jl?.name).filter(Boolean).join(", ");
      return {
        title: cleanText(it.title, 300),
        company: cleanText(org.name, 200),
        location: cleanText(loc, 200),
        description: cleanText(it.description, 50000),
        datePosted: toDate(it.datePosted),
        validThrough: toDate(it.validThrough),
        employmentType: cleanText(it.employmentType, 120),
      };
    }
  }
  return null;
}

function extractDetail(html, detailUrl) {
  const ld = extractJsonLdJob(html);
  const h1 = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1], 300);
  const title = ld?.title || h1 || pickMeta(html, "og:title")?.replace(/\s*[|\-–]\s*workethiopia\.net.*$/i, "") || null;
  // employer link near title
  let company = ld?.company || cleanText((/<a[^>]+href=["']\/employers\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i.exec(html) || [])[1], 200);
  // meta line often contains: Addis Ababa ... Closes Saturday, 14 November 2026...
  const text = decodeHtml(html);
  const closes = (/(?:Closes?|Deadline|Closing)[^\n]{0,120}?(\d{1,2}\s+\w+\s+\d{4})/i.exec(text) || [])[1];
  const deadline = ld?.validThrough || parseDeadline(closes);
  const locMatch = /(?:Addis Ababa|Ethiopia|Remote|Jimma|Hawassa|Bahir Dar|Jijiga|Dollo Ado|Arba Minch|Oromia|Amhara|SNNPR|Somali|Sidama)[^\n]{0,80}/i.exec(text);
  const location = ld?.location || (locMatch ? cleanText(locMatch[0].split(/Senior|Mid|Entry|Intern|Director|Manager|Not stated|Closes|Checked/i)[0], 120) : null) || "Ethiopia";
  const typeMatch = /\b(Full[- ]?time|Part[- ]?time|Contract|Internship|Temporary|Consultant)\b/i.exec(text);
  const jobType = cleanText(ld?.employmentType, 120) || (typeMatch ? typeMatch[1] : null);

  // official apply URL: external "View advert & apply" / "Open ..."
  let originalUrl = detailUrl;
  const extLinks = [...html.matchAll(/<a[^>]+href=["'](https?:\/\/(?!workethiopia\.net)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const c of extLinks) {
    const href = absUrl(c[1], detailUrl); const label = decodeHtml(c[2]).toLowerCase();
    if (!href) continue;
    if (/apply|official|open |advert|employer|careers|view (role|job)|recruit/i.test(label) && !/facebook|twitter|linkedin|whatsapp|telegram|t\.me|mailto:|share|work\.ke|work\.tz/i.test(href)) { originalUrl = href; break; }
  }
  if (originalUrl === detailUrl) {
    for (const c of extLinks) {
      const href = absUrl(c[1], detailUrl);
      if (href && !/facebook|twitter|linkedin|whatsapp|telegram|t\.me|mailto:|work\.ke|work\.tz|workafro/i.test(href)) { originalUrl = href; break; }
    }
  }

  // role content: prefer "Role overview"/"About this role" block text
  let description = null;
  const bodyIdx = text.search(/(?:Role overview|About this role|Job description|Description)\b/i);
  if (bodyIdx >= 0) description = stripChrome(text.slice(bodyIdx).replace(/^(?:Role overview|About this role)\s*/i, ""));
  if (!description || description.length < 80) description = stripChrome(ld?.description ? decodeHtml(ld.description) : text);

  return { title, company, location, deadline, job_type: jobType, description, original_url: originalUrl };
}

export async function fetchJobs(source) {
  const cfg = source?.fetch_config || {};
  const limit = Math.max(1, Math.min(12, parseInt(cfg.limit || "3", 10) || 3)); // small: detail + optional official fetch
  const offset = Math.max(0, parseInt(cfg.offset || "0", 10) || 0);
  const delayMs = Math.max(250, Math.min(2500, parseInt(cfg.delayMs || "350", 10) || 350));
  const enrichOfficial = !!cfg.enrichOfficial; // off by default for batch safety
  const sitemapUrl = String(cfg.sitemapUrl || `${BASE}/sitemap.xml`);

  const xml = await fetchText(sitemapUrl, 15000);
  const all = parseSitemapJobLocs(xml);
  const urls = all.slice(offset, offset + limit);
  const consumed = offset + urls.length;
  const done = consumed >= all.length || urls.length === 0;
  const nextOffset = done ? 0 : consumed;

  const jobs = [];
  let errors = 0;
  for (let i = 0; i < urls.length; i++) {
    const detailUrl = urls[i];
    try {
      if (i > 0 || errors) await sleep(delayMs);
      const html = await fetchText(detailUrl, 12000);
      const d = extractDetail(html, detailUrl);
      if (!d.title) continue;
      let description = d.description;
      let requirements = null;
      let logo = null;
      if (enrichOfficial && d.original_url && !/workethiopia\.net/i.test(d.original_url)) {
        const full = await fetchPublicJobDetails(d.original_url, 6000).catch(() => null);
        if (full?.description && full.description.length > (description || "").length) description = full.description;
        requirements = full?.requirements || null;
        logo = await fetchPublicLogo(d.original_url).catch(() => null);
      }
      if (!logo) logo = logoFromUrl(d.original_url, { allowAggregator: false }) || null;
      jobs.push({
        external_id: detailUrl,
        title: d.title,
        company: d.company || null,
        logo,
        location: d.location || "Ethiopia",
        region_city: d.location || "Ethiopia",
        original_url: d.original_url || detailUrl,
        posted_date: null,
        deadline: d.deadline,
        description: description || `${d.title}${d.company ? ` — ${d.company}` : ""}. See the official organization application page for full vacancy details.`,
        requirements,
        application_instructions: "Apply via the official organization application page.",
        job_type: d.job_type || null,
        category: null,
        raw_source: "workethiopia-sitemap",
      });
    } catch (e) {
      errors++;
      if (!jobs._errors) jobs._errors = [];
      jobs._errors.push({ url: detailUrl, error: String(e?.message || e).slice(0, 180) });
      if (jobs.length === 0 && errors >= urls.length) throw e;
    }
  }
  try {
    jobs.progress = { offset, limit, totalFound: all.length, nextOffset, done, listingMode: "sitemap", fetched: urls.length, ok: jobs.length, errors };
  } catch {}
  return jobs;
}

export default { slug, fetchJobs };
