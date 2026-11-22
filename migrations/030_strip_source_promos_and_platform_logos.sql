-- 030_strip_source_promos_and_platform_logos.sql
--
-- Two public-data hygiene fixes for ETcareers-sourced vacancies:
--
-- 1. The discovery source appends a Telegram "Join @Etcareersjobs for Daily
--    Job Updates & Share with Friends" footer to every RSS description. It is
--    board promotion, never employer content, and must not appear in a job
--    card. This removes the promo tail from already-stored descriptions; the
--    live enrichment sanitiser is fixed so it is never stored again.
--
-- 2. An ATS / recruitment vendor (SuccessFactors, Greenhouse, Inspira, …) is a
--    platform, not the hiring organisation. A favicon or wordmark hosted there
--    is not an employer logo. Clear any such value so the vacancy renders no
--    logo rather than a wrong brand mark.
--
-- Idempotent: re-running is a no-op once the rows are clean.

-- ---------------------------------------------------------------------------
-- 1. Strip the discovery-source Telegram promo tail.
-- ---------------------------------------------------------------------------

create or replace function strip_source_promo(p_text text)
returns text
language sql
immutable
as $$
  select case
    when p_text is null then null
    else btrim(
      regexp_replace(
        regexp_replace(
          p_text,
          '(?:📲|join\s*(?:on\s+telegram|@?etcareersjobs)|(?:get\s+)?daily\s+job\s+(?:updates|alerts)|share\s+with\s+friends|t\.me/etcareersjobs)[\s\S]*$',
          '',
          'gi'
        ),
        '(?:\s|<p[^>]*>|<br[^>]*>|<hr[^>]*>)*$',
        '',
        'gi'
      )
    )
  end;
$$;

create or replace function has_source_promo(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_text, '') ~*
    '(etcareersjobs|(?:get\s+)?daily\s+job\s+(?:updates|alerts)|share\s+with\s+friends|t\.me/etcareersjobs|join\s+on\s+telegram)';
$$;

update job_listings
   set description = strip_source_promo(description),
       description_html = strip_source_promo(description_html),
       description_excerpt = strip_source_promo(description_excerpt),
       updated_at = now()
 where has_source_promo(description)
    or has_source_promo(description_html)
    or has_source_promo(description_excerpt);

-- ---------------------------------------------------------------------------
-- 2. Reject ATS / platform branding used as an employer logo.
-- ---------------------------------------------------------------------------

create or replace function is_ats_platform_logo_url(p_url text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_url, '') ~*
    '(sapsf\.(com|eu)|successfactors|greenhouse|lever\.co|myworkdayjobs|workday\.com|bamboohr|smartrecruiters|icims|taleo|jobvite|recruitee|personio|zohorecruit|breezy\.hr|ashbyhq|rippling|comeet|teamtailor|inspira\.un\.org|applytojob)';
$$;

update employer_directory
   set logo_url = null,
       logo_public_url = null,
       logo_host_kind = 'unknown',
       logo_source = 'none',
       logo_confidence = 0,
       logo_verified = false,
       logo_verified_at = null,
       logo_review_note = 'Rejected ATS/platform branding; no employer logo invented.',
       updated_at = now()
 where is_ats_platform_logo_url(logo_url)
    or is_ats_platform_logo_url(logo_public_url);

update job_listings
   set organization_logo_url = null,
       logo = null,
       organization_logo_source = null,
       organization_logo_verified = false,
       updated_at = now()
 where is_ats_platform_logo_url(organization_logo_url)
    or is_ats_platform_logo_url(logo);
