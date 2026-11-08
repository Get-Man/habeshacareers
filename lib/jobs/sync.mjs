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
    summary.fetched_count = jobs.length;
    for (const job of jobs) {
      try {
        const r = await upsertAggregatedJob(source, job);
        if (r.action === 'new') summary.new_count++;
        else if (r.action === 'updated') summary.updated_count++;
        else if (r.action === 'duplicate' || r.action === 'skipped') summary.duplicate_count++;
      } catch (e) {
        summary.error_count++;
      }
    }
    summary.expired_count = await markExpiredJobs().catch(() => 0);
    await query(`update job_sources set last_sync_at=now(), last_error=null, integration_status='connected', updated_at=now() where id=$1`, [source.id]);
    await finishSyncRun(run.id, { ...summary, status: summary.error_count ? 'partial' : 'ok', message: `Fetched ${summary.fetched_count}` });
    return { ok: true, runId: run.id, ...summary };
  } catch (e) {
    await query(`update job_sources set last_sync_at=now(), last_error=$2, integration_status='error', updated_at=now() where id=$1`, [source.id, String(e.message || e)]);
    await finishSyncRun(run.id, { ...summary, status: 'error', message: String(e.message || e) });
    return { ok: false, runId: run.id, error: String(e.message || e), ...summary };
  }
}

export async function syncEnabledSources(triggerType = 'manual', maxSources = 5) {
  const sources = await query(`select slug from job_sources where enabled=true order by coalesce(last_sync_at, 'epoch'::timestamptz) asc limit $1`, [maxSources]);
  const results = [];
  for (const s of sources) results.push({ slug: s.slug, ...(await syncSourceBySlug(s.slug, triggerType)) });
  const expired = await markExpiredJobs().catch(() => 0);
  return { results, expired };
}
