-- Add WorkEthiopia as a public, robots-allowed source with official employer application links.
-- Also document generic RSS/Atom feed support via fetch_config.feedUrl.

insert into job_sources (slug, name, base_url, listing_url, source_type, enabled, integration_status, status_note, fetch_config)
values (
  'workethiopia',
  'WorkEthiopia',
  'https://workethiopia.net/',
  'https://workethiopia.net/',
  'html',
  false,
  'pending',
  'Public job listings; robots.txt allows all. Best-effort connector resolves official employer application links (organization exact links) from detail pages. Verify terms/rate limits before enabling.',
  '{"limit":12}'::jsonb
)
on conflict (slug) do update set
  name = excluded.name,
  base_url = excluded.base_url,
  listing_url = excluded.listing_url,
  status_note = excluded.status_note,
  fetch_config = job_sources.fetch_config || excluded.fetch_config,
  updated_at = now();

update job_sources
set status_note = coalesce(status_note,'') || ' Generic RSS/Atom feeds can be synced when source_type/rss config includes an authorized feedUrl in fetch_config.'
where slug = 'authorized-org-feeds' and (status_note not like '%Generic RSS/Atom%');
