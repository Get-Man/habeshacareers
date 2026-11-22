#!/usr/bin/env node
/**
 * Deploy-time coverage backfill from the public ETcareers RSS feed.
 * -----------------------------------------------------------------
 *
 * The listing sync discovers cards one page at a time, so an individual
 * vacancy can stay out of the catalogue for a long time. This script closes
 * that gap by turning *every* item in the public feed into a vacancy with the
 * same completeness as an individually enriched one: real employer, full
 * employer-written description, and the employer's own application link.
 *
 * Contract:
 *   - Only https://etcareers.com/jobs.rss is fetched, via `guardedFetch`.
 *     No ETcareers job detail page is ever requested, rendered or navigated to.
 *   - Every write goes through `upsertExtractedJob`, so reruns deduplicate by
 *     source URL / content hash / title + employer + deadline and only fill in
 *     what is missing. Existing good data is never clobbered.
 *   - Nothing about the discovery source is published: no source name, domain,
 *     logo or page link is written to a job-facing field. Employer identity,
 *     logos and application links all come from the employer's own feed text.
 *   - Fail-soft: one bad item cannot fail a deployment.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { hasDatabase, query } from "../lib/db.mjs";
import { upsertExtractedJob } from "../lib/jobs/repository.mjs";
import {
  APPLY_URL_TYPES,
  classifyDestination,
} from "../lib/jobs/extract/apply-link.mjs";
import { EXTRACTION_STATUS } from "../lib/jobs/extract/validate.mjs";
import { toDate } from "../lib/jobs/utils.mjs";
import { Diagnostics } from "./etcareers-scraper.mjs";
import {
  extractFeedItemRecord,
  guardedFetch,
  isForbiddenEtcareersUrl,
  parseRssItems,
} from "./headless-job-fetch.mjs";

const FEED_URL = "https://etcareers.com/jobs.rss";
const SOURCE_SLUG = "etcareers";
const MAX_ITEMS = Number(process.env.ETCAREERS_BACKFILL_LIMIT || 1000);
const DIAGNOSTIC_LIMIT = 8;

// Same rejection list as the existing enrichment: a board/listing/social/image
// link is not the employer's application destination.
const INVALID_APPLY_TYPES = new Set([
  APPLY_URL_TYPES.SOURCE,
  APPLY_URL_TYPES.LISTING,
  APPLY_URL_TYPES.SOCIAL,
  APPLY_URL_TYPES.IMAGE,
  APPLY_URL_TYPES.UNKNOWN,
]);

function short(value, max = 140) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Feed deadlines are plain employer text, not timestamps. Parse the date the
 * employer wrote as a calendar date in UTC, so a server timezone can never
 * shift a deadline into the previous day.
 */
export function feedDate(value) {
  const text = String(value || "").trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1];
  const named = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(text);
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (month) {
      const day = String(Number(named[2])).padStart(2, "0");
      return `${named[3]}-${String(month).padStart(2, "0")}-${day}`;
    }
  }
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/i.exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()];
    if (month) {
      const day = String(Number(dayFirst[1])).padStart(2, "0");
      return `${dayFirst[3]}-${String(month).padStart(2, "0")}-${day}`;
    }
  }
  const numerical = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  if (numerical) {
    return `${numerical[3]}-${String(Number(numerical[1])).padStart(2, "0")}-${String(Number(numerical[2])).padStart(2, "0")}`;
  }
  return toDate(text);
}

/**
 * Pure mapping from one extracted feed record to the repository's job shape.
 * Exported so the mapping can be tested without a database or network.
 */
export function buildBackfillJob(item, record, { source = null, now = new Date() } = {}) {
  if (!record?.title) return null;

  const orgName = record.org_name || null;
  const descriptionHtml = record.description_html || null;
  const description = record.description_text || null;

  const applyCheck = record.direct_apply_url
    ? classifyDestination(record.direct_apply_url, {
        source,
        pageUrl: record.sourceUrl || item?.link || "",
        employerName: orgName || "",
      })
    : null;
  const usableApply =
    applyCheck?.valid && !INVALID_APPLY_TYPES.has(applyCheck.type)
      ? { url: record.direct_apply_url, type: applyCheck.type }
      : null;

  // Never invent a value. A posting without an identified employer is held for
  // review; one missing only its description or application link is partial.
  const complete = Boolean(orgName && description && usableApply);
  const extractionStatus = !orgName
    ? EXTRACTION_STATUS.NEEDS_REVIEW
    : complete
      ? EXTRACTION_STATUS.VERIFIED
      : EXTRACTION_STATUS.PARTIAL;

  const originalJobUrl = record.sourceUrl || item?.link || item?.guid || null;
  const deadline = feedDate(record.deadline);

  return {
    title: record.title,
    company: orgName || "Organization not verified",
    organizationVerified: !!orgName,
    organizationConfidence: orgName ? 92 : 0,
    organizationEvidence: orgName ? "public_feed" : null,

    location: record.location || null,
    regionCity: record.location || null,
    jobType: record.employment_type || null,
    vacancies: null,
    salary: null,
    education: null,
    experience: null,
    skills: [],

    postedDate: record.posted_date || null,
    deadline,
    description,
    descriptionHtml,
    descriptionExcerpt: description ? description.slice(0, 240) : null,
    requirements: null,
    requirementsHtml: null,
    applicationInstructions: usableApply
      ? "Apply using the application link provided in the employer's vacancy announcement."
      : null,
    applicationEmail:
      usableApply?.type === APPLY_URL_TYPES.EMAIL
        ? usableApply.url.slice(7)
        : null,
    contactEmail: null,

    applyUrl: usableApply?.url || null,
    applyUrlType: usableApply?.type || null,
    applyConfidence: usableApply ? 90 : 0,
    applyUrlSource: usableApply ? "rss_feed" : null,
    applyUrlVerified: !!usableApply,
    applyUrlCheckedAt: usableApply ? now.toISOString() : null,
    applyCandidates: usableApply
      ? [{
          url: usableApply.url,
          urlType: usableApply.type,
          confidence: 90,
          source: "rss_feed",
          valid: true,
        }]
      : [],

    listingPageUrl: null,
    originalJobUrl,
    canonicalJobUrl: originalJobUrl,

    // Deliberately null: the source is already linked by primary_source_id and
    // job_listing_sources. No source identity enters any job-facing field.
    sourceDomain: null,
    sourceWebsiteName: null,
    rawCategory: (Array.isArray(item?.categories) ? item.categories : []).join(", ") || null,

    extractionMethod: "public_rss_feed",
    extractionTimestamp: now.toISOString(),
    extractionStatus,
    needsReview: extractionStatus === EXTRACTION_STATUS.NEEDS_REVIEW,
  };
}

/** Extract every feed item into a repository job. Pure apart from the feed text. */
export function collectBackfillJobs(xml, { source = null, now = new Date(), diag } = {}) {
  const items = parseRssItems(xml);
  const jobs = [];
  const samples = [];
  for (const item of items.slice(0, Math.max(1, MAX_ITEMS))) {
    const record = extractFeedItemRecord(item, { diag });
    const job = buildBackfillJob(item, record, { source, now });
    if (!job) continue;
    if (!job.company || job.company === "Organization not verified") {
      if (samples.length < DIAGNOSTIC_LIMIT) samples.push({ title: short(job.title, 100), reason: "no_employer" });
    } else if (!job.applyUrl) {
      if (samples.length < DIAGNOSTIC_LIMIT) samples.push({ title: short(job.title, 100), reason: "no_apply_url" });
    }
    jobs.push(job);
  }
  return { items, jobs, samples };
}

/**
 * Injectable so tests can run the whole loop offline. `fetchXml`, `loadSource`
 * and `upsert` default to the real feed/database implementations.
 */
export async function runBackfill(options = {}) {
  const networkLog = options.networkLog || [];
  const diag = options.diag || new Diagnostics(true);
  const fetchXml = options.fetchXml || (async () => {
    const res = await guardedFetch(FEED_URL, {}, { networkLog, diag });
    if (res.ok === false) throw new Error(`feed HTTP ${res.status}`);
    return res.text();
  });
  const loadSource = options.loadSource || (async () => {
    const rows = await query("select * from job_sources where slug=$1 limit 1", [SOURCE_SLUG]);
    return rows[0] || null;
  });
  const upsert = options.upsert || upsertExtractedJob;

  const source = await loadSource();
  if (!source?.id) return { skipped: "no_source", feedItems: 0 };

  const xml = await fetchXml();
  const { items, jobs, samples } = collectBackfillJobs(xml, { source, diag });

  const stats = {
    feedItems: items.length,
    processed: jobs.length,
    new: 0,
    updated: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    withDescription: jobs.filter((job) => !!job.descriptionHtml).length,
    withApply: jobs.filter((job) => !!job.applyUrl).length,
    heldForReview: jobs.filter((job) => job.needsReview).length,
    samples: [...samples],
    failureSamples: [],
  };

  const now = new Date();
  for (const job of jobs) {
    let phase = "upsert";
    try {
      const result = await upsert(source, job, { now });
      const action = result?.action;
      if (action === "new") stats.new += 1;
      else if (action === "updated") stats.updated += 1;
      else if (action === "duplicate") stats.duplicate += 1;
      else {
        stats.skipped += 1;
        if (stats.samples.length < DIAGNOSTIC_LIMIT) {
          stats.samples.push({ title: short(job.title, 100), reason: result?.reason || "skipped" });
        }
      }
    } catch (error) {
      stats.failed += 1;
      if (stats.failureSamples.length < DIAGNOSTIC_LIMIT) {
        stats.failureSamples.push({
          title: short(job.title, 100),
          phase,
          error: short(error?.message || error, 200),
        });
      }
    }
  }

  const forbidden = networkLog.filter((url) => isForbiddenEtcareersUrl(url));
  if (forbidden.length) {
    throw new Error(`zero-visit guard blocked ${forbidden.length} ETcareers page request(s)`);
  }
  stats.jobPageRequests = 0;
  return stats;
}

export async function main() {
  if (!hasDatabase()) {
    console.log("[backfill-etcareers-feed] no database configured; skipping.");
    return { skipped: "no_database" };
  }
  const stats = await runBackfill();
  if (stats.skipped) {
    console.log(`[backfill-etcareers-feed] skipped: ${stats.skipped}`);
    return stats;
  }
  console.log(
    `[backfill-etcareers-feed] feed ${stats.feedItems} | processed ${stats.processed} | ` +
      `new ${stats.new} | updated ${stats.updated} | duplicate ${stats.duplicate} | ` +
      `skipped ${stats.skipped} | failed ${stats.failed} | with description ${stats.withDescription} | ` +
      `with apply ${stats.withApply} | held for review ${stats.heldForReview} | job page requests ${stats.jobPageRequests}`
  );
  if (stats.samples.length) {
    console.log(`[backfill-etcareers-feed] incomplete samples ${JSON.stringify(stats.samples)}`);
  }
  if (stats.failureSamples.length) {
    console.log(`[backfill-etcareers-feed] failure samples ${JSON.stringify(stats.failureSamples)}`);
  }
  return stats;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    // Fail soft: a deploy must never break because the feed was unavailable.
    console.error(`[backfill-etcareers-feed] ERROR: ${error.message}`);
  }
}

export default runBackfill;
