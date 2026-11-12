// Source synchronization orchestration.
//
// Preferred path: the two-stage extraction engine (discover individual vacancy
// URLs from a listing surface, then open and verify each announcement). Legacy
// connectors remain as a fallback for sources without a discovery adapter so
// existing catalog coverage is preserved.
import { query } from "../db.mjs";
import { getConnectorForSource } from "./connectors/index.mjs";
import {
  createSyncRun,
  finishSyncRun,
  markExpiredJobs,
  upsertAggregatedJob,
  upsertExtractedJob,
} from "./repository.mjs";
import { refreshJobLifecycle, runExtractionBatch, runSourcePipeline } from "./extract/engine.mjs";

function emptySummary() {
  return {
    fetched_count: 0,
    new_count: 0,
    updated_count: 0,
    duplicate_count: 0,
    error_count: 0,
    expired_count: 0,
    discovered_count: 0,
    extracted_count: 0,
    apply_found_count: 0,
    needs_review_count: 0,
    details: {},
  };
}

function mapEngineSummary(result = {}) {
  return {
    fetched_count: result.discovered || 0,
    discovered_count: result.discovered || 0,
    extracted_count: result.extracted || 0,
    new_count: result.new || 0,
    updated_count: result.updated || 0,
    duplicate_count: result.duplicate || 0,
    error_count: result.failed || 0,
    apply_found_count: result.applyFound || 0,
    needs_review_count: result.needsReview || 0,
    details: {
      mode: result.mode || null,
      adapter: result.adapter || null,
      totalFound: result.totalFound ?? null,
      queued: result.queued || 0,
      queuedDuplicates: result.queuedDuplicates || 0,
      skipped: result.skipped || 0,
      errors: Array.isArray(result.errors) ? result.errors : [],
    },
  };
}

async function touchSource(sourceId, { error = null, progress = null, nextConfig = null } = {}) {
  const sets = [
    "last_sync_at = now()",
    "updated_at = now()",
    "last_error = $2",
    "integration_status = case when $2 is null and integration_status in ('pending','error') then 'connected' else integration_status end",
  ];
  const vals = [sourceId, error ? String(error).slice(0, 1000) : null];
  if (nextConfig) {
    vals.push(JSON.stringify(nextConfig));
    sets.push(`fetch_config = $${vals.length}::jsonb`);
  }
  await query(`update job_sources set ${sets.join(", ")} where id = $1`, vals);
  return progress;
}

async function legacySync(source, run, triggerType) {
  const connector = getConnectorForSource(source);
  if (!connector) {
    return {
      skipped: true,
      reason: "no_connector",
      status: "unsupported",
      note: "No automated connector or discovery adapter is available for this source.",
    };
  }

  const summary = emptySummary();
  const jobs = await connector.fetchJobs(source);
  const progress = jobs && jobs.progress ? jobs.progress : null;
  summary.fetched_count = Array.isArray(jobs) ? jobs.length : 0;
  if (progress) summary.details.progress = progress;

  for (const raw of Array.isArray(jobs) ? jobs : []) {
    try {
      const out = await upsertAggregatedJob(source, raw);
      if (out.action === "new") summary.new_count++;
      else if (out.action === "updated") summary.updated_count++;
      else if (out.action === "duplicate") summary.duplicate_count++;
      else summary.error_count++;
    } catch {
      summary.error_count++;
    }
  }

  // Persist connector progress (batched sitemap backfill) so repeated runs drain
  // the catalog in bounded serverless batches.
  let nextFetchConfig = source.fetch_config && typeof source.fetch_config === "object" ? { ...source.fetch_config } : null;
  if (progress && nextFetchConfig) {
    if (typeof progress.nextOffset === "number") nextFetchConfig.offset = progress.nextOffset;
    if (typeof progress.totalFound === "number") nextFetchConfig.totalFound = progress.totalFound;
    nextFetchConfig.backfillDone = !!progress.done;
    nextFetchConfig.lastBatchAt = new Date().toISOString();
    if (progress.done) nextFetchConfig.lastBackfillCompletedAt = new Date().toISOString();
  }
  await touchSource(source.id, { nextConfig: nextFetchConfig });
  summary.expired_count = await markExpiredJobs();
  await finishSyncRun(run.id, { ...summary, status: "ok" });
  return { ok: true, runId: String(run.id), engine: "legacy", ...(progress ? { progress } : {}), ...summary };
}

/**
 * Synchronize one source.
 *
 * The engine runs first; legacy connectors only run when no discovery adapter
 * exists. Overlapping runs are prevented by a database-backed source lock.
 */
export async function syncSourceBySlug(slug, triggerType = "manual", options = {}) {
  const rows = await query("select * from job_sources where slug=$1", [slug]);
  const source = rows[0];
  if (!source) throw new Error("Source not found");
  if (!source.enabled) return { skipped: true, reason: "disabled" };

  const run = await createSyncRun({ source_id: source.id, trigger_type: triggerType });
  const started = Date.now();
  const summary = emptySummary();
  try {
    const engineResult = await runSourcePipeline(source, {
      ...options,
      upsert: upsertExtractedJob,
    });

    if (engineResult && engineResult.skipped && engineResult.reason === "no_adapter") {
      return await legacySync(source, run, triggerType);
    }

    if (engineResult && engineResult.skipped && engineResult.reason === "locked") {
      await finishSyncRun(run.id, {
        ...summary,
        status: "partial",
        message: "another sync is already running for this source",
        duration_ms: Date.now() - started,
      });
      return { ok: true, skipped: true, reason: "locked", runId: String(run.id) };
    }

    Object.assign(summary, mapEngineSummary(engineResult));
    const lifecycle = await refreshJobLifecycle();
    summary.expired_count = lifecycle.expired || 0;
    summary.details.lifecycle = lifecycle;
    await touchSource(source.id);
    await finishSyncRun(run.id, { ...summary, status: "ok", duration_ms: Date.now() - started });
    return {
      ok: true,
      runId: String(run.id),
      engine: "two-stage",
      ...(engineResult?.progress ? { progress: engineResult.progress } : {}),
      ...summary,
    };
  } catch (e) {
    await touchSource(source.id, { error: e.message || e }).catch(() => null);
    await finishSyncRun(run.id, {
      ...summary,
      status: "error",
      message: String(e.message || e),
      duration_ms: Date.now() - started,
    }).catch(() => null);
    return { ok: false, runId: String(run.id), error: String(e.message || e), ...summary };
  }
}

export async function syncEnabledSources(triggerType = "cron", max = 5, options = {}) {
  const sources = await query(
    `select slug from job_sources
      where enabled=true
        and integration_status not in ('unsupported','blocked')
      order by last_sync_at asc nulls first
      limit $1`,
    [Math.max(1, Math.min(20, parseInt(max, 10) || 5))]
  );
  const results = [];
  for (const s of sources) {
    results.push({ slug: s.slug, ...(await syncSourceBySlug(s.slug, triggerType, options)) });
  }
  return { count: results.length, results };
}

/**
 * Drain the shared extraction queue without a new discovery pass. This is the
 * cron-friendly path that makes steady progress without overlapping runs.
 */
export async function runQueuedExtraction(triggerType = "cron", options = {}) {
  const run = await createSyncRun({ source_id: null, trigger_type: triggerType });
  const started = Date.now();
  const summary = emptySummary();
  try {
    const result = await runExtractionBatch({ ...options, upsert: upsertExtractedJob });
    if (result?.skipped && result.reason === "locked") {
      await finishSyncRun(run.id, {
        ...summary,
        status: "partial",
        message: "another extraction batch is already running",
        duration_ms: Date.now() - started,
      });
      return { ok: true, skipped: true, reason: "locked", runId: String(run.id) };
    }
    summary.fetched_count = result.claimed || 0;
    summary.discovered_count = result.claimed || 0;
    summary.extracted_count = result.extracted || 0;
    summary.new_count = result.new || 0;
    summary.updated_count = result.updated || 0;
    summary.duplicate_count = result.duplicate || 0;
    summary.error_count = result.failed || 0;
    summary.apply_found_count = result.applyFound || 0;
    summary.needs_review_count = result.needsReview || 0;
    summary.details = { skipped: result.skipped || 0, errors: result.errors || [] };
    const lifecycle = await refreshJobLifecycle();
    summary.expired_count = lifecycle.expired || 0;
    summary.details.lifecycle = lifecycle;
    await finishSyncRun(run.id, { ...summary, status: "ok", duration_ms: Date.now() - started });
    return { ok: true, runId: String(run.id), engine: "two-stage", ...summary };
  } catch (e) {
    await finishSyncRun(run.id, {
      ...summary,
      status: "error",
      message: String(e.message || e),
      duration_ms: Date.now() - started,
    }).catch(() => null);
    return { ok: false, runId: String(run.id), error: String(e.message || e), ...summary };
  }
}
