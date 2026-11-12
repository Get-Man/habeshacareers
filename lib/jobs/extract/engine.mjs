// Two-stage extraction engine.
//
// Stage A (discovery) only finds individual vacancy URLs from a source's
// listing surface. Stage B opens each individual announcement, verifies the
// destination, extracts the vacancy and saves it through the repository.
//
// The engine is server-only. It is intentionally dependency-injected at the
// module boundary (query/withClient come from ../db.mjs) so the pure extraction
// helpers can be unit-tested without a database.

import { randomUUID } from "node:crypto";
import { query } from "../../db.mjs";
import { discoverSource, getAdapter } from "../sources/adapters.mjs";
import { fetchText, fetchJson, checkDestination } from "./http.mjs";
import { extractJobFromPage } from "./job.mjs";
import { validateExtractedJob, EXTRACTION_STATUS, JOB_STATUS } from "./validate.mjs";
import { APPLY_URL_TYPES } from "./apply-link.mjs";
import { resolveEmployerIdentity } from "./employer-resolver.mjs";
import { employerKey } from "./employer-logo.mjs";
import { extractFromStructuredJob } from "./structured.mjs";
import { getEmployerDirectoryEntry } from "../repository.mjs";
import { extractDerejaRecords } from "../sources/dereja.mjs";

export const ENGINE_DEFAULTS = {
  discoveryLimit: 12,
  extractionBatch: 8,
  concurrency: 3,
  maxAttempts: 3,
  lockTtlSeconds: 300,
  fetchTimeoutMs: 15000,
  maxBytes: 4_000_000,
  verifyApply: true,
  verifyTimeoutMs: 7000,
};

const SOURCE_SELECT =
  "select id, slug, name, base_url, listing_url, source_type, enabled, integration_status, fetch_config, adapter_key from job_sources";

function nowMs() {
  return Date.now();
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bounded(value, min, max, fallback) {
  return Math.min(max, Math.max(min, int(value, fallback)));
}

export function normalizeEngineOptions(options = {}) {
  return {
    ...ENGINE_DEFAULTS,
    ...options,
    discoveryLimit: bounded(options.discoveryLimit, 1, 50, ENGINE_DEFAULTS.discoveryLimit),
    extractionBatch: bounded(options.extractionBatch, 1, 40, ENGINE_DEFAULTS.extractionBatch),
    concurrency: bounded(options.concurrency, 1, 8, ENGINE_DEFAULTS.concurrency),
    maxAttempts: bounded(options.maxAttempts, 1, 8, ENGINE_DEFAULTS.maxAttempts),
    lockTtlSeconds: bounded(options.lockTtlSeconds, 30, 900, ENGINE_DEFAULTS.lockTtlSeconds),
    fetchTimeoutMs: bounded(options.fetchTimeoutMs, 3000, 30000, ENGINE_DEFAULTS.fetchTimeoutMs),
  };
}

// ---------------------------------------------------------------------------
// Cooperative locks (serverless-safe: no long-lived process state)
// ---------------------------------------------------------------------------

export async function acquireLock(lockKey, { owner = randomUUID(), ttlSeconds = 300 } = {}) {
  const rows = await query(
    `insert into job_sync_locks (lock_key, owner, expires_at)
     values ($1, $2, now() + ($3::text || ' seconds')::interval)
     on conflict (lock_key) do update
       set owner = excluded.owner,
           locked_at = now(),
           expires_at = excluded.expires_at
       where job_sync_locks.expires_at < now()
          or job_sync_locks.owner = excluded.owner
     returning lock_key`,
    [lockKey, owner, String(ttlSeconds)]
  );
  return rows.length > 0;
}

export async function releaseLock(lockKey, owner) {
  if (!lockKey || !owner) return false;
  const rows = await query(
    `delete from job_sync_locks where lock_key=$1 and owner=$2 returning lock_key`,
    [lockKey, owner]
  );
  return rows.length > 0;
}

export async function listActiveLocks() {
  return query(`select lock_key, owner, locked_at, expires_at from job_sync_locks order by locked_at desc`);
}

// ---------------------------------------------------------------------------
// Discovery queue
// ---------------------------------------------------------------------------

export async function enqueueDiscovered(sourceId, items = [], { listingPageUrl = null } = {}) {
  let queued = 0;
  let duplicates = 0;
  for (const item of items) {
    const url = typeof item === "string" ? item : item?.url;
    if (!url) continue;
    const listing = (typeof item === "object" && item?.listingPageUrl) || listingPageUrl || null;
    const rows = await query(
      `insert into job_discovery_queue (source_id, listing_page_url, discovered_url, canonical_url, status)
       values ($1, $2, $3, $3, 'pending')
       on conflict (source_id, discovered_url) do nothing
       returning id`,
      [sourceId, listing, url]
    );
    if (rows.length) queued += 1;
    else duplicates += 1;
  }
  return { queued, duplicates };
}

export async function claimQueueBatch({ sourceId = null, limit = 8, maxAttempts = 3 } = {}) {
  const vals = [String(limit), String(maxAttempts)];
  let filter = "";
  if (sourceId != null) {
    vals.push(String(sourceId));
    filter = `and source_id = $${vals.length}::bigint`;
  }
  return query(
    `with claimed as (
       select id
         from job_discovery_queue
        where status in ('pending', 'failed')
          and next_attempt_at <= now()
          and attempts < $2::int
          ${filter}
        order by next_attempt_at asc, id asc
        limit $1::int
        for update skip locked
     )
     update job_discovery_queue q
        set status = 'extracting', attempts = q.attempts + 1, last_error = null
       from claimed
      where q.id = claimed.id
      returning q.*`,
    vals
  );
}

export async function finishQueueItem(id, { status, listingId = null, error = null } = {}) {
  const allowed = new Set(["pending", "extracting", "extracted", "failed", "skipped", "duplicate"]);
  const nextStatus = allowed.has(status) ? status : "failed";
  return query(
    `update job_discovery_queue
        set status = $2,
            last_error = $3,
            listing_id = coalesce($4::bigint, listing_id),
            extracted_at = case when $2 = 'extracted' then now() else extracted_at end,
            next_attempt_at = case
              when $2 = 'failed' then now() + (least(attempts, 6) * interval '5 minutes')
              else now()
            end
      where id = $1
      returning *`,
    [id, nextStatus, error ? String(error).slice(0, 1000) : null, listingId]
  );
}

export async function requeueFailed({ sourceId = null, ids = null, limit = 50 } = {}) {
  const vals = [String(bounded(limit, 1, 500, 50))];
  const filters = [`status = 'failed'`];
  if (sourceId != null) {
    vals.push(String(sourceId));
    filters.push(`source_id = $${vals.length}::bigint`);
  }
  if (Array.isArray(ids) && ids.length) {
    vals.push(ids.map((n) => int(n, 0)).filter(Boolean));
    filters.push(`id = any($${vals.length}::bigint[])`);
  }
  const rows = await query(
    `update job_discovery_queue
        set status = 'pending', attempts = 0, last_error = null, next_attempt_at = now()
      where id in (
        select id from job_discovery_queue
         where ${filters.join(" and ")}
         order by id asc
         limit $1::int
      )
      returning id`,
    vals
  );
  return rows.length;
}

export async function queueStats(sourceId = null) {
  const vals = [];
  let filter = "";
  if (sourceId != null) {
    vals.push(String(sourceId));
    filter = `where source_id = $1::bigint`;
  }
  const rows = await query(
    `select status, count(*)::int as n,
            count(*) filter (where attempts > 0)::int as retried,
            max(attempts)::int as max_attempts
       from job_discovery_queue ${filter}
      group by status`,
    vals
  );
  const out = { pending: 0, extracting: 0, extracted: 0, failed: 0, skipped: 0, duplicate: 0, total: 0 };
  for (const row of rows) {
    out[row.status] = row.n;
    out.total += row.n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage B: extract + verify one queue item
// ---------------------------------------------------------------------------

async function verifyApplyDestination(job, { source, options }) {
  if (!options.verifyApply) return job;
  if (job.applyUrlType === APPLY_URL_TYPES.EMAIL) {
    return { ...job, applyUrlVerified: !!job.applicationEmail, applyUrlCheckedAt: new Date().toISOString() };
  }
  if (!job.applyUrl) return { ...job, applyUrlVerified: false };

  const check = await checkDestination(job.applyUrl, {
    timeoutMs: options.verifyTimeoutMs,
    retries: 0,
    respectRobots: false,
  });

  if (check.ok) {
    return {
      ...job,
      applyUrl: check.finalUrl || job.applyUrl,
      applyUrlFinalUrl: check.finalUrl || job.applyUrl,
      applyUrlVerified: true,
      applyUrlCheckedAt: new Date().toISOString(),
      applyUrlReason: job.applyReason || null,
    };
  }

  // A hard 404/410 means the destination is gone. A transient/blocked response
  // keeps the link but flags it for review instead of inventing a replacement.
  const status = Number(check.status || 0);
  if (status === 404 || status === 410) {
    const patched = {
      ...job,
      applyUrl: null,
      applyUrlType: null,
      applyConfidence: 0,
      applyReason: `destination_${status}`,
      applyUrlVerified: false,
      applyUrlCheckedAt: new Date().toISOString(),
    };
    return validateExtractedJob(patched, { source });
  }

  return {
    ...job,
    applyUrlVerified: false,
    applyUrlCheckedAt: new Date().toISOString(),
    applyUrlReason: check.error || `destination_http_${status || "unreachable"}`,
  };
}

export async function extractQueueItem(item, source, options = {}) {
  const opts = normalizeEngineOptions(options);
  const started = nowMs();
  const fetched = await fetchText(item.discovered_url, {
    timeoutMs: opts.fetchTimeoutMs,
    maxBytes: opts.maxBytes,
    respectRobots: true,
    retries: 1,
  });
  if (!fetched.ok) {
    const error = new Error(fetched.error || `http_${fetched.status || 0}`);
    error.status = fetched.status;
    throw error;
  }

  const pageUrl = fetched.url || item.discovered_url;
  const extracted = await extractAnnouncement(fetched.text, {
    pageUrl,
    listingPageUrl: item.listing_page_url || null,
    source,
    fetchedAt: new Date(),
  });
  if (!extracted) throw new Error("no_extractable_content");

  const verified = await verifyApplyDestination(extracted, { source, options: opts });

  // Resolve the organisation's OFFICIAL logo. The employer's own website is
  // fetched and checked; the publishing job board's logo is never used.
  const employer = await resolveEmployerLogoForJob(verified, source, opts);

  return {
    ...verified,
    ...employer,
    extractionDurationMs: nowMs() - started,
    httpStatus: fetched.status,
  };
}

/**
 * Extract a vacancy from a fetched announcement page.
 *
 * Standard HTML pages use the HTML extractor. Client-rendered sources publish
 * their records in a streamed RSC payload, which is parsed instead.
 */
async function extractAnnouncement(html, { pageUrl, listingPageUrl, source, fetchedAt }) {
  const adapterKey = String(source?.adapter_key || source?.slug || "").toLowerCase();
  if (adapterKey === "dereja" || /dereja/i.test(String(source?.base_url || ""))) {
    const structured = await extractDerejaAnnouncement(html, { pageUrl, source, fetchedAt });
    if (structured) return structured;
  }
  return extractJobFromPage({ html, pageUrl, listingPageUrl, source, fetchedAt });
}

async function extractDerejaAnnouncement(html, { pageUrl, source, fetchedAt }) {
  const records = extractDerejaRecords(html);
  if (!records.length) return null;
  const slug = String(pageUrl || "").split("/").filter(Boolean).pop();
  const match = records.find((r) => r.slug === slug) || records[0];
  if (!match) return null;
  const built = extractFromStructuredJob(match, { pageUrl, source, fetchedAt });
  if (!built) return null;
  return { ...built, listingPageUrl: null };
}

/**
 * Resolve and persist the employer identity for one extracted vacancy.
 *
 * The organisation's directory entry is reused when it already carries a
 * verified logo, so every vacancy of the same organisation shows the same
 * official logo no matter which job board it was found on.
 */
async function resolveEmployerLogoForJob(job, source, opts) {
  if (!job?.company || job.company === "Organization not verified") {
    return { organizationLogo: null, organizationLogoVerified: false, employerId: null };
  }
  try {
    const key = employerKey(job.company);
    const known = key ? await getEmployerDirectoryEntry(key) : null;

    const identity = await resolveEmployerIdentity({
      html: job.pageHtml || "",
      jsonLd: job.pageJsonLd || null,
      meta: job.pageMeta || null,
      pageUrl: job.canonicalJobUrl || job.originalJobUrl || "",
      source,
      applyUrl: job.applyUrl || null,
      employerName: job.company,
      knownEmployer: known,
      fetchText,
      options: {
        verifyEmployerLogo: opts.verifyEmployerLogo !== false,
        employerTimeoutMs: opts.employerTimeoutMs || 9000,
        respectRobots: true,
      },
    });

    return {
      organizationLogo: identity.logoUrl,
      organizationLogoVerified: identity.logoVerified,
      organizationLogoKind: identity.logoKind,
      organizationLogoSource: identity.logoSource,
      organizationLogoConfidence: identity.logoConfidence,
      organizationLogoPublishable: identity.logoPublishable,
      organizationWebsite: identity.websiteUrl || job.organizationWebsite || null,
      employerNameKey: identity.key || key || null,
      employerId: known?.id || null,
    };
  } catch {
    return { organizationLogo: null, organizationLogoVerified: false, employerId: null };
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function loadSource(sourceId) {
  const rows = await query(`${SOURCE_SELECT} where id=$1`, [sourceId]);
  return rows[0] || null;
}

export async function processQueueBatch({ sourceId = null, limit = 8, concurrency = 3, maxAttempts = 3, options = {}, upsert } = {}) {
  const opts = normalizeEngineOptions({ ...options, concurrency, maxAttempts });
  if (typeof upsert !== "function") throw new Error("processQueueBatch_requires_upsert");
  const claimed = await claimQueueBatch({ sourceId, limit, maxAttempts: opts.maxAttempts });
  if (!claimed.length) {
    return { claimed: 0, extracted: 0, new: 0, updated: 0, duplicate: 0, skipped: 0, failed: 0, needsReview: 0, applyFound: 0, errors: [] };
  }

  const sourceCache = new Map();
  const getSource = async (id) => {
    if (sourceCache.has(id)) return sourceCache.get(id);
    const s = await loadSource(id);
    sourceCache.set(id, s);
    return s;
  };

  const summary = { claimed: claimed.length, extracted: 0, new: 0, updated: 0, duplicate: 0, skipped: 0, failed: 0, needsReview: 0, applyFound: 0, errors: [] };

  await mapLimit(claimed, opts.concurrency, async (item) => {
    const source = await getSource(item.source_id);
    if (!source) {
      await finishQueueItem(item.id, { status: "skipped", error: "source_missing" });
      summary.skipped += 1;
      return;
    }
    try {
      const job = await extractQueueItem(item, source, opts);
      if (job.extractionStatus === EXTRACTION_STATUS.FAILED || job.unavailable) {
        await finishQueueItem(item.id, { status: "skipped", error: job.errors?.join(",") || "unavailable" });
        summary.skipped += 1;
        return;
      }
      if (!job.title) {
        await finishQueueItem(item.id, { status: "failed", error: "missing_title" });
        summary.failed += 1;
        return;
      }
      const saved = await upsert(source, job, { queueItem: item });
      summary.extracted += 1;
      if (saved.action === "new") summary.new += 1;
      else if (saved.action === "updated") summary.updated += 1;
      else if (saved.action === "duplicate") summary.duplicate += 1;
      else summary.skipped += 1;
      if (job.applyUrl || job.applicationEmail) summary.applyFound += 1;
      if (job.needsReview || saved.needsReview) summary.needsReview += 1;
      await finishQueueItem(item.id, {
        status: saved.action === "duplicate" ? "duplicate" : "extracted",
        listingId: saved.id || null,
      });
    } catch (error) {
      summary.failed += 1;
      if (summary.errors.length < 8) summary.errors.push(String(error.message || error).slice(0, 300));
      await finishQueueItem(item.id, { status: "failed", error: String(error.message || error) });
    }
  });

  return summary;
}

async function persistDiscoveryCursor(source, result) {
  const config = source?.fetch_config && typeof source.fetch_config === "object" ? { ...source.fetch_config } : {};
  if (typeof result?.nextOffset === "number") config.offset = result.nextOffset;
  if (typeof result?.totalFound === "number") config.totalFound = result.totalFound;
  config.backfillDone = !!result?.done;
  config.lastBatchAt = new Date().toISOString();
  if (result?.done) config.lastBackfillCompletedAt = new Date().toISOString();
  await query(
    `update job_sources
        set last_discovery_at = now(),
            last_error = null,
            integration_status = case when integration_status in ('pending', 'error') then 'connected' else integration_status end,
            fetch_config = $2::jsonb,
            updated_at = now()
      where id = $1`,
    [source.id, JSON.stringify(config)]
  );
}

/**
 * Run the complete two-stage pipeline for one source.
 *
 * @param {object} source job_sources row
 * @param {object} [options]
 * @param {Function} upsert repository upsert function (required)
 */
export async function runSourcePipeline(source, options = {}) {
  const opts = normalizeEngineOptions(options);
  const upsert = options.upsert;
  if (typeof upsert !== "function") throw new Error("runSourcePipeline_requires_upsert");
  const adapter = getAdapter(source);
  if (!adapter) {
    return { skipped: true, reason: "no_adapter", adapter: null };
  }

  const lockKey = `source:${source.id}`;
  const owner = options.owner || randomUUID();
  const locked = await acquireLock(lockKey, { owner, ttlSeconds: opts.lockTtlSeconds });
  if (!locked) return { skipped: true, reason: "locked", lockKey };

  const summary = {
    adapter: adapter.key,
    discovered: 0,
    queued: 0,
    queuedDuplicates: 0,
    extracted: 0,
    new: 0,
    updated: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    needsReview: 0,
    applyFound: 0,
    errors: [],
  };

  try {
    const config = source?.fetch_config && typeof source.fetch_config === "object" ? source.fetch_config : {};
    const discovery = await discoverSource(source, {
      limit: options.discoveryLimit ?? config.limit ?? opts.discoveryLimit,
      offset: options.offset ?? config.offset ?? 0,
      fetchText,
      fetchJson,
    });

    if (!discovery) return { skipped: true, reason: "no_adapter" };
    summary.discovered = Array.isArray(discovery.urls) ? discovery.urls.length : 0;
    summary.totalFound = discovery.totalFound ?? null;
    summary.mode = discovery.mode || null;

    const enqueued = await enqueueDiscovered(source.id, discovery.urls || [], {
      listingPageUrl: discovery.listingPageUrl || source.listing_url || null,
    });
    summary.queued = enqueued.queued;
    summary.queuedDuplicates = enqueued.duplicates;
    await persistDiscoveryCursor(source, discovery);

    // Stage B: extract a bounded batch. Repeated runs drain the queue.
    const extraction = await processQueueBatch({
      sourceId: source.id,
      limit: options.extractionBatch ?? opts.extractionBatch,
      concurrency: options.concurrency ?? opts.concurrency,
      maxAttempts: opts.maxAttempts,
      options: opts,
      upsert,
    });
    Object.assign(summary, {
      extracted: extraction.extracted,
      new: extraction.new,
      updated: extraction.updated,
      duplicate: extraction.duplicate,
      skipped: extraction.skipped,
      failed: extraction.failed,
      needsReview: extraction.needsReview,
      applyFound: extraction.applyFound,
      errors: extraction.errors,
    });

    return { ok: true, ...summary, progress: { nextOffset: discovery.nextOffset, totalFound: discovery.totalFound, done: discovery.done } };
  } finally {
    await releaseLock(lockKey, owner).catch(() => null);
  }
}

/**
 * Drain queued vacancy URLs across sources (cron-friendly, bounded).
 */
export async function runExtractionBatch(options = {}) {
  const opts = normalizeEngineOptions(options);
  const upsert = options.upsert;
  if (typeof upsert !== "function") throw new Error("runExtractionBatch_requires_upsert");
  const owner = options.owner || randomUUID();
  const lockKey = "extract:global";
  const locked = await acquireLock(lockKey, { owner, ttlSeconds: opts.lockTtlSeconds });
  if (!locked) return { skipped: true, reason: "locked", lockKey };
  try {
    return { ok: true, ...(await processQueueBatch({
      sourceId: options.sourceId ?? null,
      limit: options.extractionBatch ?? opts.extractionBatch,
      concurrency: options.concurrency ?? opts.concurrency,
      maxAttempts: opts.maxAttempts,
      options: opts,
      upsert,
    })) };
  } finally {
    await releaseLock(lockKey, owner).catch(() => null);
  }
}

/**
 * Mark expired vacancies and keep job_status consistent. Never deletes rows.
 */
export async function refreshJobLifecycle() {
  const expired = await query(
    `update job_listings
        set status = 'expired',
            job_status = 'expired',
            updated_at = now()
      where status = 'active'
        and deadline is not null
        and deadline < current_date
      returning id`
  );
  const unavailable = await query(
    `update job_listings
        set job_status = 'unavailable', updated_at = now()
      where job_status is null
        and extraction_status = 'failed'
      returning id`
  );
  return { expired: expired.length, unavailable: unavailable.length };
}

export { JOB_STATUS };
