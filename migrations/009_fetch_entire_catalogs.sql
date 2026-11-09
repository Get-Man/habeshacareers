-- Ensure compliant full-catalog backfill configs are active (idempotent).
-- Uses only public sitemaps/feeds/detail pages allowed by robots.txt/ToS context captured in connector notes.
-- Repeated cron/manual syncs advance offset; upserts/dedup make runs safe.

update job_sources
set
  enabled = true,
  integration_status = case when integration_status in ('unsupported','blocked') then integration_status else 'connected' end,
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'listingMode', 'sitemap',
    'sitemapUrl', 'https://geezjobs.com/sitemap-detail',
    'feedUrl', 'https://geezjobs.com/rss',
    'limit', 5,
    'delayMs', 400
  ),
  status_note = 'Compliant batched backfill: public sitemap-detail + public /job-detail JSON-LD pages only. robots.txt allows /job-detail/*, /rss, /sitemap-detail. fetch_config.offset advances after each run. Admin can disable.',
  updated_at = now()
where slug = 'geezjobs';

update job_sources
set
  enabled = true,
  integration_status = case when integration_status in ('unsupported','blocked') then integration_status else 'connected' end,
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'sitemapUrl', 'https://ethiojobs.net/sitemap-jobs.xml',
    'limit', 5,
    'delayMs', 400
  ),
  status_note = 'Compliant batched backfill: public sitemap-jobs.xml + public job pages only (no /api/*). fetch_config.offset advances after each run. Admin can disable.',
  updated_at = now()
where slug = 'ethiojobs';

update job_sources
set
  enabled = true,
  integration_status = case when integration_status in ('unsupported','blocked') then integration_status else 'connected' end,
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'sitemapUrl', 'https://workethiopia.net/sitemap.xml',
    'limit', 3,
    'delayMs', 350,
    'enrichOfficial', false
  ),
  status_note = 'Compliant batched backfill: public sitemap.xml /jobs/* entries + public job detail pages (robots allows all agents). Follows official employer application links. fetch_config.offset advances after each run. Admin can disable.',
  updated_at = now()
where slug = 'workethiopia';
