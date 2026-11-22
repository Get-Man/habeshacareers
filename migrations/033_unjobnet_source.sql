-- 033_unjobnet_source.sql
-- Adds UN Jobnet's public Ethiopia-filtered jobs page as a discovery source.
--
-- Access classification: Permitted public access. https://www.unjobnet.org/robots.txt
-- explicitly allows assistants/crawlers to read the job board and only
-- disallows /jd/ (duplicate raw PDFs), /salaryscale/ (proprietary files) and
-- /go/ (affiliate redirects). None of those paths is requested. The jobs page
-- has a server-rendered no-JS fallback containing one /jobs/detail/<slug>-<id>
-- link per vacancy and a Next link using ?page=N. Individual detail pages
-- expose schema.org JobPosting JSON-LD (title, employer, description, dates).
-- No account, undocumented endpoint, CAPTCHA or access-control bypass is used.
-- The board remains internal-only: unjobnet.org is a SOURCE_DOMAIN, so its
-- name, logos and apply hop are never published as an employer identity.

insert into job_sources
  (slug, name, base_url, listing_url, source_type, enabled, integration_status,
   status_note, robots_policy, terms_note, adapter_key, fetch_config)
values
  ('unjobnet', 'UN Jobnet (Ethiopia)',
   'https://www.unjobnet.org/',
   'https://www.unjobnet.org/jobs?locations%5B0%5D=Ethiopia&orderby=recent',
   'html', true, 'connected',
   'Permitted public access: the Ethiopia-filtered jobs page is public and robots-allowed. Its no-JS fallback lists individual /jobs/detail/<slug>-<id> vacancies and a ?page=N Next link; each detail page publishes schema.org JobPosting JSON-LD. Only those public surfaces are used. No credentials, undocumented API or access-control bypass. Lower priority than official employer/organization vacancies.',
   'robots.txt allows assistants on the board; /jd/, /salaryscale/ and /go/ are disallowed and never requested. Public sitemap is https://www.unjobnet.org/sitemap.',
   'Independent career platform; applications are sent to the employer. Source identity and assets stay admin-only.',
   'unjobnet',
   jsonb_build_object(
     'listingUrl', 'https://www.unjobnet.org/jobs?locations%5B0%5D=Ethiopia&orderby=recent',
     'limit', 10, 'offset', 1, 'delayMs', 500, 'backfillDone', false))
on conflict (slug) do update set
  name = excluded.name,
  base_url = coalesce(excluded.base_url, job_sources.base_url),
  listing_url = coalesce(excluded.listing_url, job_sources.listing_url),
  source_type = excluded.source_type,
  enabled = excluded.enabled,
  integration_status = excluded.integration_status,
  status_note = excluded.status_note,
  robots_policy = coalesce(excluded.robots_policy, job_sources.robots_policy),
  terms_note = coalesce(excluded.terms_note, job_sources.terms_note),
  adapter_key = excluded.adapter_key,
  fetch_config = coalesce(job_sources.fetch_config, '{}'::jsonb) || excluded.fetch_config,
  updated_at = now();
