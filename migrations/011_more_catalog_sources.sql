-- Add newly verified permitted public sources + record blocked/unreachable ones.
-- Compliance verified 2026-11-09:
--  - ethio-jobs.net.et: robots Allow:/ + Content-Signal search=yes,use=reference (AI-training crawlers only disallowed);
--    public sitemap-jobs.xml (~1300 urls) + public vacancy-detail pages with JobPosting JSON-LD.
--  - etcareers.com: robots allows sitemap + /jobs/* detail pages (/jobs/?page= disallowed — not used);
--    public sitemap.xml (445 job urls) + JobPosting JSON-LD on detail pages.
--  - alljobspo (jobsinethiopia.alljobspo.com): robots Allow:/ ; public listing pagination + public
--    /job-details/<id>; "Apply to Job" is a public redirect to the ORIGINAL publisher page (decoded for official link).
--  - careers.un.org: official public RSS feed /jobfeed (published by the site; ~432 items, structured metadata).
--  - ethiopianreporterjobs.com: robots allows job-sitemaps + /jobs/<id>/ pages (Yoast). Expired postings serve an
--    "unavailable" notice page (skipped); origin may 520 intermittently — tolerated, gaps filled by later runs.
--  - ezega: listing is ASP.NET __doPostBack-paged (no sitemap, no direct job links) — not crawlable without form
--    simulation; stays off until the site offers a feed/API.
--  - jobs.unicef.org: PageUp app returns 202-empty bot-challenge to non-browser clients; no public RSS/sitemap — stays off.
--  - higherethiopia.com: domain does not resolve (site offline).
--  - unjobs.org (403) / reliefweb API (410) reaffirmed blocked — never bypassed.

insert into job_sources (slug, name, base_url, listing_url, source_type, enabled, integration_status, status_note, fetch_config) values
  ('ethiojobs-net-et', 'EthioJobs ETH (ethio-jobs.net.et)', 'https://ethio-jobs.net.et/', 'https://ethio-jobs.net.et/sitemap-jobs.xml', 'html', true, 'connected',
   'Compliant batched backfill: public sitemap-jobs.xml + public vacancy-detail pages (robots Allow, search=yes/use=reference; JobPosting JSON-LD). Staggered-parallel batches; fetch_config.offset advances after each run. Admin can disable.',
   jsonb_build_object('sitemapUrl', 'https://ethio-jobs.net.et/sitemap-jobs.xml', 'limit', 8, 'offset', 0, 'delayMs', 350, 'backfillDone', false)),
  ('etcareers', 'ET Careers', 'https://etcareers.com', 'https://etcareers.com/sitemap.xml', 'html', true, 'connected',
   'Compliant batched backfill: public sitemap.xml job URLs + public /jobs/* pages with JobPosting JSON-LD (robots allows; no disallowed ?page= crawling). Staggered-parallel batches; fetch_config.offset advances after each run. Admin can disable.',
   jsonb_build_object('sitemapUrl', 'https://etcareers.com/sitemap.xml', 'limit', 8, 'offset', 0, 'delayMs', 350, 'backfillDone', false)),
  ('alljobspo', 'Alljobspo (Jobs in Ethiopia)', 'https://jobsinethiopia.alljobspo.com', 'https://jobsinethiopia.alljobspo.com/', 'html', true, 'connected',
   'Compliant batched crawl: public listing pages /?page=N (robots Allow:/) + public /job-details pages; official original-publisher link decoded from the public url.php redirect. Staggered-parallel batches; fetch_config.offset advances per page. Admin can disable.',
   jsonb_build_object('limit', 20, 'offset', 1, 'delayMs', 300, 'backfillDone', false)),
  ('careersun', 'UN Careers (careers.un.org)', 'https://careers.un.org', 'https://careers.un.org/jobfeed', 'rss', true, 'connected',
   'Uses the site''s official public RSS feed (/jobfeed) only — structured vacancy metadata, deadline included. Batched slice per run; upserts idempotent. Admin can disable.',
   jsonb_build_object('feedUrl', 'https://careers.un.org/jobfeed', 'limit', 40, 'offset', 0, 'backfillDone', false)),
  ('unicef', 'UNICEF Careers', 'https://jobs.unicef.org', 'https://jobs.unicef.org/en-us/listing/', 'html', false, 'blocked',
   'PageUp vacancy app returns a 202-empty bot-challenge to non-browser clients; no public RSS/sitemap/API. Never bypassed; awaiting an official UNICEF feed/API.', null),
  ('higherethiopia', 'Higher Ethiopia', 'https://www.higherethiopia.com', 'https://www.higherethiopia.com/jobs/', 'html', false, 'blocked',
   'Domain does not resolve (site appears offline). Revisit if the site returns.', null)
on conflict (slug) do update set
  name = excluded.name,
  base_url = coalesce(excluded.base_url, job_sources.base_url),
  listing_url = coalesce(excluded.listing_url, job_sources.listing_url),
  source_type = excluded.source_type,
  integration_status = case when job_sources.integration_status in ('connected') then job_sources.integration_status else excluded.integration_status end,
  fetch_config = coalesce(job_sources.fetch_config, excluded.fetch_config),
  status_note = excluded.status_note,
  updated_at = now();

-- Enable Ethiopian Reporter Jobs (existing slug) with batched sitemap backfill.
update job_sources
set
  enabled = true,
  fetch_config = coalesce(fetch_config, '{}'::jsonb) || jsonb_build_object(
    'limit', 6,
    'offset', 0,
    'delayMs', 400,
    'backfillDone', false
  ),
  status_note = 'Compliant batched backfill: public sitemap_index.xml job-sitemaps + public /jobs/<id>/ pages (robots allows). "Unavailable"/expired notice pages skipped; origin intermittently returns 520 — errors tolerated, gaps filled by later runs. fetch_config.offset advances after each successful run. Admin can disable.',
  updated_at = now()
where slug = 'ethiopian-reporter';

-- Ezega: postback-only listing = cannot be crawled compliantly; mark blocked.
update job_sources
set enabled = false,
    integration_status = 'blocked',
    status_note = 'Job list is ASP.NET __doPostBack-paged (no sitemap, no direct job links); compliant crawling without form-post simulation is impossible. Awaiting official API/feed permission.',
    updated_at = now()
where slug = 'ezega-jobs';

-- Reaffirm blocked sources (observed blocks; never bypassed).
update job_sources set integration_status = 'blocked',
  status_note = 'HTTP 403 bot-protection on public pages; no bypass per compliance policy.',
  updated_at = now()
where slug = 'unjobs-ethiopia';
update job_sources set integration_status = 'blocked',
  status_note = 'ReliefWeb v1 job API retired (HTTP 410); no v2. No bypass per compliance policy.',
  updated_at = now()
where slug = 'reliefweb-ethiopia';
