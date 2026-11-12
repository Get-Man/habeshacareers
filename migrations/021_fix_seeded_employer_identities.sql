-- 021_fix_seeded_employer_identities.sql
--
-- The identity seeding in migration 020 matched organisations by name
-- pattern but joined the pattern table without a condition, so every
-- organisation that matched a pattern was given an ARBITRARY domain from
-- the list. For example "Awash Insurance Company" was given "unicef.org".
--
-- This migration clears those identities and re-seeds them with the correct
-- domain for each organisation, using a lateral match so exactly one domain
-- is chosen per organisation.
--
-- This migration is additive: no column is dropped, no row is deleted.

-- ---------------------------------------------------------------------------
-- 1. Clear the identities that were seeded from the name pattern.
--    A favicon that was derived from the wrong domain is cleared as well, so
--    the official mark of the right organisation is resolved again.
-- ---------------------------------------------------------------------------
update employer_directory
set website_url = null,
    website_domain = null,
    identity_source = null,
    identity_checked_at = null,
    logo_url = case when logo_source = 'favicon_service' then null else logo_url end,
    logo_public_url = case when logo_source = 'favicon_service' then null else logo_public_url end,
    logo_verified = case when logo_source = 'favicon_service' then false else logo_verified end,
    logo_confidence = case when logo_source = 'favicon_service' then 0 else logo_confidence end,
    logo_verified_at = case when logo_source = 'favicon_service' then null else logo_verified_at end,
    updated_at = now()
where identity_source = 'known_employer';

-- ---------------------------------------------------------------------------
-- 2. Re-seed the identity of the organisations we can recognise by name.
--    The longest matching pattern wins, so a specific organisation is never
--    captured by a general one.
-- ---------------------------------------------------------------------------
with mapping(pattern, domain) as (values
    ('%united nations development programme%', 'undp.org'),
    ('%united nations population fund%',      'unfpa.org'),
    ('%united nations children%',             'unicef.org'),
    ('%united nations humanitarian affairs%',  'unocha.org'),
    ('%united nations high commissioner for refugees%', 'unhcr.org'),
    ('%united nations office%',               'un.org'),
    ('%united nations%',                      'un.org'),
    ('%unicef ethiopia%',                     'unicef.org'),
    ('%unicef%',                              'unicef.org'),
    ('%world health organization%',           'who.int'),
    ('%world food programme%',                'wfp.org'),
    ('%international labour organization%',   'ilo.org'),
    ('%food and agriculture organization%',   'fao.org'),
    ('%international organization for migration%', 'iom.int'),
    ('%un women%',                            'unwomen.org'),
    ('%world bank%',                          'worldbank.org'),
    ('%usaid%',                               'usaid.gov'),
    ('%international rescue committee%',      'rescue.org'),
    ('%mercy corps%',                         'mercycorps.org'),
    ('%save the children%',                   'savethechildren.net'),
    ('%world vision%',                        'worldvision.org'),
    ('%plan international%',                  'plan-international.org'),
    ('%amref%',                               'amref.org'),
    ('%jhpiego%',                             'jhpiego.org'),
    ('%fhi 360%',                             'fhi360.org'),
    ('%ethiopian airlines%',                  'ethiopianairlines.com'),
    ('%ethio telecom%',                       'ethiotelecom.et'),
    ('%commercial bank of ethiopia%',         'combanketh.et'),
    ('%awash insurance%',                     'awashinsurance.com'),
    ('%ethiopian electricity%',               'eep.com.et'),
    ('%addis ababa science and technology%',  'aast.edu.et'),
    ('%addis ababa university%',              'aau.edu.et'),
    ('%st marys university%',                 'smuc.edu.et'),
    ('%jiva school%',                         'jivaschool.com'),
    ('%kality foods%',                        'kalityfoods.com.et'),
    ('%hijra bank%',                          'hijrabank.com'),
    ('%beaeka%',                              'beaeka.com'),
    ('%nib candy%',                           'nibintl.com'),
    ('%new paradigm%',                        'newparadigmconsultancy.com')
),
picked as (
  select e.id,
         (select m.domain
            from mapping m
           where e.name ilike m.pattern
           order by length(m.pattern) desc
           limit 1) as domain
    from employer_directory e
)
update employer_directory e
set website_url = 'https://' || p.domain,
    website_domain = p.domain,
    identity_source = 'known_employer',
    updated_at = now()
from picked p
where e.id = p.id
  and p.domain is not null
  and e.website_domain is null;

-- ---------------------------------------------------------------------------
-- 3. The official favicon of the organisation's OWN domain is always a safe
--    official mark: it is served by the organisation itself, never by the job
--    board that published the vacancy. The runtime backfill replaces it with
--    the organisation's own wordmark when the site exposes one.
-- ---------------------------------------------------------------------------
update employer_directory e
set logo_url = 'https://www.google.com/s2/favicons?domain=' || e.website_domain || '&sz=128',
    logo_public_url = 'https://www.google.com/s2/favicons?domain=' || e.website_domain || '&sz=128',
    logo_host_kind = 'employer',
    logo_source = 'favicon_service',
    logo_confidence = 55,
    logo_verified = true,
    logo_verified_at = now(),
    updated_at = now()
where e.website_domain is not null
  and e.logo_public_url is null;

-- ---------------------------------------------------------------------------
-- 4. Every listing of an organisation points at its directory entry, so all
--    of that organisation's vacancies share one identity and one logo.
-- ---------------------------------------------------------------------------
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
