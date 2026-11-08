-- GeezJobs compliant connector setup.
-- robots.txt (User-agent: *) allows /job-detail/*, /rss, /sitemap-detail; disallows search/filter query pages.
-- Connector uses public RSS/sitemap + public job detail pages and extracts JobPosting JSON-LD. No login/CAPTCHA/bypass.

insert into job_sources (
  slug, name, base_url, listing_url, source_type, enabled, integration_status, status_note, fetch_config, robots_policy
) values (
  'geezjobs',
  'GeezJobs',
  'https://geezjobs.com/',
  'https://geezjobs.com/jobs-in-ethiopia',
  'rss',
  true,
  'connected',
  'Compliant connector: uses public RSS (https://geezjobs.com/rss) and public /job-detail pages only. Extracts JobPosting JSON-LD from permitted detail pages. robots.txt allows /job-detail/* for User-agent: *. Respect ToS/robots/rate limits; admin can disable.',
  jsonb_build_object(
    'limit', 15,
    'delayMs', 800,
    'listingMode', 'rss',
    'feedUrl', 'https://geezjobs.com/rss',
    'sitemapUrl', 'https://geezjobs.com/sitemap-detail'
  ),
  'User-agent * allows /job-detail/*, /rss, /sitemap-detail; disallows search/filter query pages.'
)
on conflict (slug) do update set
  name = excluded.name,
  base_url = excluded.base_url,
  listing_url = excluded.listing_url,
  source_type = case when job_sources.source_type in ('manual','html','pending') then excluded.source_type else job_sources.source_type end,
  enabled = true,
  integration_status = 'connected',
  status_note = excluded.status_note,
  fetch_config = coalesce(job_sources.fetch_config, '{}'::jsonb) || excluded.fetch_config,
  robots_policy = excluded.robots_policy,
  updated_at = now();
