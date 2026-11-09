-- Raise batch sizes for compliant full-catalog sitemap backfill (staggered-parallel fetches keep
-- each serverless invocation under the runtime cap while fetching more per run). Idempotent; keeps offset.

update job_sources
set
  enabled = true,
  integration_status = case when integration_status in ('unsupported','blocked') then integration_status else 'connected' end,
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'limit', 12,
    'delayMs', 250
  ),
  status_note = 'Compliant batched backfill: public sitemap-detail + public /job-detail JSON-LD pages only (robots allows). Staggered-parallel batches; fetch_config.offset advances after each run. Admin can disable.',
  updated_at = now()
where slug = 'geezjobs';

update job_sources
set
  enabled = true,
  integration_status = case when integration_status in ('unsupported','blocked') then integration_status else 'connected' end,
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'limit', 12,
    'delayMs', 250
  ),
  status_note = 'Compliant batched backfill: public sitemap-jobs.xml + public job pages only (no /api/*). Staggered-parallel batches; fetch_config.offset advances after each run. Admin can disable.',
  updated_at = now()
where slug = 'ethiojobs';

update job_sources
set
  enabled = true,
  integration_status = case when integration_status in ('unsupported','blocked') then integration_status else 'connected' end,
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'limit', 6,
    'delayMs', 350,
    'enrichOfficial', false
  ),
  status_note = 'Compliant batched backfill: public sitemap.xml /jobs/* entries + public job detail pages (robots allows all agents). Staggered-parallel batches; follows official employer application links. fetch_config.offset advances after each run. Admin can disable.',
  updated_at = now()
where slug = 'workethiopia';

update job_sources
set fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object('backfillDone', false)
where slug in ('geezjobs','ethiojobs','workethiopia')
  and coalesce(fetch_config->>'backfillDone','false') = 'true'
  and coalesce((fetch_config->>'totalFound')::int, 0) > 0;
