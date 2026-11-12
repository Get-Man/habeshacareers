-- 022_fix_stale_employer_logos.sql
--
-- The first identity seeding gave some organisations the favicon of ANOTHER
-- organisation's domain, and the logo source was left as "seeded", so the
-- corrective migration could not recognise those logos as wrong.
--
-- A favicon mark always names the domain it was taken from, so a favicon
-- that names a domain other than the organisation's own website is stale and
-- is cleared here. The organisation's own favicon is then stored again, from
-- the right domain.
--
-- This migration is additive: no column is dropped, no row is deleted.

-- ---------------------------------------------------------------------------
-- 1. Clear a logo that was taken from a domain that is not this
--    organisation's own website.
-- ---------------------------------------------------------------------------
update employer_directory e
set logo_url = null,
    logo_public_url = null,
    logo_verified = false,
    logo_verified_at = null,
    logo_confidence = 0,
    logo_source = null,
    logo_host_kind = null,
    updated_at = now()
where e.logo_public_url ~* 's2/favicons\?domain='
  and (
    e.website_domain is null
    or lower(split_part(split_part(e.logo_public_url, 'domain=', 2), '&', 1)) <> lower(e.website_domain)
  );

-- A board's favicon of a discovery source is never an organisation's logo.
update employer_directory e
set logo_url = null,
    logo_public_url = null,
    logo_verified = false,
    logo_verified_at = null,
    logo_confidence = 0,
    logo_source = null,
    logo_host_kind = null,
    updated_at = now()
where e.logo_public_url ~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|unjobs\.org|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)';

-- ---------------------------------------------------------------------------
-- 2. Store the organisation's own favicon again, from the right domain.
-- ---------------------------------------------------------------------------
update employer_directory e
set logo_url = 'https://www.google.com/s2/favicons?domain=' || e.website_domain || '&sz=128',
    logo_public_url = 'https://www.google.com/s2/favicons?domain=' || e.website_domain || '&sz=128',
    logo_host_kind = 'employer',
    logo_source = 'favicon_service',
    logo_confidence = 55,
    logo_verified = true,
    logo_verified_at = now(),
    updated_at = now()
where e.website_domain is not null
  and e.logo_url is null
  and e.logo_public_url is null;
