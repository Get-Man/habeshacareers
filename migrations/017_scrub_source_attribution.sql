-- 017_scrub_source_attribution.sql
-- Removes third-party source attribution from legacy vacancy text.
--
-- Vacancies collected before the two-stage pipeline could carry the
-- publishing site's branding in their stored text, for example
--   "This plain-English summary was prepared by workethiopia.net ..."
--   "Apply via the official UN Careers page: https://careers.un.org/..."
--
-- The source name, domain and URL are removed from the public text so no
-- discovery source is advertised to visitors. The employer's own
-- instructions are preserved. Newly extracted rows are already scrubbed by
-- the extraction pipeline; this migration cleans the historical rows.
--
-- NOTE: PostgreSQL regular expressions use [[:<:]] / [[:>:]] for word
-- boundaries (\b means backspace in a POSIX regex), so those classes are used
-- throughout this file.

-- 1) Remove source URLs from the instruction and description text.
update job_listings
set application_instructions = regexp_replace(
      application_instructions,
      'https?://(?:[\w-]+\.)*(?:geezjobs\.com|ethiojobs\.net(?:\.et)?|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)(?:/[^\s"''<>)]*)?',
      ' ',
      'gi')
where application_instructions ~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)';

update job_listings
set description = regexp_replace(
      description,
      'https?://(?:[\w-]+\.)*(?:geezjobs\.com|ethiojobs\.net(?:\.et)?|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)(?:/[^\s"''<>)]*)?',
      ' ',
      'gi')
where description ~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)';

update job_listings
set description_excerpt = regexp_replace(
      description_excerpt,
      'https?://(?:[\w-]+\.)*(?:geezjobs\.com|ethiojobs\.net(?:\.et)?|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)(?:/[^\s"''<>)]*)?',
      ' ',
      'gi')
where description_excerpt ~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)';

-- 2) Remove the whole attribution clause first, so the sentence stays
--    readable: "prepared by workethiopia.net" becomes "prepared from the
--    original advert".
update job_listings
set description = regexp_replace(
      description,
      '(prepared|published|listed|posted|advertised|scraped|collected)[[:space:]]+by?[[:space:]]*(the[[:space:]]+)?[[:alnum:]._-]*[.]?(geezjobs|ethiojobs|ethio-jobs|etcareers|workethiopia|alljobspo|jobsinetiopia|ethiopianreporterjobs|reporterjobs|reliefweb|un careers|unjobs|hahu|dereja|ezega|jobwebethiopia|ngojobs|sirazone|srazone|ethiopianjobs)[a-z0-9.-]*[[:alnum:]./-]*[[:space:]]+(from[[:space:]]+the[[:space:]]+original[[:space:]]+advert)?',
      '\1 from the original advert',
      'gi')
where description ~* '(prepared|published|listed|posted|advertised|scraped|collected)[[:space:]]+by?[[:space:]]*(the[[:space:]]+)?[[:alnum:]._-]*(geezjobs|ethiojobs|ethio-jobs|etcareers|workethiopia|alljobspo|ethiopianreporterjobs|reporterjobs|reliefweb|unjobs|hahu|dereja|ezega|jobwebethiopia|ngojobs|sirazone|srazone|ethiopianjobs)';

update job_listings
set description_excerpt = regexp_replace(
      description_excerpt,
      '(prepared|published|listed|posted|advertised|scraped|collected)[[:space:]]+by?[[:space:]]*(the[[:space:]]+)?[[:alnum:]._-]*[.]?(geezjobs|ethiojobs|ethio-jobs|etcareers|workethiopia|alljobspo|jobsinetiopia|ethiopianreporterjobs|reporterjobs|reliefweb|un careers|unjobs|hahu|dereja|ezega|jobwebethiopia|ngojobs|sirazone|srazone|ethiopianjobs)[a-z0-9.-]*[[:alnum:]./-]*[[:space:]]+(from[[:space:]]+the[[:space:]]+original[[:space:]]+advert)?',
      '\1 from the original advert',
      'gi')
where description_excerpt ~* '(prepared|published|listed|posted|advertised|scraped|collected)[[:space:]]+by?[[:space:]]*(the[[:space:]]+)?[[:alnum:]._-]*(geezjobs|ethiojobs|ethio-jobs|etcareers|workethiopia|alljobspo|ethiopianreporterjobs|reporterjobs|reliefweb|unjobs|hahu|dereja|ezega|jobwebethiopia|ngojobs|sirazone|srazone|ethiopianjobs)';

-- 3) Remove source names used as attribution in the stored text. The name is
--    dropped entirely; the surrounding sentence is left readable.
update job_listings
set application_instructions = regexp_replace(
      application_instructions,
      '[[:<:]]geez[[:space:]]*jobs[[:>:]]|[[:<:]]geezjobs[[:>:]]|[[:<:]]ethio[[:space:]]*jobs[[:>:]]|[[:<:]]ethiojobs[[:>:]]|[[:<:]]ethio-jobs[[:>:]]|[[:<:]]et[[:space:]]*careers[[:>:]]|[[:<:]]etcareers[[:>:]]|[[:<:]]work[[:space:]]*ethiopia[[:>:]]|[[:<:]]workethiopia[[:>:]]|[[:<:]]alljobspo[[:>:]]|[[:<:]]jobs[[:space:]]*in[[:space:]]*ethiopia[[:>:]]|[[:<:]]ethiopian[[:space:]]*reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reliefweb[[:>:]]|[[:<:]]un[[:space:]]*careers[[:>:]]|[[:<:]]unjobs[[:>:]]|[[:<:]]hahu[[:space:]]*jobs[[:>:]]|[[:<:]]dereja[[:>:]]|[[:<:]]ezega[[:>:]]|[[:<:]]jobweb[[:space:]]*ethiopia[[:>:]]|[[:<:]]ngojobs[[:>:]]|[[:<:]]sirazone[[:>:]]|[[:<:]]srazone[[:>:]]|[[:<:]]ethiopian[[:space:]]*jobs[[:>:]]',
      '',
      'gi')
where application_instructions ~* 'geez[[:space:]]*jobs|geezjobs|ethio[[:space:]]*jobs|ethiojobs|ethio-jobs|et[[:space:]]*careers|etcareers|work[[:space:]]*ethiopia|workethiopia|alljobspo|jobs[[:space:]]*in[[:space:]]*ethiopia|ethiopian[[:space:]]*reporter[[:space:]]*jobs|reliefweb|un[[:space:]]*careers|unjobs|hahu[[:space:]]*jobs|dereja|ezega|jobweb[[:space:]]*ethiopia|ngojobs|sirazone|srazone|ethiopian[[:space:]]*jobs';

update job_listings
set description = regexp_replace(
      description,
      '[[:<:]]geez[[:space:]]*jobs[[:>:]]|[[:<:]]geezjobs[[:>:]]|[[:<:]]ethio[[:space:]]*jobs[[:>:]]|[[:<:]]ethiojobs[[:>:]]|[[:<:]]ethio-jobs[[:>:]]|[[:<:]]et[[:space:]]*careers[[:>:]]|[[:<:]]etcareers[[:>:]]|[[:<:]]work[[:space:]]*ethiopia[[:>:]]|[[:<:]]workethiopia[[:>:]]|[[:<:]]alljobspo[[:>:]]|[[:<:]]jobs[[:space:]]*in[[:space:]]*ethiopia[[:>:]]|[[:<:]]ethiopian[[:space:]]*reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reliefweb[[:>:]]|[[:<:]]un[[:space:]]*careers[[:>:]]|[[:<:]]unjobs[[:>:]]|[[:<:]]hahu[[:space:]]*jobs[[:>:]]|[[:<:]]dereja[[:>:]]|[[:<:]]ezega[[:>:]]|[[:<:]]jobweb[[:space:]]*ethiopia[[:>:]]|[[:<:]]ngojobs[[:>:]]|[[:<:]]sirazone[[:>:]]|[[:<:]]srazone[[:>:]]|[[:<:]]ethiopian[[:space:]]*jobs[[:>:]]',
      '',
      'gi')
where description ~* 'geez[[:space:]]*jobs|geezjobs|ethio[[:space:]]*jobs|ethiojobs|ethio-jobs|et[[:space:]]*careers|etcareers|work[[:space:]]*ethiopia|workethiopia|alljobspo|jobs[[:space:]]*in[[:space:]]*ethiopia|ethiopian[[:space:]]*reporter[[:space:]]*jobs|reliefweb|un[[:space:]]*careers|unjobs|hahu[[:space:]]*jobs|dereja|ezega|jobweb[[:space:]]*ethiopia|ngojobs|sirazone|srazone|ethiopian[[:space:]]*jobs';

update job_listings
set description_excerpt = regexp_replace(
      description_excerpt,
      '[[:<:]]geez[[:space:]]*jobs[[:>:]]|[[:<:]]geezjobs[[:>:]]|[[:<:]]ethio[[:space:]]*jobs[[:>:]]|[[:<:]]ethiojobs[[:>:]]|[[:<:]]ethio-jobs[[:>:]]|[[:<:]]et[[:space:]]*careers[[:>:]]|[[:<:]]etcareers[[:>:]]|[[:<:]]work[[:space:]]*ethiopia[[:>:]]|[[:<:]]workethiopia[[:>:]]|[[:<:]]alljobspo[[:>:]]|[[:<:]]jobs[[:space:]]*in[[:space:]]*ethiopia[[:>:]]|[[:<:]]ethiopian[[:space:]]*reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reporter[[:space:]]*jobs[[:>:]]|[[:<:]]reliefweb[[:>:]]|[[:<:]]un[[:space:]]*careers[[:>:]]|[[:<:]]unjobs[[:>:]]|[[:<:]]hahu[[:space:]]*jobs[[:>:]]|[[:<:]]dereja[[:>:]]|[[:<:]]ezega[[:>:]]|[[:<:]]jobweb[[:space:]]*ethiopia[[:>:]]|[[:<:]]ngojobs[[:>:]]|[[:<:]]sirazone[[:>:]]|[[:<:]]srazone[[:>:]]|[[:<:]]ethiopian[[:space:]]*jobs[[:>:]]',
      '',
      'gi')
where description_excerpt ~* 'geez[[:space:]]*jobs|geezjobs|ethio[[:space:]]*jobs|ethiojobs|ethio-jobs|et[[:space:]]*careers|etcareers|work[[:space:]]*ethiopia|workethiopia|alljobspo|jobs[[:space:]]*in[[:space:]]*ethiopia|ethiopian[[:space:]]*reporter[[:space:]]*jobs|reliefweb|un[[:space:]]*careers|unjobs|hahu[[:space:]]*jobs|dereja|ezega|jobweb[[:space:]]*ethiopia|ngojobs|sirazone|srazone|ethiopian[[:space:]]*jobs';

-- 3) Remove a bare source domain that is left in the text (for example
--    "prepared by workethiopia.net").
update job_listings
set description = regexp_replace(
      description,
      '[.]?(?:geezjobs\.com|ethiojobs\.net(?:\.et)?|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)',
      '',
      'gi')
where description ~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)';

update job_listings
set description_excerpt = regexp_replace(
      description_excerpt,
      '[.]?(?:geezjobs\.com|ethiojobs\.net(?:\.et)?|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)',
      '',
      'gi')
where description_excerpt ~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)';

update job_listings
set application_instructions = regexp_replace(
      application_instructions,
      '[.]?(?:geezjobs\.com|ethiojobs\.net(?:\.et)?|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)',
      '',
      'gi')
where application_instructions ~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)';

-- 4) Tidy the wording left behind by the removals.
update job_listings
set application_instructions = regexp_replace(
      regexp_replace(
        regexp_replace(application_instructions, '[[:space:]]+', ' ', 'g'),
        'by[[:space:]]+from[[:space:]]+the[[:space:]]+original[[:space:]]+advert', 'from the original advert', 'gi'),
      '(Apply|apply)[[:space:]]+(via|on|through)[[:space:]]+(the[[:space:]]+)?official[[:space:]]+page[[:space:]]*:?', 'Apply on the employer''s official page', 'gi')
where application_instructions is not null;

update job_listings
set description = regexp_replace(
      regexp_replace(
        regexp_replace(description, '[[:space:]]+', ' ', 'g'),
        'by[[:space:]]+from[[:space:]]+the[[:space:]]+original[[:space:]]+advert', 'from the original advert', 'gi'),
      '(via|on|through)[[:space:]]+(the[[:space:]]+)?official[[:space:]]+page', 'on the employer''s official page', 'gi')
where description is not null;

update job_listings
set description_excerpt = regexp_replace(
      regexp_replace(
        regexp_replace(description_excerpt, '[[:space:]]+', ' ', 'g'),
        'by[[:space:]]+from[[:space:]]+the[[:space:]]+original[[:space:]]+advert', 'from the original advert', 'gi'),
      '(via|on|through)[[:space:]]+(the[[:space:]]+)?official[[:space:]]+page', 'on the employer''s official page', 'gi')
where description_excerpt is not null;

-- 4b) Collapse the double space left by the removals.
update job_listings
set application_instructions = regexp_replace(application_instructions, '[[:space:]]{2,}', ' ', 'g')
where application_instructions is not null;

update job_listings
set description = regexp_replace(description, '[[:space:]]{2,}', ' ', 'g')
where description is not null;

update job_listings
set description_excerpt = regexp_replace(description_excerpt, '[[:space:]]{2,}', ' ', 'g')
where description_excerpt is not null;

-- 4c) Remove a domain suffix left orphaned by the name removal (for example
--     "prepared by .net").
update job_listings
set description = regexp_replace(
      description,
      '(by|from|on|via|at)[[:space:]]*[.](net|com|org|et|io|co)([[:space:].,;]|$)', '\1\2', 'gi')
where description ~* '(by|from|on|via|at)[[:space:]]*[.](net|com|org|et|io|co)([[:space:].,;]|$)';

update job_listings
set description_excerpt = regexp_replace(
      description_excerpt,
      '(by|from|on|via|at)[[:space:]]*[.](net|com|org|et|io|co)([[:space:].,;]|$)', '\1\2', 'gi')
where description_excerpt ~* '(by|from|on|via|at)[[:space:]]*[.](net|com|org|et|io|co)([[:space:].,;]|$)';

update job_listings
set application_instructions = regexp_replace(
      application_instructions,
      '(by|from|on|via|at)[[:space:]]*[.](net|com|org|et|io|co)([[:space:].,;]|$)', '\1\2', 'gi')
where application_instructions ~* '(by|from|on|via|at)[[:space:]]*[.](net|com|org|et|io|co)([[:space:].,;]|$)';

-- 5) Drop stored logos that are the publishing site's own favicon or icon.
--    The employer's official logo comes from the employer directory; a
--    source favicon is never shown.
update job_listings
set logo = null
where logo is not null
  and (
    logo ~* 'icons\.duckduckgo\.com/ip3/(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)'
    or logo ~* '[?&]domain=(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)'
    or logo ~* '(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)/'
  )
  and logo !~* '/api/employer-logo';

-- 6) The same for the organisation logo column.
update job_listings
set organization_logo_url = null
where organization_logo_url is not null
  and (
    organization_logo_url ~* 'icons\.duckduckgo\.com/ip3/(geezjobs\.com|ethiojobs\.net|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)'
    or organization_logo_url ~* '[?&]domain=(geezjobs\.com|ethiojobs\.net|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)'
  );

-- 7) An apply destination hosted on a discovery source is dropped; the
--    pipeline resolves the employer's own destination on the next run.
update job_listings
set apply_url = null
where apply_url is not null
  and apply_url ~* '^https?://(geezjobs\.com|ethiojobs\.net|ethio-jobs\.net\.et|etcareers\.com|alljobspo\.com|workethiopia\.net|ethiopianreporterjobs\.com|reliefweb\.int|careers\.un\.org|ethiopia\.un\.org|unjobs\.org|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|srazone\.et|ethiopianjobs\.net)'
  and apply_url_type <> 'source_application';

-- 8) A legacy listing without a verified employer keeps no logo until the
--    next extraction run resolves the organisation's official logo.
update job_listings l
set organization_logo_url = null
where l.organization_logo_url is not null
  and l.employer_id is null;
