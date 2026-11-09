-- Logo hygiene: organization logos must be exact; platform/aggregator favicons are never shown.
-- Clear generic platform-favicon logos where the listing's official link points at an aggregator
-- domain (the org-logo cascade refills known organizations on next upsert). Idempotent.

update job_listings
set logo = null,
    updated_at = now()
where logo is not null
  and logo ~* '(icons\.duckduckgo\.com|google\.com/s2/favicons|favicon)'
  and original_url ~* '(geezjobs\.com|ethiojobs\.net|etcareers\.com|alljobspo\.com|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|workethiopia\.net|srazone\.et|ethiopianreporterjobs\.com|reliefweb\.int|unjobs\.org)';

-- Same hygiene in the job_listing_sources reference table is unnecessary (logos live on job_listings).
