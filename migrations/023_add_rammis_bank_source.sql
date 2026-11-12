-- Add Rammis Bank official careers/vacancy source.
-- Vacancies are published on https://rammisbank.et/jobs and served via a public JSON API.

insert into job_sources (slug, name, base_url, listing_url, source_type, adapter_key, enabled, integration_status, status_note, fetch_config)
values (
  'rammis-bank',
  'Rammis Bank',
  'https://rammisbank.et/',
  'https://rammisbank.et/jobs',
  'api',
  'rammis-bank',
  true,
  'connected',
  'Official Rammis Bank careers page. Vacancies fetched from public API endpoint /api/vacancies.',
  '{"apiUrl":"https://rammisbank.et/api/vacancies","limit":200}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    base_url = excluded.base_url,
    listing_url = excluded.listing_url,
    source_type = excluded.source_type,
    adapter_key = excluded.adapter_key,
    enabled = excluded.enabled,
    integration_status = excluded.integration_status,
    status_note = excluded.status_note,
    fetch_config = coalesce(job_sources.fetch_config, '{}'::jsonb) || excluded.fetch_config,
    updated_at = now();
