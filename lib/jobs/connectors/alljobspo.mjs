// Alljobspo (Jobs in Ethiopia) connector (public, respectful).
// robots.txt: User-agent * Allow: / (+ declared sitemap). Public listing pages /?page=N and
// public /job-details/<id> pages only. The "Apply to Job" button is a public redirect
// (url.php?id=<base64url>) to the ORIGINAL publisher page — decoded for the official link.

import { cleanText, toDate } from "../utils.mjs";

export const slug = "alljobspo";
const BASE = "https://jobsinethiopia.alljobspo.com";
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
    if (!res.ok) throw new Error(`Alljobspo HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function htmlToText(html = "") {
  return cleanText(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h\d|section|article|tr|td)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " "), 50000);
}

function decodeRedirect(html) {
  const m = String(html).match(/alljobspo\.com\/url\.php\?id=([A-Za-z0-9_-]+)"/i);
  if (!m) return null;
  try {
    let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const url = Buffer.from(b64, "base64").toString("utf8").trim();
    if (/^https?:\/\//i.test(url)) return url;
  } catch {}
  return null;
}

function firstEmail(text) {
  const m = String(text || "").match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  if (!m) return null;
  const e = m[0].replace(/[.,;)\]]+$/, "");
  if (/(sentry|\.png|\.jpg|example\.com|email-protection|alljobspo\.com$)/i.test(e)) return null;
  return cleanText(e, 200);
}

const WEEKDAY = "(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day";

function parseDetail(html, detailUrl) {
  const text = htmlToText(String(html));
  if (!text || text.length < 100) return null;

  const title = cleanText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1], 250)
    || cleanText((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1], 250).replace(/\s*[|\-]\s*Alljobspo\.com.*$/i, "").trim();
  if (!title) return null;

  // Posting text: from "Position or Title"/"Description" onward, until the apply CTA area.
  let desc = "";
  const startIdx = text.search(/Position or Title|Description/i);
  const endIdxRes = text.search(/Apply to Job|Free Aptitude Practice|Share this page on/i);
  if (startIdx >= 0) {
    desc = text.slice(startIdx, endIdxRes > startIdx ? endIdxRes : undefined);
  } else {
    desc = endIdxRes > 0 ? text.slice(0, endIdxRes) : text;
  }
  desc = desc.replace(/^(Description)\s*:?\s*$/im, "").replace(/\n{3,}/g, "\n\n").trim();

  const locM = desc.match(/(?:Place of Work|Location|Duty Station)\s*:?\s*([^\n]{2,90})/i)
    || text.match(/Location\s*:?\s*\n?\s*([^\n]{2,90})/i);
  let location = locM ? cleanText(locM[1].split(/\s+(?:Application|Apply|Gender|Salary|Report|Description|Position|Job|Dut|Age|No\.)\b/i)[0], 200) : null;
  if (location && !/[a-z]{2,}/i.test(location)) location = null; // punctuation-only artifacts -> fallback
  if (location && /^from\s+/i.test(location)) location = null; // "Location: from <publisher>" is the posting source, not the workplace
  const postedLine = text.match(new RegExp(`((?:Today\\s+)?${WEEKDAY},?\\s+\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Za-z]+\\s+\\d{4})`));
  const posted = postedLine ? toDate(postedLine[1].replace(/(\d)(st|nd|rd|th)/i, "$1")) : null;
  const poster = cleanText((text.match(new RegExp(`from\\s+([A-Za-z0-9][A-Za-z0-9 .&'’-]{1,48}?)\\s*(?=(?:Today\\s+)?${WEEKDAY}\\b,?)`, "i")) || [])[1], 100) || null;
  const deadlineTxt = desc.match(/(?:dead\s*line|deadlien|last\s*date\s*(?:of\s*(?:announcement|application))?)\s*[:\-]?\s*([^\n]{4,80})/i);
  const deadline = /(\d{4})/.test(deadlineTxt?.[1] || "") ? toDate(deadlineTxt[1]) : null;

  const originalUrl = decodeRedirect(html) || detailUrl;
  const descCompany = cleanText((desc.match(/(?:Organi[sz]ation|Company|Employer|Hiring Organization)\s*(?:Name)?\s*:?\s*([^\n]{2,90})/i) || [])[1], 200);
  let company = descCompany
    || (poster ? `${poster} (posted via Alljobspo)` : null)
    || `Unknown organization (Alljobspo job ${String((detailUrl.match(/job-details\/(\d+)/) || [])[1])})`;

  return {
    external_id: (detailUrl.match(/job-details\/(\d+)/) || [])[1] || detailUrl,
    title,
    company,
    logo: null, // never alljobspo platform icons; orgLogoUrl cascade may fill known orgs
    location: location || "Ethiopia",
    job_type: null,
    posted_date: posted || null,
    deadline,
    description: desc || "Open the official/original vacancy page for full details.",
    requirements: null,
    application_instructions: originalUrl !== detailUrl
      ? `Apply via the official/original posting page: ${originalUrl}${firstEmail(desc) ? ` (contact/email found in posting: ${firstEmail(desc)})` : ""}`
      : `Apply via the official/original vacancy page.${firstEmail(desc) ? ` Contact/email found in posting: ${firstEmail(desc)}` : ""}`,
    contact_email: firstEmail(desc),
    original_url: originalUrl,
    source_page: detailUrl,
    category: null,
    raw_source: "alljobspo-html",
  };
}

export async function fetchJobs(source) {
  const cfg = source?.fetch_config || {};
  const limit = Math.max(1, Math.min(24, parseInt(cfg.limit || "20", 10) || 20));
  const page = Math.max(1, parseInt(cfg.offset || "1", 10) || 1); // offset = next listing page number
  const delayMs = Math.max(200, Math.min(2500, parseInt(cfg.delayMs || "300", 10) || 300));

  const listingUrl = page > 1 ? `${BASE}/?page=${page}` : `${BASE}/`;
  const listingHtml = await fetchText(listingUrl, 15000);
  const pagesFound = parseInt((listingHtml.match(/Page\s+\d+\s+of\s+(\d+)/i) || [])[1] || "0", 10);
  const seen = new Set();
  const urls = [];
  for (const m of String(listingHtml).matchAll(/jobsinethiopia\.alljobspo\.com\/job-details\/(\d+)/g)) {
    const u = `${BASE}/job-details/${m[1]}`;
    if (!seen.has(u)) { seen.add(u); urls.push(u); }
  }
  if (!urls.length && page > pagesFound) {
    // Catalog pass complete -> reset offset so cron keeps refreshing page 1 onward.
    const empty = [];
    try { empty.progress = { offset: 1, limit, totalFound: pagesFound * 20, nextOffset: 1, done: true, listingMode: "list-pagination", fetched: 0, ok: 0, errors: 0 }; } catch {}
    return empty;
  }

  const batchUrls = urls.slice(0, limit);
  const out = [];
  const batchAt = Date.now();
  let next = 0;
  let errors = 0;
  const jobsRaw = new Array(batchUrls.length).fill(null);
  const poolCount = Math.max(1, Math.min(6, batchUrls.length));
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= batchUrls.length) return;
      const url = batchUrls[idx];
      const at = batchAt + (idx + 1) * delayMs; // listing request already started at t0
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
  if (out.length === 0 && errors >= batchUrls.length && batchUrls.length > 0) throw errors;

  const nextPage = page + 1;
  const done = pagesFound > 0 && pagesFound > 0 && nextPage > pagesFound;
  const nextOffset = done ? 0 : nextPage;
  try {
    out.progress = { offset: page, limit, totalFound: pagesFound * 20, nextOffset, done, listingMode: "list-pagination", fetched: batchUrls.length, ok: out.length, errors };
  } catch {}
  return out;
}

export default { slug, fetchJobs };
