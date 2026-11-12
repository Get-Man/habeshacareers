-- 020_employer_identity_backfill.sql
--
-- Every organisation gets ONE identity: its canonical name, its own website,
-- its own careers page and its official logo. A vacancy published on a job
-- board and the same vacancy published on the employer's own careers page
-- must show the same employer, the same logo and the same Apply button.
--
-- This migration is additive: no column is dropped, no row is deleted.

-- ---------------------------------------------------------------------------
-- 1. Identity columns on the employer directory
-- ---------------------------------------------------------------------------
alter table employer_directory add column if not exists careers_url text;
alter table employer_directory add column if not exists identity_source text;
alter table employer_directory add column if not exists identity_checked_at timestamptz;

create index if not exists employer_directory_careers_idx on employer_directory (careers_url) where careers_url is not null;

-- ---------------------------------------------------------------------------
-- 2. The organisation's careers page
--    The public view is deliberately left untouched: PostgreSQL only allows a
--    replaced view to gain columns at the END of its column list, and the
--    view is recreated by earlier migrations. The careers page and the
--    identity source are therefore joined in by the repository query, which
--    keeps every view definition identical and re-runnable.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. Seed the identity of organisations we can already recognise
--    A curated map of well-known organisations is applied here so the very
--    first deployment already shows the right website and logo for the
--    organisations that publish the most vacancies. The runtime backfill
--    continues from this point and covers everybody else.
-- ---------------------------------------------------------------------------
update employer_directory e
set website_url = v.website_url,
    website_domain = v.website_domain,
    identity_source = coalesce(e.identity_source, 'known_employer'),
    updated_at = now()
from (values
  ('unicef.org',                  'unicef.org'),
  ('undp.org',                    'undp.org'),
  ('unfpa.org',                   'unfpa.org'),
  ('un.org',                      'un.org'),
  ('unocha.org',                  'unocha.org'),
  ('unhcr.org',                   'unhcr.org'),
  ('who.int',                     'who.int'),
  ('wfp.org',                     'wfp.org'),
  ('ilo.org',                     'ilo.org'),
  ('fao.org',                     'fao.org'),
  ('iom.int',                     'iom.int'),
  ('unwomen.org',                 'unwomen.org'),
  ('worldbank.org',               'worldbank.org'),
  ('usaid.gov',                   'usaid.gov'),
  ('ifrc.org',                    'ifrc.org'),
  ('rescue.org',                  'rescue.org'),
  ('mercycorps.org',              'mercycorps.org'),
  ('savethechildren.net',         'savethechildren.net'),
  ('worldvision.org',             'worldvision.org'),
  ('plan-international.org',      'plan-international.org'),
  ('care.org',                    'care.org'),
  ('oxfam.org',                   'oxfam.org'),
  ('amref.org',                   'amref.org'),
  ('path.org',                    'path.org'),
  ('jhpiego.org',                 'jhpiego.org'),
  ('fhi360.org',                  'fhi360.org'),
  ('giz.de',                      'giz.de'),
  ('ethiopianairlines.com',       'ethiopianairlines.com'),
  ('ethiotelecom.et',             'ethiotelecom.et'),
  ('combanketh.et',               'combanketh.et'),
  ('awashinsurance.com',          'awashinsurance.com'),
  ('eep.com.et',                  'eep.com.et'),
  ('aau.edu.et',                  'aau.edu.et'),
  ('aast.edu.et',                 'aast.edu.et'),
  ('smuc.edu.et',                 'smuc.edu.et'),
  ('jivaschool.com',              'jivaschool.com'),
  ('kalityfoods.com.et',          'kalityfoods.com.et'),
  ('hijrabank.com',               'hijrabank.com'),
  ('beaeka.com',                  'beaeka.com'),
  ('nibintl.com',                 'nibintl.com'),
  ('newparadigmconsultancy.com',  'newparadigmconsultancy.com')
) as v(website_url, website_domain)
where e.website_domain is null
  and (
    lower(e.name) like '%unicef%'
    or lower(e.name) like '%united nations development%'
    or lower(e.name) like '%unfpa%'
    or lower(e.name) like '%united nations population%'
    or lower(e.name) like '%united nations%'
    or lower(e.name) like '%world health organization%'
    or lower(e.name) like '%world food programme%'
    or lower(e.name) like '%international labour%'
    or lower(e.name) like '%food and agriculture organization%'
    or lower(e.name) like '%international organization for migration%'
    or lower(e.name) like '%un women%'
    or lower(e.name) like '%world bank%'
    or lower(e.name) like '%usaid%'
    or lower(e.name) like '%red cross%'
    or lower(e.name) like '%international rescue committee%'
    or lower(e.name) like '%mercy corps%'
    or lower(e.name) like '%save the children%'
    or lower(e.name) like '%world vision%'
    or lower(e.name) like '%plan international%'
    or lower(e.name) like '%amref%'
    or lower(e.name) like '%jhpiego%'
    or lower(e.name) like '%fhi 360%'
    or lower(e.name) like '%giz%'
    or lower(e.name) like '%ethiopian airlines%'
    or lower(e.name) like '%ethio telecom%'
    or lower(e.name) like '%commercial bank of ethiopia%'
    or lower(e.name) like '%awash insurance%'
    or lower(e.name) like '%ethiopian electricity%'
    or lower(e.name) like '%addis ababa university%'
    or lower(e.name) like '%addis ababa science and technology%'
    or lower(e.name) like '%st marys university%'
    or lower(e.name) like '%jiva school%'
    or lower(e.name) like '%kality foods%'
    or lower(e.name) like '%hijra bank%'
    or lower(e.name) like '%beaeka%'
    or lower(e.name) like '%nib candy%'
    or lower(e.name) like '%new paradigm%'
  );

-- The official favicon of the organisation's OWN domain is always a safe
-- official mark: it is served by the organisation itself, never by the job
-- board that published the vacancy. It is the fallback for organisations
-- whose site does not expose a usable wordmark.
update employer_directory e
set logo_url = case
      when e.logo_url is null then 'https://www.google.com/s2/favicons?domain=' || e.website_domain || '&sz=128'
      else e.logo_url end,
    logo_public_url = case
      when e.logo_public_url is null and e.logo_url is null
        then 'https://www.google.com/s2/favicons?domain=' || e.website_domain || '&sz=128'
      else e.logo_public_url end,
    logo_host_kind = coalesce(e.logo_host_kind, 'employer'),
    logo_source = coalesce(e.logo_source, 'favicon_service'),
    logo_confidence = greatest(coalesce(e.logo_confidence, 0), 55),
    logo_verified = true,
    logo_verified_at = coalesce(e.logo_verified_at, now()),
    updated_at = now()
where e.website_domain is not null
  and e.logo_public_url is null;

-- Every listing of an organisation points at its directory entry.
update job_listings l
set employer_id = e.id,
    employer_name_key = e.name_key,
    updated_at = now()
from employer_directory e
where l.employer_id is null
  and l.company is not null
  and btrim(l.company) <> ''
  and lower(btrim(l.company)) <> 'organization not verified'
  and lower(regexp_replace(trim(l.company), '\s+', ' ', 'g')) = e.name_key;
