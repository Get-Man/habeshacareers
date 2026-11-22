-- 032_clear_platform_employer_domains.sql
--
-- Some employer records were given a website domain that belongs to a service
-- hosting the application rather than to the organisation:
--
--   Welthungerhilfe                  -> eu-supply.com (supplier tender portal)
--   Patchee Food Manufacturing PLC   -> atomicmail.io (forwarding mailbox)
--   Management Sciences for Health   -> myworkdayjobs.com
--   Resolve To Save Lives / One Acre Fund -> greenhouse.io
--   Solidaridad                      -> bamboohr.com
--   Hudson Manpower                  -> recruitee.com
--   Boeing                           -> myworkdayjobs.com
--
-- Those are not company websites, and the favicons inferred from them are not
-- employer logos. Clear the wrong identity fields so the next deploy-time
-- backfill can re-infer them with the corrected rules (curated employer map,
-- company-name/domain token check, ATS host rejection).
--
-- Idempotent: re-running is a no-op once the bad values are gone.

create or replace function is_platform_employer_domain(p_domain text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_domain, '') ~*
    '(^|\.)(greenhouse\.io|lever\.co|workday\.com|myworkdayjobs\.com|bamboohr\.com|smartrecruiters\.com|icims\.com|taleo\.net|oraclecloud\.com|successfactors\.com|sapsf\.com|sapsf\.eu|jobvite\.com|recruitee\.com|personio\.de|personio\.com|zohorecruit\.com|eu-supply\.com|atomicmail\.io)$';
$$;

-- Clear values copied onto individual vacancy rows first, while the employer
-- rows still carry the bad domain that identifies them.
update job_listings
   set organization_logo_url = null,
       organization_logo_source = null,
       organization_logo_verified = false,
       logo = null,
       updated_at = now()
 where employer_id in (
   select id from employer_directory where is_platform_employer_domain(website_domain)
 );

-- Then clear the wrong domain, website, careers page and logo on the employer
-- row itself so backfill can re-infer a real identity.
update employer_directory
   set website_domain = null,
       website_url = null,
       careers_url = null,
       identity_source = null,
       logo_url = null,
       logo_public_url = null,
       logo_host_kind = 'unknown',
       logo_source = 'none',
       logo_confidence = 0,
       logo_verified = false,
       logo_verified_at = null,
       logo_review_note = 'Cleared: inferred from an application platform or forwarding mailbox, not the employer.',
       updated_at = now()
 where is_platform_employer_domain(website_domain);
