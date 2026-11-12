-- 019_scrub_source_brand_titles.sql
-- Removes a discovery source's own name from inside a vacancy title.
--
-- Migration 018 removed the trailing attribution clause ("Secretary via
-- GeezJobs"). A few titles still carried the board's name inside the
-- headline itself, for example
--   "Siinqee Bank S.C. Job Vacancy 2026: Apply for 55 Jobs in Ethiopia"
-- where "Jobs in Ethiopia" is the board's name rather than the employer's
-- wording.
--
-- The same brand list that is removed from a vacancy description is removed
-- from the title here, so a board's name can reach neither the API, the HTML
-- nor a vacancy URL. The employer's own headline is otherwise kept.
--
-- NOTE: PostgreSQL regular expressions use [[:<:]] / [[:>:]] for word
-- boundaries (\b means backspace in a POSIX regex), so those classes are used
-- throughout this file.

-- 1) Remove the source's own name from the title.
update job_listings
set title = regexp_replace(
      title,
      '[[:<:]]geez[[:space:]]*jobs[[:>:]]|[[:<:]]geezjobs[[:>:]]|[[:<:]]ethio[[:space:]]*jobs[[:>:]]|[[:<:]]ethiojobs[[:>:]]|[[:<:]]ethio-jobs[[:>:]]|[[:<:]]et[[:space:]]*careers[[:>:]]|[[:<:]]etcareers[[:>:]]|[[:<:]]work[[:space:]]*ethiopia[[:>:]]|[[:<:]]workethiopia[[:>:]]|[[:<:]]alljobspo[[:>:]]|[[:<:]]jobs[[:space:]]+in[[:space:]]+ethiopia[[:>:]]|[[:<:]]ethiopian[[:space:]]*reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reliefweb[[:>:]]|[[:<:]]un[[:space:]]*careers[[:>:]]|[[:<:]]unjobs[[:>:]]|[[:<:]]hahu[[:space:]]*jobs[[:>:]]|[[:<:]]dereja[[:>:]]|[[:<:]]ezega[[:>:]]|[[:<:]]jobweb[[:space:]]*ethiopia[[:>:]]|[[:<:]]ngojobs[[:>:]]|[[:<:]]sirazone[[:>:]]|[[:<:]]srazone[[:>:]]|[[:<:]]ethiopian[[:space:]]*jobs[[:>:]]',
      ' ',
      'gi')
where title ~* '[[:<:]]geez[[:space:]]*jobs[[:>:]]|[[:<:]]geezjobs[[:>:]]|[[:<:]]ethio[[:space:]]*jobs[[:>:]]|[[:<:]]ethiojobs[[:>:]]|[[:<:]]ethio-jobs[[:>:]]|[[:<:]]et[[:space:]]*careers[[:>:]]|[[:<:]]etcareers[[:>:]]|[[:<:]]work[[:space:]]*ethiopia[[:>:]]|[[:<:]]workethiopia[[:>:]]|[[:<:]]alljobspo[[:>:]]|[[:<:]]jobs[[:space:]]+in[[:space:]]+ethiopia[[:>:]]|[[:<:]]ethiopian[[:space:]]*reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reliefweb[[:>:]]|[[:<:]]un[[:space:]]*careers[[:>:]]|[[:<:]]unjobs[[:>:]]|[[:<:]]hahu[[:space:]]*jobs[[:>:]]|[[:<:]]dereja[[:>:]]|[[:<:]]ezega[[:>:]]|[[:<:]]jobweb[[:space:]]*ethiopia[[:>:]]|[[:<:]]ngojobs[[:>:]]|[[:<:]]sirazone[[:>:]]|[[:<:]]srazone[[:>:]]|[[:<:]]ethiopian[[:space:]]*jobs[[:>:]]';

-- 2) Tidy the whitespace left behind by the removal.
update job_listings
set title = btrim(regexp_replace(title, '[[:space:]]{2,}', ' ', 'g'))
where title is not null;

-- 3) Keep the deduplication key in step with the corrected title.
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
