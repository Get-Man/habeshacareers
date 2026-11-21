-- Original-source provenance for republished vacancy announcements.
--
-- Discovery boards frequently republish a vacancy that was announced
-- somewhere else first. When the extractor verifies an authentic destination
-- (the employer's own site, its ATS, or the original announcement), the row
-- keeps both URLs:
--
--   original_job_url / canonical_job_url -> the authentic vacancy
--   republished_from_url                 -> the board's copy (internal only)
--
-- `is_reposted_announcement` lets the admin review queue surface the rows
-- whose link was upgraded, so the change can be audited. None of these columns
-- are exposed by the public mapper.

alter table job_listings
  add column if not exists republished_from_url text,
  add column if not exists original_source_url text,
  add column if not exists original_source_kind text,
  add column if not exists original_source_confidence integer,
  add column if not exists is_reposted_announcement boolean not null default false,
  add column if not exists original_source_checked_at timestamptz;

comment on column job_listings.republished_from_url is
  'The discovery board page this vacancy was republished from. Internal provenance only; never exposed publicly.';
comment on column job_listings.original_source_url is
  'Verified authentic vacancy destination (employer site, ATS or original announcement), when one was found.';
comment on column job_listings.is_reposted_announcement is
  'True when the announcement was published by another site before the discovery source copied it.';

create index if not exists job_listings_reposted_idx
  on job_listings (is_reposted_announcement)
  where is_reposted_announcement;

-- Employer logo provenance: records how a missing logo was resolved, so the
-- brand-asset/logo-search fallback can be audited instead of guessed at.
alter table employer_directory
  add column if not exists logo_search_checked_at timestamptz,
  add column if not exists logo_search_source text;

comment on column employer_directory.logo_search_source is
  'How a missing logo was resolved: employer_site, logo_search (Google/Clearbit keyed on the employer domain), favicon_service, or null.';