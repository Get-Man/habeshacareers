-- Ensure all requested Ethiopian/international job websites and authorized org feeds are registered.
-- Adds missing sources and updates metadata/status notes. Connectors remain disabled by default;
-- enable only after verifying terms, robots, rate limits, and permitted access for your deployment.

insert into job_sources (slug, name, base_url, listing_url, source_type, enabled, integration_status, status_note) values
  ('ethiojobs', 'Ethiojobs', 'https://www.ethiojobs.net/', 'https://www.ethiojobs.net/', 'html', false, 'pending', 'Requested source. Verify ToS/robots/permitted access. Public listing pages may be JS-rendered; use authorized feed or approved integration if available.'),
  ('hahu-jobs', 'HaHu Jobs', 'https://www.hahu.jobs/', 'https://www.hahu.jobs/', 'html', false, 'pending', 'Requested source. Verify permitted automated access and available feed/API before integration.'),
  ('prjobs', 'PRJobs Ethiopia', 'https://prjobs.et/', 'https://prjobs.et/', 'html', false, 'pending', 'Requested source. Verify permitted access and listing/feed structure.'),
  ('dereja', 'Dereja', 'https://dereja.com/', 'https://dereja.com/jobs', 'html', false, 'pending', 'Requested source. Verify permitted access and listing/feed structure.'),
  ('ezega-jobs', 'Ezega Jobs', 'https://www.ezega.com/Jobs/', 'https://www.ezega.com/Jobs/', 'html', false, 'pending', 'Requested source. Verify permitted access and listing/feed structure.'),
  ('jobwebethiopia', 'JobWebEthiopia', 'https://www.jobwebethiopia.com/', 'https://www.jobwebethiopia.com/', 'html', false, 'pending', 'Requested source. Verify permitted access and listing/feed structure.'),
  ('ngojobs', 'NGOJobs (NGO Jobs in Ethiopia)', 'https://ngojobs.et/', 'https://ngojobs.et/', 'html', false, 'pending', 'Requested source. Verify permitted access and listing/feed structure.'),
  ('workethiopia', 'WorkEthiopia', 'https://workethiopia.net/', 'https://workethiopia.net/', 'html', false, 'pending', 'Requested source. Verify permitted access and listing/feed structure.'),
  ('srazone', 'SRA Zone', 'https://srazone.et/', 'https://srazone.et/', 'html', false, 'pending', 'Requested source. Verify permitted access and listing/feed structure.'),
  ('ethiopian-reporter', 'Ethiopian Reporter Jobs', 'https://www.ethiopianreporterjobs.com/', 'https://www.ethiopianreporterjobs.com/', 'html', false, 'pending', 'Requested source. Verify exact jobs URL, ToS/robots, and permitted access before integration.'),
  ('reliefweb-ethiopia', 'ReliefWeb (Ethiopia)', 'https://reliefweb.int/', 'https://api.reliefweb.int/v1/jobs?appname=habeshacareers-aggregator', 'json', false, 'pending', 'Public ReliefWeb API connector available (disabled by default). Verify ReliefWeb terms/rate limits and attribution before enabling.'),
  ('unjobs-ethiopia', 'UNJobs (Ethiopia)', 'https://unjobs.org/', 'https://unjobs.org/duty_stations/ethiopia', 'html', false, 'pending', 'Requested aggregator source. Best-effort HTML connector exists but may be blocked (HTTP 403 observed). Verify permitted access; prefer official/authorized feeds.'),
  ('un-ethiopia', 'UN in Ethiopia Jobs', 'https://ethiopia.un.org/', 'https://ethiopia.un.org/en/jobs', 'html', false, 'pending', 'Public UN in Ethiopia jobs page connector available (disabled by default). Verify terms/robots/rate limits before enabling.'),
  ('devnetjobs', 'DevNetJobs', 'https://www.devnetjobs.org/', 'https://www.devnetjobs.org/', 'html', false, 'pending', 'Requested source. Verify Ethiopia-filtered feed/API and permitted access before integration.'),
  ('indeed-ethiopia', 'Indeed Ethiopia', 'https://et.indeed.com/', 'https://et.indeed.com/', 'html', false, 'unsupported', 'Commercial job board. Automated access commonly restricted/prohibited; use only with authorized API/partnership or approved manual import.'),
  ('authorized-org-feeds', 'Authorized Organization Feeds', null, null, 'json', false, 'pending', 'Placeholder for authorized organization RSS/Atom/JSON/API feeds. Add feed URLs in source config only with explicit permission/terms compliance.')
on conflict (slug) do update set
  name = excluded.name,
  base_url = coalesce(excluded.base_url, job_sources.base_url),
  listing_url = coalesce(excluded.listing_url, job_sources.listing_url),
  source_type = case when job_sources.integration_status = 'connected' then job_sources.source_type else excluded.source_type end,
  integration_status = case when job_sources.integration_status = 'connected' then job_sources.integration_status else excluded.integration_status end,
  status_note = excluded.status_note,
  updated_at = now();
