// Validation and quality scoring for extracted vacancies.
//
// Validation is deliberately conservative: it never invents a value. A missing
// employer becomes "Organization not verified", a missing application
// destination becomes null, and ambiguous evidence is flagged for admin review.

import { toDate } from "../utils.mjs";
import { APPLY_URL_TYPES, classifyDestination, isPubliclySafeApplyUrl } from "./apply-link.mjs";
import { UNVERIFIED_ORGANIZATION } from "./employer.mjs";
import { hostOf, isSourceHost } from "./hosts.mjs";

export const EXTRACTION_STATUS = {
  VERIFIED: "verified",
  PARTIAL: "partial",
  NEEDS_REVIEW: "needs_manual_review",
  FAILED: "failed",
};

export const JOB_STATUS = {
  OPEN: "open",
  CLOSING_SOON: "closing_soon",
  EXPIRED: "expired",
  CLOSED: "closed",
  UNAVAILABLE: "unavailable",
  NEEDS_VERIFICATION: "needs_verification",
};

const UNAVAILABLE_RE =
  /\b(?:this\s+(?:job|vacancy|position|advert|posting)\s+(?:is\s+)?(?:no\s+longer|not)\s+(?:available|open|active)|position\s+(?:has\s+been\s+)?filled|vacancy\s+(?:has\s+been\s+)?closed|job\s+expired|advert\s+has\s+expired|no\s+longer\s+accepting\s+applications|page\s+not\s+found|404\s*-?\s*(?:not\s+found|page)|this\s+job\s+has\s+expired|deadline\s+(?:has\s+)?passed)\b/i;

const FILLER_RE =
  /^(?:n\/?a|none|null|undefined|-{1,3}|see (?:the )?(?:original|source|official).{0,60}|apply (?:via|on) (?:the )?(?:original|source|official).{0,60})$/i;

export function cleanValue(value, max = 4000) {
  if (value == null) return null;
  const s = String(value).replace(/\u0000/g, " ").replace(/\r\n?/g, "\n").trim();
  if (!s || FILLER_RE.test(s)) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function detectUnavailablePage(text) {
  const sample = String(text || "").slice(0, 6000);
  if (!sample) return false;
  return UNAVAILABLE_RE.test(sample);
}

export function daysUntil(deadline, now = new Date()) {
  const date = toDate(deadline);
  if (!date) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

export function computeJobStatus({ deadline, extractionStatus, applyType, explicitStatus, now = new Date() } = {}) {
  if (explicitStatus && Object.values(JOB_STATUS).includes(explicitStatus)) return explicitStatus;
  if (extractionStatus === EXTRACTION_STATUS.FAILED) return JOB_STATUS.UNAVAILABLE;
  const days = daysUntil(deadline, now);
  if (days != null && days < 0) return JOB_STATUS.EXPIRED;
  if (extractionStatus === EXTRACTION_STATUS.NEEDS_REVIEW || applyType === "needs_manual_review") {
    return JOB_STATUS.NEEDS_VERIFICATION;
  }
  if (days != null && days <= 7) return JOB_STATUS.CLOSING_SOON;
  return JOB_STATUS.OPEN;
}

function sourceDomainOf(source) {
  if (!source) return "";
  for (const raw of [source.base_url, source.listing_url]) {
    try {
      return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function isSourceUrl(url, source) {
  if (!url) return false;
  if (isSourceHost(url)) return true;
  const host = hostOf(url);
  const domain = sourceDomainOf(source);
  return !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));
}

/**
 * Validate an extracted job. Returns normalised fields plus review flags.
 * The input is not mutated.
 */
export function validateExtractedJob(job, { source = null, now = new Date() } = {}) {
  const errors = [];
  const warnings = [];

  const title = cleanValue(job?.title, 300);
  if (!title || title.length < 3) errors.push("missing_title");
  else if (title.length > 220) warnings.push("title_too_long");

  const description = cleanValue(job?.description, 50000);
  const descriptionHtml = cleanValue(job?.descriptionHtml, 200000);
  const descriptionLength = (description || "").length;
  if (!description && !descriptionHtml) errors.push("missing_description");
  else if (descriptionLength > 0 && descriptionLength < 120) warnings.push("short_description");

  let company = cleanValue(job?.company, 200);
  if (!company || company.toLowerCase() === String(source?.name || "").toLowerCase() || isSourceUrl(job?.organizationWebsite, source)) {
    company = UNVERIFIED_ORGANIZATION;
  }
  const organizationVerified = !!job?.organizationVerified && company !== UNVERIFIED_ORGANIZATION;
  if (!organizationVerified) warnings.push("organization_unverified");

  const deadline = toDate(job?.deadline);
  if (job?.deadline && !deadline) warnings.push("invalid_deadline");
  const postedDate = toDate(job?.postedDate);

  let applyUrl = cleanValue(job?.applyUrl, 2000);
  let applyUrlType = cleanValue(job?.applyUrlType, 40);
  let applyConfidence = Number.isFinite(Number(job?.applyConfidence)) ? Math.max(0, Math.min(100, Number(job.applyConfidence))) : 0;
  let applyReason = cleanValue(job?.applyReason, 200);
  if (applyUrl) {
    const dest = classifyDestination(applyUrl, { source, pageUrl: job?.canonicalJobUrl || "", employerName: company });
    if (!dest.valid || dest.type === APPLY_URL_TYPES.SOURCE || dest.type === APPLY_URL_TYPES.LISTING) {
      warnings.push("invalid_apply_url");
      applyReason = dest.reason || "invalid_destination";
      applyUrl = null;
      applyUrlType = null;
      applyConfidence = 0;
    } else {
      applyUrlType = dest.type;
      // A destination on the board's own domain is only acceptable when it is
      // a per-vacancy application form; a listing or index page is not.
      if (isSourceUrl(applyUrl, source) && dest.type !== APPLY_URL_TYPES.SOURCE_APPLICATION) {
        warnings.push("apply_url_is_source");
        applyUrl = null;
        applyUrlType = null;
        applyConfidence = 0;
      }
    }
  } else {
    warnings.push("missing_apply_url");
  }

  const applicationEmail = cleanValue(job?.applicationEmail, 320);
  if (applicationEmail && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(applicationEmail)) {
    warnings.push("invalid_application_email");
  }

  const unavailable = !!job?.unavailable || detectUnavailablePage(job?.pageText || description || "");
  if (unavailable) warnings.push("page_reports_unavailable");

  const expired = deadline ? daysUntil(deadline, now) < 0 : false;
  if (expired) warnings.push("deadline_passed");

  let extractionStatus = job?.extractionStatus || EXTRACTION_STATUS.VERIFIED;
  if (unavailable) extractionStatus = EXTRACTION_STATUS.FAILED;
  else if (errors.length) extractionStatus = EXTRACTION_STATUS.FAILED;
  else if (warnings.includes("organization_unverified") || warnings.includes("missing_apply_url") || warnings.includes("invalid_apply_url") || warnings.includes("short_description")) {
    extractionStatus = EXTRACTION_STATUS.NEEDS_REVIEW;
  } else if (job?.partial) {
    extractionStatus = EXTRACTION_STATUS.PARTIAL;
  }

  const needsReview = extractionStatus === EXTRACTION_STATUS.NEEDS_REVIEW || extractionStatus === EXTRACTION_STATUS.FAILED;
  const jobStatus = computeJobStatus({
    deadline,
    extractionStatus,
    applyType: applyUrl ? applyUrlType : "needs_manual_review",
    explicitStatus: unavailable ? JOB_STATUS.UNAVAILABLE : null,
    now,
  });

  let qualityScore = 100;
  if (!description || descriptionLength < 120) qualityScore -= 20;
  if (!descriptionHtml) qualityScore -= 5;
  if (!organizationVerified) qualityScore -= 20;
  if (!applyUrl) qualityScore -= 25;
  if (warnings.includes("invalid_apply_url")) qualityScore -= 10;
  if (!deadline) qualityScore -= 5;
  if (!postedDate) qualityScore -= 3;
  if (unavailable) qualityScore = 0;
  qualityScore = Math.max(0, Math.min(100, qualityScore));

  return {
    ...job,
    title,
    company,
    organizationVerified,
    description,
    descriptionHtml,
    deadline,
    postedDate,
    applyUrl,
    applyUrlType,
    applyConfidence,
    applyReason,
    applicationEmail,
    extractionStatus,
    jobStatus,
    qualityScore,
    needsReview,
    errors,
    warnings,
  };
}

/**
 * Structured data is only emitted for genuinely open, complete vacancies with a
 * safe application destination. Expired or unverified rows are never eligible.
 */
export function isJsonLdEligible(job, { now = new Date(), source = null } = {}) {
  if (!job) return false;
  if (job.status && job.status !== "active") return false;
  if (job.jobStatus && job.jobStatus !== JOB_STATUS.OPEN && job.jobStatus !== JOB_STATUS.CLOSING_SOON) return false;
  if (job.extractionStatus && job.extractionStatus !== EXTRACTION_STATUS.VERIFIED && job.extractionStatus !== EXTRACTION_STATUS.PARTIAL) return false;
  if (job.deadline && daysUntil(job.deadline, now) < 0) return false;
  if (!job.title || !job.company || job.company === UNVERIFIED_ORGANIZATION) return false;
  if (!job.applyUrl && !job.applicationEmail) return false;
  if (job.applyUrl) {
    if (!isPubliclySafeApplyUrl(job.applyUrl, { source })) return false;
    if (isSourceUrl(job.applyUrl, source)) return false;
  }
  return true;
}
