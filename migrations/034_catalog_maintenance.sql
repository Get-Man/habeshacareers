-- 034_catalog_maintenance.sql
-- Four catalog-maintenance updates, all idempotent:
--   1. Expire every vacancy whose application deadline has passed (all sources).
--   2. Remove the un.org / ethiopia.un.org "UN in Ethiopia" source from the
--      active source list: it publishes no career postings.
--   3. Register the official UN Careers Addis Ababa job-opening page as a source.
--   4. Re-enable and repair the Ethiojobs and Dereja collectors.
--
-- The public view (public_job_listings) already hides expired, unavailable and
-- demo rows. This migration makes the stored status agree with that view at
-- deploy time, so a site with no cron run yet never shows a passed deadline.

-- 1. Expiry housekeeping -----------------------------------------------------
create index if not exists idx_job_listings_status_deadline
  on job_listings (status, deadline);

update job_listings
   set status = 'expired',
       job_status = 'expired',
       updated_at = now()
 where status = 'active'
   and deadline is not null
   and deadline < current_date;

-- 2. Remove the un.org source ------------------------------------------------
-- Only the bare un.org / ethiopia.un.org career page is removed. The official
-- careers.un.org feeds and the internal UN Jobnet discovery source are kept.
update job_sources
   set enabled = false,
       integration_status = 'blocked',
       status_note = 'Removed from the active source list: https://ethiopia.un.org/en/jobs publishes no career postings. Official careers.un.org sources are used instead.',
       updated_at = now()
 where slug in ('un-ethiopia', 'un-org', 'un')
    or base_url ~* '^https?://(www\.)?(ethiopia\.)?un\.org/?$'
    or listing_url ~* '^https?://(www\.)?(ethiopia\.)?un\.org(/|$)';

-- 3. Add careers.un.org Addis Ababa source -----------------------------------
-- The requested job-opening page is an Angular application with no vacancy
-- links in its server HTML. Discovery therefore uses the site's own public RSS
-- feed (https://careers.un.org/jobfeed), already used by the other UN sources,
-- and keeps only Addis Ababa duty stations. The exact requested URL is stored
-- as the source's listing URL and is what the source list shows to admins.
insert into job_sources
  (slug, name, base_url, listing_url, source_type, enabled, integration_status,
   status_note, adapter_key, fetch_config)
values
  ('careers-un-addisababa', 'UN Careers (Addis Ababa)',
   'https://careers.un.org/',
   'https://careers.un.org/jobopening?language=en&data=%257B%2522ds%2522:%255B%2522ADDISABABA%2522%255D%257D',
   'rss', true, 'connected',
   'Official UN Careers source for Addis Ababa duty stations. The public job-opening page is recorded as the listing URL; vacancy URLs are discovered from the site''s official public RSS feed (/jobfeed) filtered to ADDIS ABABA. No authentication, undocumented endpoint or access-control bypass. Bounded, throttled batches.',
   'un-careers-addisababa',
   jsonb_build_object(
     'feedUrl', 'https://careers.un.org/jobfeed',
     'keywordPattern', 'ADDIS ABABA',
     'limit', 10, 'offset', 0, 'delayMs', 500, 'backfillDone', false))
on conflict (slug) do update set
  name = excluded.name,
  base_url = coalesce(excluded.base_url, job_sources.base_url),
  listing_url = excluded.listing_url,
  source_type = excluded.source_type,
  enabled = true,
  integration_status = 'connected',
  status_note = excluded.status_note,
  adapter_key = excluded.adapter_key,
  fetch_config = coalesce(job_sources.fetch_config, '{}'::jsonb) || excluded.fetch_config,
  updated_at = now();

-- 4. Repair Ethiojobs and Dereja --------------------------------------------
-- Both sites expose public, robots-allowed job URLs. Live checks confirm the
-- Ethiojobs sitemap (1,200+ /job/ URLs) and the Dereja /jobs RSC flight payload
-- (individual /jobs/<slug> records). The collectors were not draining because
-- Ethiojobs' cursor/backfill state had stalled and Dereja was left disabled.
update job_sources
   set enabled = true,
       integration_status = 'connected',
       adapter_key = 'ethiojobs',
       listing_url = 'https://ethiojobs.net/jobs',
       fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
         'sitemapUrl', 'https://ethiojobs.net/sitemap-jobs.xml',
         'limit', 12, 'offset', 0, 'delayMs', 350, 'backfillDone', false),
       status_note = 'Compliant batched backfill: public /sitemap-jobs.xml lists individual /job/<slug> vacancies (robots Allow: /; /api/* is never requested). Each announcement is opened for full content, employer identity and the employer''s own application link. Bounded batches; cursor advances after every run.',
       updated_at = now()
 where slug = 'ethiojobs';

update job_sources
   set enabled = true,
       integration_status = 'connected',
       adapter_key = 'dereja',
       base_url = 'https://www.dereja.com/',
       listing_url = 'https://www.dereja.com/jobs',
       fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
         'listingUrl', 'https://www.dereja.com/jobs?type=job',
         'limit', 12, 'offset', 0, 'delayMs', 500, 'backfillDone', false),
       status_note = 'Compliant batched discovery: public /jobs page publishes full vacancy records in its Next.js RSC flight payload (no authentication). Individual /jobs/<slug> announcements are opened and their full record is resolved from the public listing payload when the announcement itself is client-rendered. Bounded batches; cursor advances after every run.',
       updated_at = now()
 where slug = 'dereja';
