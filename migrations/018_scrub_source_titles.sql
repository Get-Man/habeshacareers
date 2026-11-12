-- 018_scrub_source_titles.sql
-- Removes third-party source attribution from stored vacancy titles.
--
-- A job board appends its own name to the headline it publishes, for example
--   "Secretary via GeezJobs"
--   "Accountant | GeezJobs"
--
-- The vacancy title belongs to the employer, so the attribution clause is
-- removed. The public URL is derived from the title, so this also keeps the
-- source's name out of every vacancy link.
--
-- Only a trailing attribution clause is removed. A brand that is part of the
-- employer's own headline ("Siinqee Bank ... Apply for 55 Jobs in Ethiopia")
-- is left alone, because it is content and not attribution.
--
-- Newly extracted rows are already scrubbed by the extraction pipeline
-- (scrubSourceTitle); this migration cleans the historical rows.
--
-- NOTE: PostgreSQL regular expressions use [[:<:]] / [[:>:]] for word
-- boundaries (\b means backspace in a POSIX regex), so those classes are used
-- throughout this file.

-- 1) Remove a trailing "via <source>" / "at <source>" attribution clause.
update job_listings
set title = regexp_replace(
      title,
      '\s+(?:via|at|on|from|through)[[:space:]]+(?:[[:<:]]geez[[:space:]]*jobs[[:>:]]|[[:<:]]geezjobs[[:>:]]|[[:<:]]ethio[[:space:]]*jobs[[:>:]]|[[:<:]]ethiojobs[[:>:]]|[[:<:]]ethio-jobs[[:>:]]|[[:<:]]et[[:space:]]*careers[[:>:]]|[[:<:]]etcareers[[:>:]]|[[:<:]]work[[:space:]]*ethiopia[[:>:]]|[[:<:]]workethiopia[[:>:]]|[[:<:]]alljobspo[[:>:]]|[[:<:]]jobs[[:space:]]+in[[:space:]]+ethiopia[[:>:]]|[[:<:]]ethiopian[[:space:]]*reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reliefweb[[:>:]]|[[:<:]]un[[:space:]]*careers[[:>:]]|[[:<:]]unjobs[[:>:]]|[[:<:]]hahu[[:space:]]*jobs[[:>:]]|[[:<:]]dereja[[:>:]]|[[:<:]]ezega[[:>:]]|[[:<:]]jobweb[[:space:]]*ethiopia[[:>:]]|[[:<:]]ngojobs[[:>:]]|[[:<:]]sirazone[[:>:]]|[[:<:]]srazone[[:>:]]|[[:<:]]ethiopian[[:space:]]*jobs[[:>:]])[[:space:]]*\.?[[:space:]]*$',
      '',
      'i')
where title ~* '\s+(?:via|at|on|from|through)[[:space:]]+(?:[[:<:]]geez[[:space:]]*jobs[[:>:]]|[[:<:]]geezjobs[[:>:]]|[[:<:]]ethio[[:space:]]*jobs[[:>:]]|[[:<:]]ethiojobs[[:>:]]|[[:<:]]ethio-jobs[[:>:]]|[[:<:]]et[[:space:]]*careers[[:>:]]|[[:<:]]etcareers[[:>:]]|[[:<:]]work[[:space:]]*ethiopia[[:>:]]|[[:<:]]workethiopia[[:>:]]|[[:<:]]alljobspo[[:>:]]|[[:<:]]jobs[[:space:]]+in[[:space:]]+ethiopia[[:>:]]|[[:<:]]ethiopian[[:space:]]*reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reliefweb[[:>:]]|[[:<:]]un[[:space:]]*careers[[:>:]]|[[:<:]]unjobs[[:>:]]|[[:<:]]hahu[[:space:]]*jobs[[:>:]]|[[:<:]]dereja[[:>:]]|[[:<:]]ezega[[:>:]]|[[:<:]]jobweb[[:space:]]*ethiopia[[:>:]]|[[:<:]]ngojobs[[:>:]]|[[:<:]]sirazone[[:>:]]|[[:<:]]srazone[[:>:]]|[[:<:]]ethiopian[[:space:]]*jobs[[:>:]])';

-- 2) Remove a trailing "<separator> <source>" attribution suffix.
update job_listings
set title = regexp_replace(
      title,
      '\s*[-|–—:][[:space:]]*(?:[[:<:]]geez[[:space:]]*jobs[[:>:]]|[[:<:]]geezjobs[[:>:]]|[[:<:]]ethio[[:space:]]*jobs[[:>:]]|[[:<:]]ethiojobs[[:>:]]|[[:<:]]ethio-jobs[[:>:]]|[[:<:]]et[[:space:]]*careers[[:>:]]|[[:<:]]etcareers[[:>:]]|[[:<:]]work[[:space:]]*ethiopia[[:>:]]|[[:<:]]workethiopia[[:>:]]|[[:<:]]alljobspo[[:>:]]|[[:<:]]jobs[[:space:]]+in[[:space:]]+ethiopia[[:>:]]|[[:<:]]ethiopian[[:space:]]*reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reliefweb[[:>:]]|[[:<:]]un[[:space:]]*careers[[:>:]]|[[:<:]]unjobs[[:>:]]|[[:<:]]hahu[[:space:]]*jobs[[:>:]]|[[:<:]]dereja[[:>:]]|[[:<:]]ezega[[:>:]]|[[:<:]]jobweb[[:space:]]*ethiopia[[:>:]]|[[:<:]]ngojobs[[:>:]]|[[:<:]]sirazone[[:>:]]|[[:<:]]srazone[[:>:]]|[[:<:]]ethiopian[[:space:]]*jobs[[:>:]])[[:space:]]*\.?[[:space:]]*$',
      '',
      'i')
where title ~* '\s*[-|–—:][[:space:]]*(?:[[:<:]]geez[[:space:]]*jobs[[:>:]]|[[:<:]]geezjobs[[:>:]]|[[:<:]]ethio[[:space:]]*jobs[[:>:]]|[[:<:]]ethiojobs[[:>:]]|[[:<:]]ethio-jobs[[:>:]]|[[:<:]]et[[:space:]]*careers[[:>:]]|[[:<:]]etcareers[[:>:]]|[[:<:]]work[[:space:]]*ethiopia[[:>:]]|[[:<:]]workethiopia[[:>:]]|[[:<:]]alljobspo[[:>:]]|[[:<:]]jobs[[:space:]]+in[[:space:]]+ethiopia[[:>:]]|[[:<:]]ethiopian[[:space:]]*reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reliefweb[[:>:]]|[[:<:]]un[[:space:]]*careers[[:>:]]|[[:<:]]unjobs[[:>:]]|[[:<:]]hahu[[:space:]]*jobs[[:>:]]|[[:<:]]dereja[[:>:]]|[[:<:]]ezega[[:>:]]|[[:<:]]jobweb[[:space:]]*ethiopia[[:>:]]|[[:<:]]ngojobs[[:>:]]|[[:<:]]sirazone[[:>:]]|[[:<:]]srazone[[:>:]]|[[:<:]]ethiopian[[:space:]]*jobs[[:>:]])';

-- 3) Tidy the whitespace left behind by the removals.
update job_listings
set title = btrim(regexp_replace(title, '[[:space:]]{2,}', ' ', 'g'))
where title is not null;

-- 4) Keep the deduplication key in step with the corrected title.
--
--    This mirrors the JavaScript norm() used by the repository:
--      s.toLowerCase().replace(/\s+/g," ").replace(/[^a-z0-9\u1200-\u137f ]/g,"").trim()
update job_listings
set normalized_title = regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(title)), '[[:space:]]+', ' ', 'g'),
        '[^a-z0-9 \u1200-\u137f]', '', 'g'),
      '^ +| +$', '', 'g')
where title is not null
  and normalized_title is distinct from regexp_replace(
        regexp_replace(
          regexp_replace(lower(btrim(title)), '[[:space:]]+', ' ', 'g'),
          '[^a-z0-9 \u1200-\u137f]', '', 'g'),
        '^ +| +$', '', 'g');
