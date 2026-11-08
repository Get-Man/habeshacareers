-- Ethiojobs compliant connector setup.
-- robots.txt allows / and publishes sitemap-jobs.xml; disallows /api/* (not used).
-- Connector extracts structured job data from __NEXT_DATA__ in public job pages, respectfully rate-limited.

update job_sources
set
  enabled = true,
  integration_status = 'connected',
  status_note = 'Compliant connector: uses public sitemap-jobs.xml and public job pages only (no /api/*). Extracts __NEXT_DATA__ from public pages. Respect robots/ToS/rate limits; admin can disable.',
  fetch_config = jsonb_build_object('limit', 15, 'delayMs', 700, 'sitemapUrl', 'https://ethiojobs.net/sitemap-jobs.xml'),
  listing_url = 'https://ethiojobs.net/jobs',
  updated_at = now()
where slug = 'ethiojobs';
