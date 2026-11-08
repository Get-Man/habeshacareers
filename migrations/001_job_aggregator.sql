-- Habesha Career: job aggregator / submissions schema (additive). Preserves existing static frontend.

create extension if not exists pgcrypto;

create table if not exists job_sources (
  id bigserial primary key,
  slug text not null unique,
  name text not null,
  base_url text,
  listing_url text,
  source_type text not null default 'manual', -- api|rss|atom|json|html|manual
  enabled boolean not null default false,
  integration_status text not null default 'pending', -- pending|connected|degraded|unsupported|blocked|error
  status_note text,
  robots_policy text,
  terms_note text,
  fetch_config jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists job_categories (
  id bigserial primary key,
  slug text not null unique,
  name text not null,
  keywords text[] not null default '{}'
);

create table if not exists organizations (
  id bigserial primary key,
  name text not null,
  normalized_name text not null,
  website text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name)
);

create table if not exists job_listings (
  id bigserial primary key,
  -- compatibility with existing frontend shape
  legacy_external_key text unique, -- stable key for upserts (source+external id or hash)
  title text not null,
  company text not null,
  organization_id bigint references organizations(id) on delete set null,
  logo text,
  category text, -- primary label for compatibility
  location text,
  region_city text,
  job_type text,
  vacancies integer,
  education_requirements text,
  experience_requirements text,
  required_skills text[] not null default '{}',
  salary text,
  posted_date date,
  deadline date,
  description text,
  description_excerpt text,
  requirements text,
  application_instructions text,
  contact_email text,
  original_url text,
  primary_source_id bigint references job_sources(id) on delete set null,
  origin text not null default 'aggregated', -- aggregated|direct
  status text not null default 'active', -- active|expired|archived|pending|rejected|draft
  featured boolean not null default false,
  moderation_note text,
  normalized_title text,
  dedup_hash text,
  collected_at timestamptz,
  last_verified_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_listings_status_deadline_idx on job_listings (status, deadline desc nulls last);
create index if not exists job_listings_posted_idx on job_listings (posted_date desc nulls last, created_at desc);
create index if not exists job_listings_company_idx on job_listings (lower(company));
create index if not exists job_listings_location_idx on job_listings (lower(coalesce(region_city, location, '')));
create index if not exists job_listings_origin_idx on job_listings (origin);
create index if not exists job_listings_search_idx on job_listings using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(company,'') || ' ' || coalesce(description,'') || ' ' || coalesce(requirements,'') || ' ' || coalesce(location,'')));

create table if not exists job_listing_sources (
  id bigserial primary key,
  listing_id bigint not null references job_listings(id) on delete cascade,
  source_id bigint not null references job_sources(id) on delete cascade,
  external_id text,
  source_url text not null,
  collected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  is_primary boolean not null default false,
  raw_payload jsonb,
  unique (source_id, source_url)
);

create index if not exists job_listing_sources_listing_idx on job_listing_sources (listing_id);
create index if not exists job_listing_sources_external_idx on job_listing_sources (source_id, external_id) where external_id is not null;

create table if not exists job_listing_categories (
  listing_id bigint not null references job_listings(id) on delete cascade,
  category_id bigint not null references job_categories(id) on delete cascade,
  primary key (listing_id, category_id)
);

create table if not exists job_sync_runs (
  id bigserial primary key,
  source_id bigint references job_sources(id) on delete set null,
  trigger_type text not null default 'manual', -- manual|cron|api
  status text not null default 'running', -- running|ok|error|partial
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched_count integer not null default 0,
  new_count integer not null default 0,
  updated_count integer not null default 0,
  duplicate_count integer not null default 0,
  expired_count integer not null default 0,
  error_count integer not null default 0,
  message text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists job_sync_runs_started_idx on job_sync_runs (started_at desc);

create table if not exists employer_submissions (
  id bigserial primary key,
  listing_id bigint references job_listings(id) on delete set null,
  submitter_user_ref text, -- maps to existing auth identity (email/id) until server auth is unified
  submitter_email text,
  organization_name text,
  payload jsonb not null,
  approval_status text not null default 'pending', -- pending|approved|rejected
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists job_merge_queue (
  id bigserial primary key,
  candidate_listing_id bigint references job_listings(id) on delete cascade,
  existing_listing_id bigint references job_listings(id) on delete cascade,
  reason text,
  confidence numeric(5,2),
  status text not null default 'pending', -- pending|merged|dismissed
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolver_note text
);

-- seed known sources (disabled/pending until verified and safely configured)
insert into job_sources (slug, name, base_url, listing_url, source_type, enabled, integration_status, status_note) values
  ('ethiojobs', 'Ethiojobs', 'https://www.ethiojobs.net/', 'https://www.ethiojobs.net/', 'html', false, 'pending', 'Verify ToS/robots and permitted access; structure may be JS-rendered.'),
  ('hahu-jobs', 'HaHu Jobs', 'https://www.hahu.jobs/', 'https://www.hahu.jobs/', 'html', false, 'pending', 'Verify permitted automated access and listing structure.'),
  ('prjobs', 'PR Jobs Ethiopia', 'https://prjobs.et/', 'https://prjobs.et/', 'html', false, 'pending', 'Verify permitted access.'),
  ('dereja', 'Dereja', 'https://dereja.com/', 'https://dereja.com/', 'html', false, 'pending', 'Verify permitted access.'),
  ('ezega-jobs', 'Ezega Jobs', 'https://www.ezega.com/Jobs/', 'https://www.ezega.com/Jobs/', 'html', false, 'pending', 'Verify permitted access.'),
  ('jobwebethiopia', 'JobWeb Ethiopia', 'https://www.jobwebethiopia.com/', 'https://www.jobwebethiopia.com/', 'html', false, 'pending', 'Verify permitted access.'),
  ('ngojobs', 'NGO Jobs Ethiopia', 'https://ngojobs.et/', 'https://ngojobs.et/', 'html', false, 'pending', 'Verify permitted access.'),
  ('workethiopia', 'Work Ethiopia', 'https://workethiopia.net/', 'https://workethiopia.net/', 'html', false, 'pending', 'Verify permitted access.'),
  ('srazone', 'SRA Zone', 'https://srazone.et/', 'https://srazone.et/', 'html', false, 'pending', 'Verify permitted access.'),
  ('ethiopian-reporter', 'Ethiopian Reporter Jobs', 'https://www.ethiopianreporter.com/', 'https://www.ethiopianreporter.com/', 'html', false, 'pending', 'Verify jobs section URL and permitted access.'),
  ('reliefweb-ethiopia', 'ReliefWeb (Ethiopia)', 'https://reliefweb.int/', 'https://reliefweb.int/jobs?search=country.name%3A%22Ethiopia%22', 'rss', false, 'pending', 'ReliefWeb provides RSS/API discovery; verify terms/rate limits before enabling.'),
  ('unjobs-ethiopia', 'UN Jobs (Ethiopia)', 'https://unjobs.org/', 'https://unjobs.org/duty_stations/ethiopia', 'html', false, 'pending', 'Aggregator site; verify permitted access/attribution.'),
  ('un-ethiopia', 'UN in Ethiopia Jobs', 'https://ethiopia.un.org/', 'https://ethiopia.un.org/en/jobs', 'html', false, 'pending', 'Verify jobs listing structure/API.'),
  ('devnetjobs', 'DevNetJobs', 'https://www.devnetjobs.org/', 'https://www.devnetjobs.org/', 'html', false, 'pending', 'Verify Ethiopia-filtered feed and permitted access.'),
  ('indeed-ethiopia', 'Indeed Ethiopia', 'https://et.indeed.com/', 'https://et.indeed.com/', 'html', false, 'unsupported', 'Commercial job board; automated access commonly restricted. Prefer authorized API/partnership or manual import.')
on conflict (slug) do nothing;

insert into job_categories (slug, name, keywords) values
  ('public-health', 'Public Health', array['public health','health promotion','community health']),
  ('epidemiology', 'Epidemiology', array['epidemiolog','surveillance','outbreak']),
  ('environmental-health', 'Environmental Health', array['environmental health','wash','sanitation','hygiene']),
  ('health-informatics', 'Health Informatics', array['health informatics','dhis','digital health','his']),
  ('health-data-management', 'Health Data Management', array['data management','health data','data officer']),
  ('biostatistics', 'Biostatistics', array['biostat','statistician']),
  ('monitoring-evaluation', 'Monitoring and Evaluation', array['monitoring and evaluation','m&e','merl','meal']),
  ('research', 'Research', array['research','study coordinator','principal investigator']),
  ('laboratory', 'Laboratory', array['laboratory','lab techn','medical lab']),
  ('medicine', 'Medicine', array['medical doctor','physician','clinician']),
  ('nursing', 'Nursing', array['nurse','nursing','midwife']),
  ('nutrition', 'Nutrition', array['nutrition','diet']),
  ('pharmacy', 'Pharmacy', array['pharmacist','pharmacy']),
  ('information-technology', 'Information Technology', array['software','developer','it ','information technology','system admin','network']),
  ('data-science', 'Data Science', array['data science','machine learning','analytics']),
  ('statistics', 'Statistics', array['statistics','statistical']),
  ('finance', 'Finance', array['finance','financial','accountant','accounting','audit']),
  ('administration', 'Administration', array['admin','administration','office']),
  ('human-resources', 'Human Resources', array['human resources','hr ','recruit']),
  ('engineering', 'Engineering', array['engineer','civil','mechanical','electrical']),
  ('education', 'Education', array['teacher','education','training','instructor']),
  ('agriculture', 'Agriculture', array['agriculture','agronom','livestock','farmer']),
  ('development', 'Development', array['development','program officer','project officer']),
  ('humanitarian', 'Humanitarian', array['humanitarian','emergency','relief','refugee']),
  ('logistics', 'Logistics', array['logistics','procurement','supply chain','warehouse']),
  ('other', 'Other', array[]::text[])
on conflict (slug) do nothing;
