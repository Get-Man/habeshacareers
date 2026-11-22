-- 029_clear_third_party_brand_logos.sql
-- Remove third-party platform branding that global image search can return for
-- an employer logo query (for example a Google wordmark for an unrelated
-- employer). A wrong logo is worse than no logo: no employer identity is
-- invented here, and the vacancy keeps its verified text and apply link.
--
-- Idempotent: re-running is a no-op once the bad URLs are cleared.

create or replace function is_third_party_brand_logo_url(p_url text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_url, '') ~*
    '(google\.com/images/branding|googlelogo|google[_-]?wordmark|gstatic\.com|duckduckgo\.com|bing\.com/.*logo|yahoo\.com/.*logo|facebook\.com/.*logo|fbcdn\.net/.*logo|twitter\.com/.*logo|linkedin\.com/.*logo)';
$$;

update employer_directory
   set logo_url = null,
       logo_public_url = null,
       logo_host_kind = 'unknown',
       logo_source = 'none',
       logo_confidence = 0,
       logo_verified = false,
       logo_verified_at = null,
       logo_review_note = 'Rejected third-party platform branding; no employer logo invented.',
       updated_at = now()
 where is_third_party_brand_logo_url(logo_url);

update job_listings
   set organization_logo_url = null,
       logo = null,
       organization_logo_source = null,
       organization_logo_verified = false,
       updated_at = now()
 where is_third_party_brand_logo_url(organization_logo_url)
    or is_third_party_brand_logo_url(logo);
