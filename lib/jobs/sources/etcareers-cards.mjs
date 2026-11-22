// ETCareers listing-page job-card detection (public, robots-safe).
//
// robots.txt allows GET /jobs and /jobs?page=N. Only /?*sort= and /?*q= are
// disallowed, so the plain paginated listing is a valid discovery surface.
// A "job card" is the anchor that wraps a vacancy tile on the /jobs page:
//
//   <li>
//     <a class="block rounded-xl border" href="/jobs/senior-researcher-112105a7">
//       <h3>Senior Researcher</h3>
//       <p>Organisation name</p>
//       ...
//     </a>
//   </li>
//
// This module is pure: no network, no database. It only recognises cards and
// extracts the ETCareers detail URL (plus optional card metadata). The engine
// opens that URL separately in its extraction stage.

import { absolutize, canonicalUrl } from "../extract/urls.mjs";

export const ETCAREERS_HOSTS = new Set(["etcareers.com", "www.etcareers.com"]);

// Detail URLs end in a slug plus a short hex id: /jobs/<slug>-<hex6+>.
// Archive, category, company and /jobs/new pages never match this shape.
export const ETCAREERS_JOB_URL_RE = /\/jobs\/[a-z0-9][a-z0-9-]*-[0-9a-f]{6,}\/?$/i;

function decodeBasicEntities(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = parseInt(n, 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x10ffff ? String.fromCodePoint(cp) : "";
    });
}

function stripTags(html = "") {
  return decodeBasicEntities(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Normalise an href found on the listing page into a canonical ETCareers job
 * URL. Returns null for off-site, archive/category or non-detail links.
 */
export function extractEtcareersJobUrl(href, baseUrl = "https://etcareers.com/jobs") {
  const abs = absolutize(String(href || ""), baseUrl);
  if (!abs) return null;
  let url;
  try { url = new URL(abs); } catch { return null; }
  if (!ETCAREERS_HOSTS.has(url.hostname.toLowerCase())) return null;
  // Strip tracking/query/hash before testing the path shape.
  url.search = "";
  url.hash = "";
  const clean = url.toString().replace(/\/+$/, "");
  if (!ETCAREERS_JOB_URL_RE.test(clean)) return null;
  return canonicalUrl(clean) || clean;
}

/**
 * Detect vacancy cards on an ETCareers listing page.
 *
 * A card is an <a> whose href is an ETCareers detail URL AND whose inner HTML
 * carries a heading (h2/h3) — this excludes header/footer/navigation links
 * that happen to point at a job. Returns one entry per unique detail URL.
 */
export function detectEtcareersJobCards(html, baseUrl = "https://etcareers.com/jobs") {
  const document = String(html || "");
  const cards = [];
  const seen = new Set();

  for (const match of document.matchAll(/<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi)) {
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(match[1]) || [])[1];
    if (!href) continue;
    const url = extractEtcareersJobUrl(href, baseUrl);
    if (!url) continue;

    const inner = match[2];
    const heading = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(inner);
    if (!heading) continue;
    const title = stripTags(heading[1]);
    if (!title) continue;

    // Card metadata is best-effort; the URL and title are what matter.
    const paragraphs = [...inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((p) => stripTags(p[1]))
      .filter(Boolean);
    const company = paragraphs.find((p) => !/^(on-site|remote|hybrid|full-time|part-time|contract|internship)$/i.test(p) && !/\d+\s*(hours?|days?|weeks?|months?)\b/i.test(p)) || null;
    // Prefer the geographic location; fall back to the work-arrangement label.
    const location = paragraphs.find((p) => /,\s*ethiopia\b|addis ababa|dire dawa|mekele|hawassa|bahir dar|adama|gondar|jigjiga/i.test(p))
      || paragraphs.find((p) => /^(on-site|remote|hybrid)\b/i.test(p))
      || null;
    const postedText = paragraphs.find((p) => /\b(hours?|days?|weeks?|months?|ago|just now)\b/i.test(p)) || null;

    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ url, title, company, location, postedText, listingPageUrl: baseUrl });
  }

  return cards;
}

/**
 * Return the next 1-based page number when the listing exposes aNext link,
 * otherwise null. Only the public /jobs?page=N parameter is used.
 */
export function findNextEtcareersPage(html, currentPage) {
  const expected = parseInt(currentPage, 10) + 1;
  if (!Number.isFinite(expected) || expected < 2) return null;
  const document = String(html || "");
  const hasNumberedLink = new RegExp(`[?&]page=${expected}(?:["'&#]|$)`, "i").test(document);
  if (hasNumberedLink) return expected;
  // Some templates render only a "Next" anchor; accept it when it advances.
  for (const match of document.matchAll(/<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi)) {
    const label = stripTags(match[2]);
    if (!/\bnext\b|›|»|→/i.test(label)) continue;
    const page = /[?&]page=(\d+)/i.exec(match[1]);
    if (page && parseInt(page[1], 10) > parseInt(currentPage, 10)) return parseInt(page[1], 10);
  }
  return null;
}
