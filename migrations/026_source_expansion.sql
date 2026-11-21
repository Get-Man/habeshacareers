-- 026_source_expansion.sql
-- Adds additional Ethiopian vacancy sources through the existing discovery
-- adapters. Only sources with documented public feed/sitemap access are
-- enabled. No undocumented "API" is assumed, no credentials, CAPTCHA or
-- access-control bypass is used, and source identity stays admin-only.
--
-- Access classification for every source researched before integration.
-- Categories: Official API | Official feed | Partnership mechanism |
-- Permitted public access. An undocumented endpoint is NEVER treated as an
-- official API.
--
--   careers.un.org   : Official feed — public RSS at https://careers.un.org/jobfeed
--                      (RSS 2.0, item links to /jobSearchDescription/<id>).
--                      Official organization career page; highest source
--                      priority. ENABLED, filtered to Ethiopia duty stations.
--   srafelagi.com    : Permitted public access — public sitemap.xml lists one
--                      vacancy per /job/<id> URL. robots.txt: Allow: /,
--                      Disallow: /api/ and /admin/ (never requested). ENABLED.
--   aradajobs.com    : Permitted public access — public sitemap.xml lists
--                      individual /jobs/<id>-<slug> vacancies. robots.txt:
--                      Allow: / with Content-Signal search=yes, use=reference,
--                      ai-train=no (this pipeline indexes/search + reference,
--                      it does not train). ENABLED.
--   reliefweb.int    : Official API exists (api.reliefweb.int/v2/jobs) but it
--                      returned HTTP 403 to our fetch. Existing
--                      reliefweb-ethiopia adapter left unchanged; NOT enabled.
--   impactpool.org   : No official API/feed of vacancy URLs (jobs/rss is 404,
--                      sitemap.xml has no vacancy URLs, JS search is 403).
--                      NOT enabled — no confirmed permitted public access.
--   devex.com        : robots.txt returned HTTP 403. NOT enabled.
--   kinjobs.com      : sitemap.xml returned HTTP 403. No feed discovered.
--                      NOT enabled.
--   afriwork.com     : sitemap.xml contains only /lander, no vacancy URLs.
--                      NOT enabled.
--   hahujobs.com / zionjobs.com / malefiya.com / guze.com (guzojobs) /
--   shebajobs.com    : Domains unreachable, parked or expired. NOT enabled.
--   ethiopianairlines.com : public sitemap exists but has no career/vacancy
--                      URLs; no official feed or partnership confirmed.
--                      NOT enabled.
--   combanketh.et / ethiotelecom.et : no reachable robots/feed and no
--                      official API or partnership confirmed. NOT enabled.
--
-- Source priority (official employer vacancy > official organization career
-- page > official API > authorized job board > other permitted source) is
-- recorded in each status note. Enabled rows are bounded (limit/offset/
-- delayMs) so a sync drains a small, throttled batch per run.

insert into job_sources
  (slug, name, base_url, listing_url, source_type, enabled, integration_status,
   status_note, adapter_key, fetch_config)
values
  ('un-careers-ethiopia', 'United Nations Careers (Ethiopia)',
   'https://careers.un.org/', 'https://careers.un.org/jobfeed', 'rss',
   true, 'connected',
   'Official feed / official organization career page: public RSS at https://careers.un.org/jobfeed. Global feed is filtered to Ethiopia duty stations by a documented keyword pattern; each item opens its official /jobSearchDescription/<id> page. No authentication, no undocumented endpoint. Highest source priority.',
   'un-careers-ethiopia',
   jsonb_build_object(
     'feedUrl', 'https://careers.un.org/jobfeed',
     'keywordPattern', 'ethiopia|addis ababa|dire dawa|mekele|hawassa|bahir dar|adama|gondar|jigjiga',
     'limit', 10, 'offset', 0, 'delayMs', 500, 'backfillDone', false)),

  ('srafelagi', 'Srafelagi',
   'https://www.srafelagi.com/', 'https://www.srafelagi.com/sitemap.xml', 'html',
   true, 'connected',
   'Permitted public access / authorized job board: public sitemap.xml lists individual /job/<id> vacancies. robots.txt Allow: / and only Disallow: /api/ and /admin/, which are never requested. No authentication or access-control bypass. Lower priority than official employer/organization vacancies.',
   'srafelagi',
   jsonb_build_object(
     'sitemapUrl', 'https://www.srafelagi.com/sitemap.xml',
     'limit', 8, 'offset', 0, 'delayMs', 400, 'backfillDone', false)),

  ('aradajobs', 'AradaJobs',
   'https://www.aradajobs.com/', 'https://www.aradajobs.com/sitemap.xml', 'html',
   true, 'connected',
   'Permitted public access / authorized job board: public sitemap.xml lists individual /jobs/<id>-<slug> vacancies. robots.txt Allow: / with Content-Signal search=yes, use=reference, ai-train=no. Category/location/type archives are skipped; no authentication or bypass. Lower priority than official employer/organization vacancies.',
   'aradajobs',
   jsonb_build_object(
     'sitemapUrl', 'https://www.aradajobs.com/sitemap.xml',
     'limit', 8, 'offset', 0, 'delayMs', 400, 'backfillDone', false))
on conflict (slug) do update set
  name = excluded.name,
  base_url = coalesce(excluded.base_url, job_sources.base_url),
  listing_url = coalesce(excluded.listing_url, job_sources.listing_url),
  source_type = excluded.source_type,
  adapter_key = excluded.adapter_key,
  enabled = excluded.enabled,
  integration_status = excluded.integration_status,
  status_note = excluded.status_note,
  fetch_config = coalesce(job_sources.fetch_config, '{}'::jsonb) || excluded.fetch_config,
  updated_at = now();
