-- Enable compliant sitemap backfill batching so repeated syncs/cron can collect 100+ jobs
-- without exceeding serverless timeouts. Upserts/dedup make runs idempotent.
-- robots/ToS respected: public sitemaps + public detail pages only; no login/CAPTCHA/bypass.

-- GeezJobs: switch to public sitemap-detail backfill (RSS is recent-only).
update job_sources
set
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'listingMode', 'sitemap',
    'sitemapUrl', 'https://geezjobs.com/sitemap-detail',
    'feedUrl', 'https://geezjobs.com/rss',
    'limit', 5,
    'offset', 0,
    'delayMs', 400,
    'backfillDone', false
  ),
  status_note = 'Compliant batched backfill: public sitemap-detail + public /job-detail JSON-LD pages only. robots.txt allows /job-detail/*, /rss, /sitemap-detail. fetch_config.offset advances after each run; repeated cron/manual syncs collect the catalog idempotently. Admin can disable.',
  updated_at = now()
where slug = 'geezjobs';

-- Ethiojobs: enable batched sitemap backfill (public sitemap + public job pages only; no /api/*).
update job_sources
set
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'sitemapUrl', 'https://ethiojobs.net/sitemap-jobs.xml',
    'limit', 5,
    'offset', 0,
    'delayMs', 400,
    'backfillDone', false
  ),
  status_note = 'Compliant batched backfill: public sitemap-jobs.xml + public job pages only (no /api/*). __NEXT_DATA__ extracted from public pages. fetch_config.offset advances after each run; upserts/dedup prevent duplicates. Admin can disable.',
  updated_at = now()
where slug = 'ethiojobs';
