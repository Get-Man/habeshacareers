-- 015_employer_directory.sql
-- Centralized employer identity directory.
--
-- Purpose: every organisation gets ONE verified identity (name, official
-- website, official logo) even when its vacancies are discovered through
-- several different job boards. Job rows link to the directory entry, and the
-- verified logo is reused for every vacancy of that organisation.
--
-- This migration is additive: no column is dropped, no row is deleted.

-- ---------------------------------------------------------------------------
-- 1. Employer directory
-- ---------------------------------------------------------------------------
create table if not exists employer_directory (
  id bigserial primary key,
  name text not null,
  name_key text not null,
  aliases text[] not null default '{}',
  website_url text,
  website_domain text,
  logo_url text,
  logo_public_url text,
  logo_host_kind text,          -- employer|ats|board_cdn|aggregator|unknown
  logo_source text,             -- jsonld|employer_site|ats_site|favicon_service|profile|manual
  logo_confidence integer not null default 0,
  logo_verified boolean not null default false,
  logo_verified_at timestamptz,
  logo_review_note text,
  listing_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employer_directory_name_key_idx on employer_directory (name_key);
create index if not exists employer_directory_domain_idx on employer_directory (website_domain);
create index if not exists employer_directory_logo_idx on employer_directory (logo_verified) where logo_verified;

-- ---------------------------------------------------------------------------
-- 2. Link job listings to the directory
-- ---------------------------------------------------------------------------
alter table job_listings add column if not exists employer_id bigint;
alter table job_listings add column if not exists employer_name_key text;
alter table job_listings add column if not exists organization_logo_source text;
alter table job_listings add column if not exists organization_logo_verified boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'job_listings_employer_id_fkey'
  ) then
    alter table job_listings
      add constraint job_listings_employer_id_fkey
      foreign key (employer_id) references employer_directory(id) on delete set null;
  end if;
end $$;

create index if not exists job_listings_employer_id_idx on job_listings (employer_id);
create index if not exists job_listings_employer_name_key_idx on job_listings (employer_name_key);

-- ---------------------------------------------------------------------------
-- 3. Seed directory rows from existing listings (non-destructive)
--    Only rows with a real employer name are seeded; "Organization not
--    verified" is never given an identity.
-- ---------------------------------------------------------------------------
insert into employer_directory (name, name_key, aliases, website_url, website_domain, logo_url, logo_verified, logo_confidence, logo_source)
select
  l.company,
  lower(regexp_replace(trim(l.company), '\s+', ' ', 'g')),
  '{}'::text[],
  null,
  null,
  null,
  false,
  0,
  'seeded'
from job_listings l
where l.company is not null
  and btrim(l.company) <> ''
  and lower(btrim(l.company)) <> 'organization not verified'
group by l.company
on conflict (name_key) do nothing;

update job_listings l
set employer_name_key = lower(regexp_replace(trim(l.company), '\s+', ' ', 'g'))
where l.company is not null
  and btrim(l.company) <> ''
  and lower(btrim(l.company)) <> 'organization not verified'
  and l.employer_name_key is null;

update job_listings l
set employer_id = e.id
from employer_directory e
where l.employer_name_key = e.name_key
  and l.employer_id is null;

update employer_directory e
set listing_count = c.n
from (select employer_id, count(*)::int as n from job_listings where employer_id is not null group by employer_id) c
where e.id = c.employer_id;

-- ---------------------------------------------------------------------------
-- 4. Adopt previously stored organization logos into the directory
--    Only logos that are NOT hosted on a known discovery/aggregator domain are
--    adopted; they stay unverified until re-checked against the employer site.
-- ---------------------------------------------------------------------------
update employer_directory e
set logo_url = l.logo,
    logo_host_kind = 'unknown',
    logo_source = 'legacy_listing',
    logo_confidence = 40,
    updated_at = now()
from job_listings l
where l.employer_id = e.id
  and e.logo_url is null
  and l.logo is not null
  and btrim(l.logo) <> ''
  and l.logo !~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|unjobs\.org|careers\.un\.org|dereja\.com|hahu\.jobs|srazone\.et|ngojobs\.et|jobwebethiopia\.com|ethiopianjobs\.net)'
  and l.logo !~* '(icons\.duckduckgo\.com|google\.com/s2/favicons)';

-- ---------------------------------------------------------------------------
-- 5. Public view
--    The view stays the privacy boundary for job rows. The employer directory
--    is joined in so every vacancy of an organisation shows the SAME verified
--    identity and official logo. Employer identity is public information; a
--    discovery source is not, and no source column is selected here.
-- ---------------------------------------------------------------------------
create or replace view public_job_listings as
select
  l.id,
  l.title,
  l.company,
  l.logo,
  l.organization_logo_url,
  l.organization_verified,
  l.category,
  l.location,
  l.region_city,
  l.job_type,
  l.vacancies,
  l.education_requirements,
  l.experience_requirements,
  l.required_skills,
  l.salary,
  l.posted_date,
  l.deadline,
  l.description,
  l.description_html,
  l.description_excerpt,
  l.requirements,
  l.requirements_html,
  l.application_instructions,
  l.application_email,
  l.apply_url,
  l.apply_url_type,
  l.apply_url_confidence,
  l.apply_url_verified,
  l.job_reference,
  l.job_status,
  l.status,
  l.featured,
  l.origin,
  l.last_verified_at,
  l.created_at,
  l.updated_at,
  l.employer_id,
  e.name as employer_name,
  e.name_key as employer_name_key,
  e.website_url as employer_website_url,
  e.website_domain as employer_website_domain,
  e.logo_public_url as employer_logo_url,
  e.logo_verified as employer_logo_verified
from job_listings l
left join employer_directory e on e.id = l.employer_id
where l.status = 'active'
  and (l.deadline is null or l.deadline >= current_date)
  and (l.job_status is null or l.job_status not in ('expired', 'unavailable'));
