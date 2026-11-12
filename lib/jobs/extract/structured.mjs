// Stage B extraction for client-rendered sources.
//
// Some modern job boards (Next.js / Nuxt applications) do not render the
// announcement into the HTML document. Their content lives in a streamed
// RSC "flight" payload, which is still public and unauthenticated.
//
// This module converts such a payload into the same normalised vacancy shape
// the HTML extractor produces, so the rest of the pipeline (employer identity,
// application-link verification, deduplication, publication) is identical.

import { collapseWhitespace, decodeEntities, htmlToText, sanitizeHtml, textToParagraphHtml, truncate } from "./html.mjs";
import { APPLY_URL_TYPES, detectApplicationLinks } from "./apply-link.mjs";
import { UNVERIFIED_ORGANIZATION } from "./employer.mjs";
import { baseDomain, hostOf, isKnownSourceDomain, safeParseUrl } from "./hosts.mjs";
import { canonicalUrl, normalizeUrl } from "./urls.mjs";
import { dedupHash, toDate } from "../utils.mjs";

/**
 * Build a vacancy record from a structured job object (dereja and similar).
 */
export function extractFromStructuredJob(record, { pageUrl = "", source = null, fetchedAt = new Date() } = {}) {
  const company = record.company && typeof record.company === "object" ? record.company : {};
  const employerName = collapseWhitespace(String(company.name || ""));
  const title = collapseWhitespace(String(record.title || ""));
  if (!title) return null;

  const descriptionHtml = sanitizeHtml(String(record.description || ""), { baseUrl: pageUrl });
  const description = collapseWhitespace(htmlToText(descriptionHtml)).slice(0, 60000);
  const requirementsHtml = sanitizeHtml(String(record.requirement || ""), { baseUrl: pageUrl });
  const requirements = collapseWhitespace(htmlToText(requirementsHtml)).slice(0, 30000);
  const howToApplyHtml = sanitizeHtml(String(record.how_to_apply || ""), { baseUrl: pageUrl });
  const applicationInstructions = collapseWhitespace(htmlToText(howToApplyHtml)).slice(0, 10000);

  const location = [record.city, record.state, record.country].filter(Boolean).map((v) => collapseWhitespace(String(v))).join(", ");
  const deadline = toDate(record.date_expiry) || toDate(record.deadline) || null;
  const postedDate = toDate(record.created_at) || toDate(record.date_published) || null;
  const jobType = Array.isArray(record.type_name) ? record.type_name.join(", ") : record.type_name || null;
  const category = Array.isArray(record.catalog_names) ? record.catalog_names.join(", ") : record.catalog_names || null;

  const skills = []
    .concat(record.skills_mandatory_names || [], record.skills_desired_names || [])
    .map((s) => collapseWhitespace(String(s)))
    .filter(Boolean)
    .slice(0, 40);

  // The employer's own application destination.
  const applyCandidates = [record.career_page_link, record.application_email ? `mailto:${record.application_email}` : null].filter(Boolean);
  const detected = detectApplicationLinks({
    html: [descriptionHtml, howToApplyHtml].join("\n"),
    text: [description, applicationInstructions].join("\n"),
    pageUrl,
    source,
    jsonLd: {
      directApply: !!record.career_page_link,
      applicationContact: record.application_email || null,
      url: record.career_page_link || null,
    },
    applicationInstructions,
  });

  const pageHost = hostOf(pageUrl);
  const isIntermediate = (url) => {
    const s = String(url || "").trim();
    if (!s || /^mailto:/i.test(s)) return false;
    const h = hostOf(s);
    if (pageHost && h && h === pageHost) return true;
    if (isKnownSourceDomain(h) || isKnownSourceDomain(s)) return true;
    return false;
  };

  // Prefer a direct external application destination (form/ATS/employer apply/email)
  // over any intermediate/source page.
  let applyUrl = record.career_page_link || null;
  let applyUrlType = applyUrl ? APPLY_URL_TYPES.EXTERNAL_APPLICATION : null;
  let applyConfidence = applyUrl ? 90 : 0;
  if (isIntermediate(applyUrl)) {
    applyUrl = null;
    applyUrlType = null;
    applyConfidence = 0;
  }
  if (!applyUrl && record.application_email) {
    applyUrl = `mailto:${record.application_email}`;
    applyUrlType = APPLY_URL_TYPES.EMAIL;
    applyConfidence = 85;
  }
  if (!applyUrl && detected.selected) {
    applyUrl = detected.selected.urlType === APPLY_URL_TYPES.EMAIL ? `mailto:${detected.selected.url}` : detected.selected.url;
    applyUrlType = detected.selected.urlType;
    applyConfidence = detected.selected.confidence;
  } else if (applyUrl && detected.selected && !isIntermediate(detected.selected.url) && detected.selected.confidence >= Math.max(80, applyConfidence)) {
    // If content provides a more direct/explicit application link (e.g. form), prefer it.
    applyUrl = detected.selected.urlType === APPLY_URL_TYPES.EMAIL ? `mailto:${detected.selected.url}` : detected.selected.url;
    applyUrlType = detected.selected.urlType;
    applyConfidence = detected.selected.confidence;
  }

  const originalJobUrl = canonicalUrl(pageUrl) || normalizeUrl(pageUrl) || pageUrl;

  return {
    title,
    company: employerName || UNVERIFIED_ORGANIZATION,
    organizationVerified: !!employerName,
    organizationLogo: null,
    organizationWebsite: company.website ? String(company.website) : null,
    employerWebsite: company.website ? String(company.website) : null,
    organizationConfidence: employerName ? 92 : 0,
    organizationEvidence: employerName ? "structured_employer" : null,

    location: location || null,
    regionCity: record.city ? collapseWhitespace(String(record.city)) : null,
    jobType,
    vacancies: null,
    salary: record.salary_currency ? String(record.salary_currency) : null,
    education: null,
    experience: record.work_experience_name ? String(record.work_experience_name) : null,
    skills,

    description: description || null,
    descriptionHtml: descriptionHtml || (description ? textToParagraphHtml(description) : ""),
    descriptionExcerpt: description ? truncate(description, 240) : null,
    requirements: requirements || null,
    requirementsHtml: requirementsHtml || null,
    applicationInstructions: applicationInstructions || null,
    applicationEmail: record.application_email ? String(record.application_email) : null,
    contactEmail: record.application_email ? String(record.application_email) : null,

    applyUrl,
    applyUrlType,
    applyConfidence,
    applyReason: applyUrl ? "structured_application" : "no_valid_destination",
    applyAmbiguous: false,
    applyCandidates: detected.candidates.slice(0, 25).map((c) => ({
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
    jobReference: record.job_id ? String(record.job_id) : null,
    rawCategory: category ? truncate(String(category), 160) : null,

    listingPageUrl: null,
    originalJobUrl,
    canonicalJobUrl: originalJobUrl,
    sourceDomain: hostOf(source?.base_url || source?.listing_url || pageUrl),
    sourceWebsiteName: source?.name || null,
    extractionMethod: "flight-rsc",
    extractionTimestamp: fetchedAt instanceof Date ? fetchedAt.toISOString() : String(fetchedAt),

    unavailable: false,
    partial: description.length < 200,
    pageText: [description, requirements, applicationInstructions].join("\n"),
    dedupContentHash: dedupHash({
      title,
      company: employerName,
      location,
      deadline,
      original_url: originalJobUrl,
    }),
  };
}

export { isKnownSourceDomain, safeParseUrl, baseDomain };
