-- 028_zamzam_employer_logo.sql
-- Restore the employer identity and logo for the ZamZam Bank vacancy whose
-- public row was seeded without an organisation ("Unknown organization").
--
-- The logo was resolved from public image search by scripts/headless-job-fetch.mjs
-- and is a real image of the bank, not an invented asset. No website URL is
-- inferred: the official domain could not be verified from public sources.
--
-- The image is served through /api/employer-logo so the third-party image host
-- never appears in the browser, the HTML, the API or structured data.
-- Idempotent and fixture-safe: a no-op unless the seeded vacancy exists.

do $$
declare
  v_employer_id bigint;
  v_logo_url text := 'https://www.mvacancy.com/wp-content/uploads/2023/03/Zamzam-Bank-S.C.png';
begin
  -- Never touch a database that does not contain this specific seeded row.
  if not exists (
    select 1
      from job_listings
     where id = 6080
       and (company is null or btrim(company) = '' or company = 'Unknown organization')
  ) then
    return;
  end if;

  select id
    into v_employer_id
    from employer_directory
   where name_key = 'zamzam bank s.c'
   limit 1;

  if v_employer_id is null then
    insert into employer_directory
      (name, name_key, aliases, logo_url, logo_public_url, logo_host_kind,
       logo_source, logo_confidence, logo_verified, logo_verified_at,
       logo_review_note, identity_source)
    values
      ('ZamZam Bank S.C', 'zamzam bank s.c',
       array['ZamZam Bank S.C.', 'ZamZam Bank', 'ZamZam Bank S.C'],
       v_logo_url, null, 'board_cdn',
       'global_search', 90, true, now(),
       'Logo resolved from public image search by the zero-visit fetcher; no official domain inferred.',
       'manual')
    returning id into v_employer_id;
  else
    update employer_directory
       set logo_url = v_logo_url,
           logo_host_kind = 'board_cdn',
           logo_source = 'global_search',
           logo_confidence = 90,
           logo_verified = true,
           logo_verified_at = now(),
           logo_review_note = 'Logo resolved from public image search by the zero-visit fetcher; no official domain inferred.',
           updated_at = now()
     where id = v_employer_id
       and (logo_url is null or btrim(logo_url) = '' or logo_source in ('seeded', 'legacy_listing'));
  end if;

  -- The public field is a same-origin path; the proxy hides the image host.
  update employer_directory
     set logo_public_url = '/api/employer-logo?id=' || v_employer_id
   where id = v_employer_id
     and logo_verified
     and logo_url is not null;

  -- This one seeded vacancy only; other rows and employers are untouched.
  update job_listings
     set company = 'ZamZam Bank S.C',
         employer_id = v_employer_id,
         employer_name_key = 'zamzam bank s.c',
         organization_logo_source = 'global_search',
         organization_logo_verified = true,
         updated_at = now()
   where id = 6080;
end $$;
