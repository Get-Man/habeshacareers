import { query } from '../db.mjs';
import { getConnectorForSource } from './connectors/index.mjs';
import { createSyncRun, finishSyncRun, markExpiredJobs, upsertAggregatedJob } from './repository.mjs';

export async function syncSourceBySlug(slug, triggerType = 'manual') {
  const rows = await query('select * from job_sources where slug=$1', [slug]);
  const source = rows[0];
  if (!source) throw new Error('Source not found');
  if (!source.enabled) return { skipped: true, reason: 'disabled' };
  const connector = getConnectorForSource(source);
  if (!connector) return { skipped: true, reason: 'no_connector', status: 'unsupported', note: 'No automated connector implemented/permitted for this source. For RSS/Atom/JSON feeds you are authorized to use, set source type/feed config and retry.' };

  const run = await createSyncRun({ source_id: source.id, trigger_type: triggerType });
  const summary = { fetched_count: 0, new_count: 0, updated_count: 0, duplicate_count: 0, error_count: 0, expired_count: 0, details: {} };
  try {
    const jobs = await connector.fetchJobs(source);
    const progress = jobs && jobs.progress ? jobs.progress : null;
    summary.fetched_count = Array.isArray(jobs) ? jobs.length : 0;
    if (progress) summary.details.progress = progress;
    for (const raw of (Array.isArray(jobs) ? jobs : [])) {
      try {
        const out = await upsertAggregatedJob(source, raw);
        if (out.action === 'new') summary.new_count++;
        else if (out.action === 'updated') summary.updated_count++;
        else if (out.action === 'duplicate') summary.duplicate_count++;
        else if (out.action === 'skipped') summary.error_count++;
      } catch (e) {
        summary.error_count++;
      }
    }
    summary.expired_count = await markExpiredJobs();
    // Persist connector progress (batched sitemap backfill) so repeated syncs/cron can reach 100+ compliantly.
    let nextFetchConfig = source.fetch_config && typeof source.fetch_config === 'object' ? { ...source.fetch_config } : null;
    if (progress && nextFetchConfig) {
      if (typeof progress.nextOffset === 'number') nextFetchConfig.offset = progress.nextOffset;
      if (typeof progress.totalFound === 'number') nextFetchConfig.totalFound = progress.totalFound;
      nextFetchConfig.backfillDone = !!progress.done;
      nextFetchConfig.lastBatchAt = new Date().toISOString();
      if (progress.done) nextFetchConfig.lastBackfillCompletedAt = new Date().toISOString();
    }
    await query(
      `update job_sources
          set last_sync_at=now(),
              last_error=null,
              integration_status=case when integration_status='pending' then 'connected' else integration_status end,
              fetch_config = coalesce($2::jsonb, fetch_config),
              updated_at=now()
        where id=$1`,
      [source.id, nextFetchConfig ? JSON.stringify(nextFetchConfig) : null]
    );
    await finishSyncRun(run.id, { ...summary, status: 'ok' });
    return { ok: true, runId: String(run.id), ...(progress ? { progress } : {}), ...summary };
  } catch (e) {
    await query(`update job_sources set last_error=$2, integration_status='error', updated_at=now() where id=$1`, [source.id, String(e.message || e).slice(0, 1000)]);
    await finishSyncRun(run.id, { ...summary, status: 'error', message: String(e.message || e) });
    return { ok: false, runId: String(run.id), error: String(e.message || e), ...summary };
  }
}

export async function syncEnabledSources(triggerType = 'cron', max = 5) {
  const sources = await query(`select slug from job_sources where enabled=true and integration_status not in ('unsupported','blocked') order by last_sync_at asc nulls first limit $1`, [max]);
  const results = [];
  for (const s of sources) results.push({ slug: s.slug, ...(await syncSourceBySlug(s.slug, triggerType)) });
  return { count: results.length, results };
}
