-- 014_intelligent_extraction.sql
-- Additive migration: two-stage discovery/extraction, verified application links,
-- employer verification, public/internal separation and admin review tooling.
-- No existing columns are dropped and no existing rows are deleted.

-- ---------------------------------------------------------------------------
-- 1. Job-level extraction + privacy columns
-- ---------------------------------------------------------------------------
alter table job_listings add column if not exists listing_page_url text;
alter table job_listings add column if not exists original_job_url text;
alter table job_listings add column if not exists canonical_job_url text;
alter table job_listings add column if not exists apply_url text;
alter table job_listings add column if not exists apply_url_type text;
alter table job_listings add column if not exists apply_url_confidence integer;
alter table job_listings add column if not exists apply_url_source text;
alter table job_listings add column if not exists apply_url_verified boolean not null default false;
alter table job_listings add column if not exists apply_url_checked_at timestamptz;
alter table job_listings add column if not exists apply_candidates jsonb not null default '[]'::jsonb;
alter table job_listings add column if not exists application_email text;
alter table job_listings add column if not exists source_domain text;
alter table job_listings add column if not exists source_website_name text;
alter table job_listings add column if not exists extraction_method text;
alter table job_listings add column if not exists extraction_status text;
alter table job_listings add column if not exists extraction_timestamp timestamptz;
alter table job_listings add column if not exists job_status text;
alter table job_listings add column if not exists organization_verified boolean not null default false;
alter table job_listings add column if not exists organization_logo_url text;
alter table job_listings add column if not exists job_reference text;
alter table job_listings add column if not exists description_html text;
alter table job_listings add column if not exists requirements_html text;
alter table job_listings add column if not exists quality_score integer;
alter table job_listings add column if not exists dedup_content_hash text;
alter table job_listings add column if not exists apply_url_reason text;
alter table job_listings add column if not exists apply_url_final_url text;
alter table job_listings add column if not exists last_extraction_error text;
alter table job_listings add column if not exists review_status text not null default 'unreviewed';
alter table job_listings add column if not exists reviewed_at timestamptz;
alter table job_listings add column if not exists reviewed_by text;

create index if not exists job_listings_extraction_status_idx on job_listings (extraction_status);
create index if not exists job_listings_job_status_idx on job_listings (job_status);
create index if not exists job_listings_apply_type_idx on job_listings (apply_url_type);
create index if not exists job_listings_canonical_url_idx on job_listings (canonical_job_url);
create index if not exists job_listings_source_domain_idx on job_listings (source_domain);
create index if not exists job_listings_review_status_idx on job_listings (review_status);

-- ---------------------------------------------------------------------------
-- 2. Two-stage discovery queue (listing page -> individual vacancy URL)
-- ---------------------------------------------------------------------------
create table if not exists job_discovery_queue (
  id bigserial primary key,
  source_id bigint not null references job_sources(id) on delete cascade,
  listing_page_url text,
  discovered_url text not null,
  canonical_url text,
  status text not null default 'pending', -- pending|extracting|extracted|failed|skipped|duplicate
  attempts integer not null default 0,
  last_error text,
  listing_id bigint references job_listings(id) on delete set null,
  discovered_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  extracted_at timestamptz,
  unique (source_id, discovered_url)
);

create index if not exists job_discovery_queue_status_idx on job_discovery_queue (status, next_attempt_at);
create index if not exists job_discovery_queue_source_idx on job_discovery_queue (source_id);

-- ---------------------------------------------------------------------------
-- 3. Ranked application candidates (internal review evidence)
-- ---------------------------------------------------------------------------
create table if not exists job_application_candidates (
  id bigserial primary key,
  listing_id bigint not null references job_listings(id) on delete cascade,
  url text not null,
  url_type text,
  confidence integer,
  source text,
  label text,
  context text,
  verified boolean not null default false,
  status text not null default 'candidate', -- candidate|selected|rejected|ambiguous
  created_at timestamptz not null default now(),
  unique (listing_id, url)
);

create index if not exists job_application_candidates_listing_idx on job_application_candidates (listing_id);

-- ---------------------------------------------------------------------------
-- 4. Audit trail for administrator corrections
-- ---------------------------------------------------------------------------
create table if not exists job_admin_audit (
  id bigserial primary key,
  listing_id bigint references job_listings(id) on delete set null,
  actor text,
  action text not null,
  field text,
  old_value text,
  new_value text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists job_admin_audit_listing_idx on job_admin_audit (listing_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4b. Cooperative sync lock (prevents overlapping serverless/cron runs)
-- ---------------------------------------------------------------------------
create table if not exists job_sync_locks (
  lock_key text primary key,
  owner text not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists job_sync_locks_expires_idx on job_sync_locks (expires_at);

-- ---------------------------------------------------------------------------
-- 5. Sync run quality counters
-- ---------------------------------------------------------------------------
alter table job_sync_runs add column if not exists discovered_count integer not null default 0;
alter table job_sync_runs add column if not exists extracted_count integer not null default 0;
alter table job_sync_runs add column if not exists apply_found_count integer not null default 0;
alter table job_sync_runs add column if not exists needs_review_count integer not null default 0;
alter table job_sync_runs add column if not exists duration_ms integer;

alter table job_sources add column if not exists adapter_key text;
alter table job_sources add column if not exists last_discovery_at timestamptz;

-- ---------------------------------------------------------------------------
-- 6. Backfill safe defaults for existing records (non-destructive)
-- ---------------------------------------------------------------------------
update job_listings l
set
  original_job_url = coalesce(l.original_job_url, l.original_url),
  canonical_job_url = coalesce(l.canonical_job_url, l.original_url),
  listing_page_url = coalesce(l.listing_page_url, l.original_url),
  extraction_method = coalesce(l.extraction_method, 'legacy-connector'),
  extraction_timestamp = coalesce(l.extraction_timestamp, l.collected_at, l.created_at),
  source_domain = coalesce(l.source_domain, (
    select regexp_replace(regexp_replace(coalesce(s.base_url, ''), '^https?://', ''), '[/:].*$', '')
    from job_sources s where s.id = l.primary_source_id
  )),
  source_website_name = coalesce(l.source_website_name, (
    select s.name from job_sources s where s.id = l.primary_source_id
  )),
  application_email = coalesce(l.application_email, l.contact_email)
where l.original_job_url is null
   or l.canonical_job_url is null
   or l.listing_page_url is null
   or l.extraction_method is null
   or l.source_domain is null
   or l.source_website_name is null;

-- Extraction quality for legacy rows: never invent completeness.
update job_listings l
set extraction_status = case
  when l.description is null or length(btrim(l.description)) < 120 then 'partial'
  when l.company is null or btrim(l.company) = '' then 'needs_manual_review'
  else 'verified'
end
where l.extraction_status is null;

-- Application destination for legacy rows. Only use original_url when it is NOT the
-- discovery source (aggregator) host; never expose a listing/source page as "Apply".
update job_listings l
set
  apply_url = case
    when l.application_email is not null and btrim(l.application_email) <> ''
      then 'mailto:' || btrim(l.application_email)
    when l.original_url is not null
      and l.original_url ~* '^https?://'
      and l.original_url !~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|workethiopia\.net|srazone\.et|ethiopianreporterjobs\.com|reliefweb\.int|unjobs\.org|careers\.un\.org)'
      and not exists (
        select 1 from job_sources s
        where s.id = l.primary_source_id
          and coalesce(s.base_url, '') <> ''
          and l.original_url ilike '%' || regexp_replace(regexp_replace(s.base_url, '^https?://', ''), '[/:].*$', '') || '%'
      )
      then l.original_url
    else null
  end,
  apply_url_type = case
    when l.application_email is not null and btrim(l.application_email) <> '' then 'email_application'
    when l.original_url is not null
      and l.original_url ~* '^https?://'
      and l.original_url !~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|workethiopia\.net|srazone\.et|ethiopianreporterjobs\.com|reliefweb\.int|unjobs\.org|careers\.un\.org)'
      and not exists (
        select 1 from job_sources s
        where s.id = l.primary_source_id
          and coalesce(s.base_url, '') <> ''
          and l.original_url ilike '%' || regexp_replace(regexp_replace(s.base_url, '^https?://', ''), '[/:].*$', '') || '%'
      )
      then 'external_application'
    else 'needs_manual_review'
  end,
  apply_url_confidence = case
    when l.application_email is not null and btrim(l.application_email) <> '' then 60
    when l.original_url is not null and l.apply_url is null then 45
    else 0
  end,
  apply_url_verified = false
where l.apply_url is null;

-- Job lifecycle status (open / closing soon / expired / closed / unavailable / needs verification).
update job_listings l
set job_status = case
  when l.status in ('rejected', 'archived') then 'closed'
  when l.status = 'expired' or (l.deadline is not null and l.deadline < current_date) then 'expired'
  when l.extraction_status = 'failed' then 'unavailable'
  when l.extraction_status = 'needs_manual_review' or l.apply_url_type = 'needs_manual_review' then 'needs_verification'
  when l.deadline is not null and l.deadline <= current_date + 7 then 'closing_soon'
  else 'open'
end
where l.job_status is null;

-- ---------------------------------------------------------------------------
-- 7. Public allowlisted view (defense in depth: no source/internal URL columns)
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
  l.updated_at
from job_listings l
where l.status = 'active'
  and (l.deadline is null or l.deadline >= current_date)
  and (l.job_status is null or l.job_status not in ('expired', 'unavailable'));

-- Seed adapter keys for known sources (idempotent).
update job_sources set adapter_key = slug where adapter_key is null;
