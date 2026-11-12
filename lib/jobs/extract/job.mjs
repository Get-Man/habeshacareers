// Full vacancy extraction from an individual announcement page.
//
// Stage A only discovers individual vacancy URLs. This module is Stage B: it
// turns one fetched page into a normalised, source-scrubbed vacancy record.
// Every field is derived from the page; nothing is fabricated.

import { dedupHash, toDate } from "../utils.mjs";
import {
  collapseWhitespace,
  decodeEntities,
  extractJsonLd,
  extractMainContentHtml,
  extractMeta,
  extractSectionHtml,
  extractSectionText,
  extractTitleTag,
  findEmails,
  findJobPosting,
  htmlToText,
  sanitizeHtml,
  textToParagraphHtml,
  truncate,
} from "./html.mjs";
import { detectApplicationLinks, APPLY_URL_TYPES } from "./apply-link.mjs";
import { identifyEmployer, UNVERIFIED_ORGANIZATION } from "./employer.mjs";
import { inferEmployerDomain } from "./employer-logo.mjs";
import { baseDomain, hostOf, isKnownSourceDomain, isSourceHost, safeParseUrl } from "./hosts.mjs";
import { canonicalUrl, normalizeUrl } from "./urls.mjs";
import { validateExtractedJob } from "./validate.mjs";

const SOURCE_BRAND_PATTERN =
  "\\b(?:geez\\s*jobs|geezjobs|ethio\\s*jobs|ethiojobs|ethio-jobs|et\\s*careers|etcareers|work\\s*ethiopia|workethiopia|alljobspo|jobs\\s*in\\s*ethiopia|ethiopian\\s*reporter\\s*jobs|reporter\\s*jobs|reliefweb|un\\s*careers|unjobs|hahu\\s*jobs|dereja|ezega|jobweb\\s*ethiopia|ngojobs|sirazone|srazone|ethiopian\\s*jobs)\\b";
const SOURCE_BRAND_RE = new RegExp(SOURCE_BRAND_PATTERN, "gi");
const SOURCE_BRAND_TEST_RE = new RegExp(SOURCE_BRAND_PATTERN, "i");

const SOURCE_DOMAIN_RE =
  /(?:https?:\/\/)?(?:[\w-]+\.)*(?:geezjobs\.com|ethiojobs\.net|ethiojobs\.net\.et|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)(?:\/[^\s"'<>)]*)?/gi;

const KNOWN_JOB_TYPE = [
  [/\bintern(ship)?\b|\bapprentice/i, "Internship"],
  [/\bpart[\s-]?time\b/i, "Part Time"],
  [/\bcontract(or)?\b|\bfixed[\s-]?term\b/i, "Contract"],
  [/\btemporary\b|\bcasual\b/i, "Temporary"],
  [/\bfreelance\b/i, "Freelance"],
  [/\bfull[\s-]?time\b|\bpermanent\b/i, "Full Time"],
];

const UNAVAILABLE_TEXT_RE =
  /\b(?:no longer available|position has been filled|vacancy (?:has been )?closed|job (?:has )?expired|not accepting applications|page not found|404)\b/i;

function escRe(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceDomains(source) {
  const out = new Set();
  for (const raw of [source?.base_url, source?.listing_url]) {
    const host = hostOf(raw);
    if (host) out.add(host);
  }
  if (source?.slug) out.add(String(source.slug));
  return [...out].filter(Boolean);
}

/**
 * Remove a discovery source's own branding from a vacancy title.
 *
 * Boards append their name to the headline they publish ("Secretary via
 * GeezJobs"). The vacancy title is the employer's, so the attribution clause
 * is removed together with the connector word that introduces it. A brand
 * that is not an attribution clause ("Siinqee Bank ... 55 Jobs in Ethiopia")
 * is left alone, because it is part of the employer's own headline.
 */
export function scrubSourceTitle(value) {
  let title = collapseWhitespace(String(value == null ? "" : value));
  if (!title) return title;
  title = title.replace(
    new RegExp(
      `\\s+(?:via|at|on|from|through)\\s+(?:${SOURCE_BRAND_PATTERN})\\.?\\s*$`,
      "i"
    ),
    ""
  );
  title = title.replace(
    new RegExp(`\\s*[|\\-–—:]\\s*(?:${SOURCE_BRAND_PATTERN})\\.?\\s*$`, "i"),
    ""
  );
  return collapseWhitespace(title);
}

/**
 * Remove third-party source attribution from text before it can ever reach the
 * public UI. The employer and vacancy content are kept.
 */
export function scrubSourceText(value, source = null) {
  let text = String(value == null ? "" : value);
  for (const domain of sourceDomains(source)) {
    if (!domain.includes(".")) continue;
    text = text.replace(new RegExp(`https?://(?:[\\w-]+\\.)*${escRe(domain)}(?:/[^\\s"'<>)]*)?`, "gi"), " ");
    text = text.replace(new RegExp(`(?:^|\\s)(?:[\\w-]+\\.)*${escRe(domain)}(?=\\s|$|[,.;:])`, "gi"), " ");
  }
  text = text.replace(SOURCE_DOMAIN_RE, " ");
  if (source?.name) text = text.replace(new RegExp(escRe(source.name), "gi"), " ");
  text = text.replace(SOURCE_BRAND_RE, " ");
  return collapseWhitespace(text);
}

export function scrubSourceHtml(value, source = null, { baseUrl = "" } = {}) {
  let html = String(value == null ? "" : value);
  // Drop anchors that point at a discovery source, keeping their readable text.
  html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs, inner) => {
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1] || "";
    if (href && (isSourceHost(href, baseUrl) || isKnownSourceDomain(hostOf(href, baseUrl)))) {
      return `<span>${inner}</span>`;
    }
    return full;
  });
  let clean = sanitizeHtml(html, { baseUrl });
  for (const domain of sourceDomains(source)) {
    if (!domain.includes(".")) continue;
    clean = clean.replace(new RegExp(`https?://(?:[\\w-]+\\.)*${escRe(domain)}(?:/[^\\s"'<>)]*)?`, "gi"), " ");
  }
  clean = clean.replace(SOURCE_DOMAIN_RE, " ");
  if (source?.name) clean = clean.replace(new RegExp(escRe(source.name), "gi"), " ");
  clean = clean.replace(SOURCE_BRAND_RE, " ");
  return clean.replace(/<p>\s*<\/p>/gi, "").replace(/\s{3,}/g, " ").trim();
}

function cleanTitle(raw, source) {
  let title = collapseWhitespace(decodeEntities(htmlToText(raw)));
  if (!title) return null;
  title = title.replace(/\s*[|–—]\s*[^|–—]{1,60}$/i, (match) => {
    // Only drop a trailing segment when it is a source/site brand.
    return SOURCE_BRAND_TEST_RE.test(match) || (source?.name && match.toLowerCase().includes(String(source.name).toLowerCase())) ? "" : match;
  });
  title = title.replace(new RegExp(`\\s*[-–—|:]\\s*${escRe(source?.name || "")}\\s*$`, "i"), "");
  title = scrubSourceTitle(title);
  title = scrubSourceText(title, source);
  return truncate(title, 300) || null;
}

function extractCanonical(html, pageUrl) {
  const m = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(String(html || ""));
  if (!m) return null;
  const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]) || [])[1];
  if (!href) return null;
  const u = safeParseUrl(href, pageUrl);
  if (!u) return null;
  // A canonical pointing at another site is usually the publisher's page. Keep
  // it only for same-site canonicalisation; the apply detector handles publisher links.
  if (hostOf(u) !== hostOf(pageUrl)) return null;
  return canonicalUrl(u.toString());
}

function locationFromJsonLd(jsonLd) {
  const locations = [].concat(jsonLd?.jobLocation || []).filter(Boolean);
  const parts = [];
  for (const loc of locations) {
    const address = loc?.address || loc;
    const value = [
      address?.addressLocality,
      address?.addressRegion,
      address?.addressCountry?.name || address?.addressCountry,
    ].filter(Boolean).join(", ");
    if (value) parts.push(value);
  }
  return parts.length ? collapseWhitespace(parts.join(" | ")) : null;
}

function locationFromText(text) {
  const m =
    /(?:^|\n)\s*(?:place of work|work\s*location|duty station|location|job location)\s*[:\-]\s*([^\n]{2,120})/i.exec(text || "");
  if (!m) return null;
  let value = collapseWhitespace(m[1]);
  value = value.split(/\s+(?:Deadline|Closing|Salary|Job Type|Employment|Position|Organization|Company|Application)\b/i)[0].trim();
  return value.length >= 2 ? truncate(value, 200) : null;
}

function normalizeJobType(value) {
  const raw = collapseWhitespace(Array.isArray(value) ? value.join(", ") : value || "");
  if (!raw) return null;
  for (const [re, label] of KNOWN_JOB_TYPE) if (re.test(raw)) return label;
  return truncate(raw, 80);
}

function salaryFromJsonLd(jsonLd) {
  const base = jsonLd?.baseSalary;
  if (!base) return null;
  if (typeof base === "string") return truncate(base, 300);
  const value = base.value || {};
  const amount = value.value ?? value.minValue ?? value.maxValue;
  const currency = base.currency || value.currency || "";
  const unit = value.unitText || "";
  if (amount == null) return null;
  return collapseWhitespace(`${currency} ${amount}${unit ? ` / ${unit}` : ""}`);
}

function salaryFromText(text) {
  const m = /(?:^|\n)\s*(?:salary|remuneration|compensation|pay)\s*[:\-]\s*([^\n]{2,160})/i.exec(text || "");
  return m ? truncate(collapseWhitespace(m[1]), 300) : null;
}

function deadlineFromText(text) {
  const m =
    /(?:^|\n)\s*(?:application\s+deadline|deadline|closing\s+date|closes?\s+on|last\s+date\s+(?:of\s+application|to\s+apply))\s*[:\-]\s*([^\n]{4,80})/i.exec(text || "");
  return m ? toDate(m[1]) : null;
}

function vacanciesFromText(text) {
  const m = /(?:number of (?:vacancies|positions|posts)|vacancies|positions available)\s*[:\-]?\s*(\d{1,3})/i.exec(text || "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 && n <= 999 ? n : null;
}

function referenceFromJsonLd(jsonLd) {
  const id = jsonLd?.identifier;
  if (!id) return null;
  if (typeof id === "string") return truncate(id, 120);
  return truncate(id.value || id.name || "", 120) || null;
}

function referenceFromText(text) {
  const m = /(?:job\s*(?:reference|code|id)|vacancy\s*(?:reference|code|number)|reference\s*(?:no|number|code))\s*[:\-]\s*([A-Za-z0-9/_.-]{2,60})/i.exec(text || "");
  return m ? m[1] : null;
}

function section(html, labels, stops) {
  const chunk = extractSectionHtml(html, labels, stops);
  return chunk || "";
}

function buildDescription({ jsonLd, pageHtml, source }) {
  const ldDescription = typeof jsonLd?.description === "string" ? jsonLd.description : "";
  if (ldDescription && htmlToText(ldDescription).length >= 120) {
    const cleanHtml = scrubSourceHtml(ldDescription, source, { baseUrl: "" });
    const text = scrubSourceText(htmlToText(cleanHtml), source);
    if (text.length >= 120) return { html: cleanHtml, text };
  }
  const main = extractMainContentHtml(pageHtml);
  const cleanHtml = scrubSourceHtml(main, source, { baseUrl: "" });
  let text = scrubSourceText(htmlToText(cleanHtml), source);
  // Main-content fallback may include page chrome; keep it only when substantial.
  if (text.length < 120) return { html: "", text: "" };
  return { html: cleanHtml, text };
}

/**
 * Extract a vacancy from one individual announcement page.
 *
 * @param {object} input
 * @param {string} input.html raw HTML of the individual page
 * @param {string} input.pageUrl URL that was fetched (after redirects)
 * @param {string} [input.listingPageUrl] discovery listing page
 * @param {object} [input.source] job_sources row
 */
export function extractJobFromPage({
  html = "",
  pageUrl = "",
  listingPageUrl = null,
  source = null,
  fetchedAt = new Date(),
} = {}) {
  const meta = extractMeta(html);
  const jsonLdItems = extractJsonLd(html);
  const jsonLd = findJobPosting(jsonLdItems);
  const pageTextRaw = htmlToText(html, 120000);
  const unavailable = UNAVAILABLE_TEXT_RE.test(pageTextRaw.slice(0, 8000)) && !jsonLd;

  const title =
    cleanTitle(jsonLd?.title, source) ||
    cleanTitle(meta["og:title"], source) ||
    cleanTitle(extractTitleTag(html), source) ||
    cleanTitle((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1], source);

  const employer = identifyEmployer({ jsonLd, meta, html, text: pageTextRaw, pageUrl, source });
  const company = employer.name === UNVERIFIED_ORGANIZATION ? UNVERIFIED_ORGANIZATION : employer.name;
  // The organisation's own website, inferred from the announcement. The logo
  // resolver uses it to find the organisation's OFFICIAL logo.
  const employerWebsite =
    inferEmployerDomain({ jsonLd, meta, html, source, employerName: company })?.url || null;

  const description = buildDescription({ jsonLd, pageHtml: html, source });
  const requirementsHtmlRaw =
    section(html, ["Requirements", "Qualifications", "Required Qualifications", "Job Requirements", "Skills and Experience"], [
      "How to Apply", "Application", "Benefits", "About", "Related", "Similar", "Responsibilities",
    ]) || (typeof jsonLd?.qualifications === "string" ? jsonLd.qualifications : "");
  const requirementsHtml = requirementsHtmlRaw
    ? scrubSourceHtml(requirementsHtmlRaw, source)
    : "";
  const requirements = requirementsHtml ? scrubSourceText(htmlToText(requirementsHtml), source) : "";

  const howToApplyHtml = section(html, ["How to Apply", "How To Apply", "Application Instructions", "Application Process", "Application Procedure", "To Apply"], [
    "About", "Requirements", "Qualifications", "Description", "Benefits", "Related", "Similar",
  ]);
  const howToApply = howToApplyHtml ? scrubSourceText(htmlToText(howToApplyHtml), source) : "";

  const apply = detectApplicationLinks({
    html,
    text: pageTextRaw,
    pageUrl,
    source,
    jsonLd,
    meta,
    applicationInstructions: howToApply,
    employerName: company,
  });

  const selected = apply.selected;
  const applyUrl = selected
    ? selected.urlType === APPLY_URL_TYPES.EMAIL
      ? `mailto:${selected.url}`
      : selected.url
    : null;

  const emailCandidates = [
    apply.applicationEmail,
    ...findEmails(howToApply, { sourceDomains: sourceDomains(source) }),
    ...findEmails(pageTextRaw, { sourceDomains: sourceDomains(source) }),
  ].filter(Boolean);
  const applicationEmail = emailCandidates[0] || null;

  const location = locationFromJsonLd(jsonLd) || locationFromText(pageTextRaw) || collapseWhitespace(meta["og:locality"] || "") || null;
  const jobType = normalizeJobType(jsonLd?.employmentType) || normalizeJobType(meta["og:employment_type"]);
  const deadline = toDate(jsonLd?.validThrough) || deadlineFromText(pageTextRaw);
  const postedDate =
    toDate(jsonLd?.datePosted) ||
    toDate(meta["article:published_time"]) ||
    toDate(meta["date"]) ||
    null;
  const salary = salaryFromJsonLd(jsonLd) || salaryFromText(pageTextRaw);
  const vacancies = vacanciesFromText(pageTextRaw);
  const jobReference = referenceFromJsonLd(jsonLd) || referenceFromText(pageTextRaw);
  const rawCategory = truncate(
    collapseWhitespace(
      [].concat(jsonLd?.occupationalCategory || jsonLd?.industry || jsonLd?.category || [])
        .map((v) => (typeof v === "string" ? v : v?.name || ""))
        .filter(Boolean)
        .join(", ")
    ),
    160
  ) || null;

  const education = typeof jsonLd?.educationRequirements === "string" ? jsonLd.educationRequirements : "";
  const experience = typeof jsonLd?.experienceRequirements === "string" ? jsonLd.experienceRequirements : "";
  const skills = [].concat(jsonLd?.skills || jsonLd?.requiredSkills || [])
    .map((s) => (typeof s === "string" ? s : s?.name || ""))
    .map((s) => collapseWhitespace(s))
    .filter(Boolean)
    .slice(0, 40);

  const originalJobUrl = canonicalUrl(pageUrl) || normalizeUrl(pageUrl) || pageUrl;
  const canonicalJobUrl = extractCanonical(html, pageUrl) || originalJobUrl;
  const sourceDomain = hostOf(source?.base_url || source?.listing_url || pageUrl);
  const descriptionText = description.text;

  const partial = !description.html || descriptionText.length < 200;

  const base = {
    title,
    company,
    organizationVerified: company !== UNVERIFIED_ORGANIZATION && !!employer.verified,
    organizationLogo: employer.logo || null,
    organizationWebsite: employerWebsite,
    employerWebsite: employerWebsite,
    organizationConfidence: employer.confidence || 0,
    organizationEvidence: employer.evidence || null,

    location: location ? scrubSourceText(location, source) : null,
    regionCity: location ? scrubSourceText(location, source) : null,
    jobType,
    vacancies,
    salary,
    education: education ? scrubSourceText(htmlToText(education), source) : null,
    experience: experience ? scrubSourceText(htmlToText(experience), source) : null,
    skills,

    description: descriptionText || null,
    descriptionHtml: description.html || (descriptionText ? textToParagraphHtml(descriptionText) : ""),
    descriptionExcerpt: descriptionText ? truncate(descriptionText, 240) : null,
    requirements: requirements || null,
    requirementsHtml: requirementsHtml || null,
    applicationInstructions: howToApply || null,
    applicationEmail,
    contactEmail: applicationEmail,

    applyUrl,
    applyUrlType: selected?.urlType || null,
    applyConfidence: selected?.confidence || 0,
    applyReason: apply.reason || null,
    applyAmbiguous: !!apply.ambiguous,
    applyCandidates: apply.candidates.slice(0, 25).map((c) => ({
      url: c.url,
      urlType: c.urlType,
      confidence: c.confidence,
      source: c.source,
      label: c.label,
      context: c.context,
      valid: c.valid,
      reason: c.reason,
      status: c.status,
    })),

    postedDate,
    deadline,
    jobReference,
    rawCategory,

    listingPageUrl: listingPageUrl || null,
    originalJobUrl,
    canonicalJobUrl,
    sourceDomain,
    sourceWebsiteName: source?.name || null,
    extractionMethod: jsonLd ? "jsonld" : "html",
    extractionTimestamp: fetchedAt instanceof Date ? fetchedAt.toISOString() : String(fetchedAt),

    unavailable,
    partial,
    pageText: pageTextRaw,
    // Structured data kept for the employer-logo resolver, which must read the
    // hiring organisation's own declarations (logo, website) from the page.
    pageJsonLd: jsonLd,
    pageMeta: meta,
    // Raw markup (bounded) so the resolver can find the employer's own website
    // link and logo references. Never persisted to the database.
    pageHtml: String(html || "").slice(0, 200000),
    dedupContentHash: dedupHash({
      title: title || "",
      company: company || "",
      location,
      deadline,
      original_url: canonicalJobUrl || originalJobUrl,
    }),
  };

  const validated = validateExtractedJob(base, { source, now: fetchedAt instanceof Date ? fetchedAt : new Date() });
  return {
    ...validated,
    descriptionHtml: validated.descriptionHtml || (validated.description ? textToParagraphHtml(validated.description) : ""),
  };
}
