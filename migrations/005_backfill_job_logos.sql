-- Backfill organization logo URLs from original vacancy domains (favicon service).
-- Safe to rerun; only fills missing logos.

update job_listings
set logo = 'https://www.google.com/s2/favicons?domain='
  || regexp_replace(regexp_replace(original_url, '^https?://(www\.)?', ''), '/.*$', '')
  || '&sz=128',
  updated_at = now()
where (logo is null or btrim(logo) = '')
  and original_url ~* '^https?://[^/]+';
