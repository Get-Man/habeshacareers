-- 031_fix_dangling_title_employer.sql
--
-- ETcareers sometimes publishes a feed title with no location field, leaving a
-- dangling separator:
--   "Social Worker Job for Fresh Graduates - Let Me Be A Child e.V. -"
--
-- The first pass over that item lost the employer (the title parser expected
-- three "Title - Employer - Location" segments) and fell back to a name guessed
-- from the vacancy title. A logo was then resolved for that guessed name.
-- Neither the guessed employer nor that logo is verified public data.
--
-- Restore the real employer name, which is stated verbatim in the same public
-- RSS item (both in the title and the first line of the description), and clear
-- the unverified logo. The next deploy-time enrichment can then resolve a logo
-- for the correct identity. No job page is ever visited.
--
-- Idempotent and fixture-safe: a no-op unless this exact seeded row exists.

do $$
declare
  v_old_employer_id bigint;
  v_real_employer_id bigint;
begin
  if not exists (
    select 1
      from job_listings
     where id = 6179
       and title = 'Social Worker Job for Fresh Graduates'
  ) then
    return;
  end if;

  select employer_id into v_old_employer_id
    from job_listings
   where id = 6179;

  -- A logo resolved for "Social Worker Fresh Graduates" is not a verified
  -- employer mark. Clear it everywhere it could be served from.
  if v_old_employer_id is not null then
    update employer_directory
       set logo_url = null,
           logo_public_url = null,
           logo_host_kind = 'unknown',
           logo_source = 'none',
           logo_confidence = 0,
           logo_verified = false,
           logo_verified_at = null,
           logo_review_note = 'Cleared: resolved for a title-derived employer guess, not a verified employer identity.',
           updated_at = now()
     where id = v_old_employer_id;
  end if;

  update job_listings
     set company = 'Let Me Be A Child e.V.',
         organization_name = 'Let Me Be A Child e.V.',
         employer_name_key = 'let me be a child e v',
         organization_logo_url = null,
         organization_logo_source = null,
         organization_logo_verified = false,
         logo = null,
         updated_at = now()
   where id = 6179;

  -- Reuse a directory entry that already carries the real identity, otherwise
  -- relabel this row's own entry (only when that key is still free).
  select id into v_real_employer_id
    from employer_directory
   where name_key = 'let me be a child e v'
   limit 1;

  if v_real_employer_id is null
     and v_old_employer_id is not null
     and not exists (
       select 1 from employer_directory where name_key = 'let me be a child e v'
     ) then
    update employer_directory
       set name = 'Let Me Be A Child e.V.',
           name_key = 'let me be a child e v',
           identity_source = 'public_feed',
           updated_at = now()
     where id = v_old_employer_id;
    v_real_employer_id := v_old_employer_id;
  end if;

  if v_real_employer_id is not null then
    update job_listings
       set employer_id = v_real_employer_id
     where id = 6179;
  end if;
end $$;
