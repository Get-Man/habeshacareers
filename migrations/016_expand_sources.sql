-- 016_expand_sources.sql
-- Adds additional Ethiopian job sources that were verified for compliant,
-- public access, and records the employer-logo pipeline for each.
--
-- Verification notes (public, robots-respecting, no authentication):
--  - geezjobs.com       : public /sitemap-detail (4,300+ individual /job-detail/
--                         announcements) with JobPosting JSON-LD. Already active.
--  - ngojobs.et         : public /sitemap-jobs.xml (individual /jobs/<slug> pages,
--                         JobPosting JSON-LD with hiringOrganization.sameAs).
--  - srazone.et         : public /sitemap.xml with individual /<locale>/jobs/<slug>
--                         pages carrying JobPosting JSON-LD.
--  - ethiopianjobs.net  : public WordPress job_listing sitemap
--                         (/job_listing-sitemap.xml) with individual /job/<slug>/
--                         pages carrying JobPosting JSON-LD.
--  - jobwebethiopia.com : public paginated /jobs/ archive with individual
--                         /jobs/<slug>/ pages carrying JobPosting JSON-LD.
--                         robots.txt asks for Crawl-delay: 30, which the engine
--                         honours through per-host throttling.
--  - dereja.com         : Next.js application; vacancy records are published in
--                         the public RSC flight payload of /jobs and /jobs/<slug>.
--                         No authentication is used.
--
-- Sources are inserted disabled by default so an administrator can review and
-- enable each one. Enabling is a single UPDATE and the adapters respect
-- robots.txt, per-host throttling and bounded batches.

insert into job_sources (slug, name, base_url, listing_url, source_type, enabled, integration_status, status_note, adapter_key, fetch_config) values
  ('ngojobs', 'NGO Jobs (NGO Jobs in Ethiopia)', 'https://ngojobs.et/', 'https://ngojobs.et/sitemap-jobs.xml', 'html', false, 'pending',
   'Compliant batched backfill: public sitemap-jobs.xml (individual /jobs/<slug> pages, JobPosting JSON-LD). Robots allows /; filter permutations are disallowed and never requested. Admin can enable.',
   'ngojobs', jsonb_build_object('sitemapUrl', 'https://ngojobs.et/sitemap-jobs.xml', 'limit', 8, 'offset', 0, 'delayMs', 400, 'backfillDone', false)),
  ('srazone', 'SraZone', 'https://srazone.et/', 'https://srazone.et/sitemap.xml', 'html', false, 'pending',
   'Compliant batched backfill: public sitemap.xml with individual /<locale>/jobs/<slug> pages carrying JobPosting JSON-LD. Robots allows / except /api, /admin and account areas, which are never requested. Admin can enable.',
   'srazone', jsonb_build_object('sitemapUrl', 'https://srazone.et/sitemap.xml', 'limit', 8, 'offset', 0, 'delayMs', 400, 'backfillDone', false)),
  ('ethiopianjobs-net', 'Ethiopian Jobs (ethiopianjobs.net)', 'https://ethiopianjobs.net/', 'https://ethiopianjobs.net/job_listing-sitemap.xml', 'html', false, 'pending',
   'Compliant batched backfill: public WordPress job_listing sitemap with individual /job/<slug>/ pages carrying JobPosting JSON-LD. Robots allows /. Admin can enable.',
   'ethiopianjobs-net', jsonb_build_object('sitemapUrl', 'https://ethiopianjobs.net/job_listing-sitemap.xml', 'limit', 6, 'offset', 0, 'delayMs', 400, 'backfillDone', false)),
  ('jobwebethiopia', 'Jobweb Ethiopia', 'https://jobwebethiopia.com/', 'https://jobwebethiopia.com/jobs/', 'html', false, 'pending',
   'Compliant batched backfill: public paginated /jobs/ archive with individual /jobs/<slug>/ pages carrying JobPosting JSON-LD. robots.txt requests Crawl-delay: 30, honoured through per-host throttling. Admin can enable.',
   'jobwebethiopia', jsonb_build_object('listingUrl', 'https://jobwebethiopia.com/jobs/', 'limit', 6, 'offset', 0, 'delayMs', 30000, 'backfillDone', false)),
  ('dereja', 'Dereja', 'https://www.dereja.com/', 'https://www.dereja.com/jobs?type=job', 'html', false, 'pending',
   'Compliant batched discovery: vacancy records are published in the public Next.js RSC flight payload of /jobs and /jobs/<slug> (no authentication used). Individual announcement URLs are discovered first, then each announcement page is opened for full content, employer identity and the employer''s own application link. Admin can enable.',
   'dereja', jsonb_build_object('listingUrl', 'https://www.dereja.com/jobs?type=job', 'limit', 12, 'offset', 0, 'delayMs', 500, 'backfillDone', false))
on conflict (slug) do update set
  name = excluded.name,
  base_url = coalesce(excluded.base_url, job_sources.base_url),
  listing_url = coalesce(excluded.listing_url, job_sources.listing_url),
  source_type = excluded.source_type,
  adapter_key = excluded.adapter_key,
  status_note = excluded.status_note,
  fetch_config = coalesce(job_sources.fetch_config, excluded.fetch_config),
  updated_at = now();

-- GeezJobs: keep the adapter key explicit and make sure the discovery cursor
-- is present so the sitemap drain starts from the beginning.
update job_sources
set
  adapter_key = coalesce(adapter_key, 'geezjobs'),
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'sitemapUrl', 'https://geezjobs.com/sitemap-detail',
    'feedUrl', 'https://geezjobs.com/rss',
    'limit', 8,
    'offset', 0,
    'delayMs', 400,
    'backfillDone', false
  ),
  updated_at = now()
where slug = 'geezjobs';

-- Employer directory: adopt the official logos that are already stored on the
-- listing rows, so the directory starts with a usable identity map. Logos that
-- are hosted on a discovery source are deliberately left out: they are replaced
-- by the employer's own logo during the next extraction run, and the old value
-- is never published.
update employer_directory e
set logo_url = l.logo,
    logo_host_kind = 'employer_site',
    logo_source = 'legacy_listing',
    logo_confidence = 45,
    updated_at = now()
from job_listings l
where l.employer_id = e.id
  and e.logo_url is null
  and l.organization_logo_url is not null
  and btrim(l.organization_logo_url) <> ''
  and l.organization_logo_url !~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|unjobs\.org|careers\.un\.org|dereja\.com|hahu\.jobs|srazone\.et|ngojobs\.et|jobwebethiopia\.com|ethiopianjobs\.net)';

-- Employer directory: refresh the listing counters after the seeding above.
update employer_directory e
set listing_count = (
      select count(*)::int from job_listings l
       where l.employer_id = e.id
    ),
    updated_at = now();
