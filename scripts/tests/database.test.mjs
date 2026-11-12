// Integration tests against a real Postgres (pglite).
//
// These verify the migrations, the employer directory, the public privacy
// boundary and the repository mapping end to end. The suite is skipped
// gracefully when pglite is not installed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

let PGlite = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  PGlite = null;
}

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

async function freshDb() {
  const db = new PGlite();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    let sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // pglite has no pgcrypto extension; gen_random_uuid() is built in.
    sql = sql.replace(/create extension if not exists pgcrypto;?/gi, "");
    await db.exec(sql);
  }
  return db;
}

const skip = PGlite ? false : "pglite is not installed";

test("all migrations apply cleanly", { skip }, async () => {
  const db = await freshDb();
  const tables = await db.query(
    `select table_name from information_schema.tables
      where table_schema='public' and table_name in
        ('job_listings','job_sources','job_discovery_queue','job_application_candidates',
         'job_admin_audit','job_sync_locks','employer_directory')
      order by table_name`
  );
  const names = tables.rows.map((r) => r.table_name);
  for (const expected of [
    "job_listings",
    "job_sources",
    "job_discovery_queue",
    "job_application_candidates",
    "job_admin_audit",
    "job_sync_locks",
    "employer_directory",
  ]) {
    assert.ok(names.includes(expected), `expected table ${expected}`);
  }
  await db.close();
});

test("the public view exposes no discovery-source column", { skip }, async () => {
  const db = await freshDb();
  const cols = await db.query(
    `select column_name from information_schema.columns
      where table_name='public_job_listings' order by ordinal_position`
  );
  const names = cols.rows.map((r) => r.column_name);
  for (const forbidden of ["source_name", "source_slug", "source_domain", "source_website_name", "original_url", "listing_page_url"]) {
    assert.equal(names.includes(forbidden), false, `public view must not expose ${forbidden}`);
  }
  // Employer identity is public and must be exposed.
  assert.ok(names.includes("employer_logo_url"));
  assert.ok(names.includes("employer_website_url"));
  await db.close();
});

test("the public view only lists active, unexpired vacancies", { skip }, async () => {
  const db = await freshDb();
  await db.exec(`
    insert into job_listings (title, company, status, job_status, deadline, primary_source_id)
    values ('Live role','Amhara Bank','active','open', current_date + 30, null),
           ('Expired role','Amhara Bank','active','open', current_date - 5, null),
           ('Closed role','Amhara Bank','expired','expired', current_date + 30, null),
           ('Pending role','Amhara Bank','pending','needs_verification', current_date + 30, null);
  `);
  const rows = await db.query(`select title from public_job_listings order by title`);
  assert.deepEqual(rows.rows.map((r) => r.title), ["Live role"]);
  await db.close();
});

test("the employer directory holds one identity per organisation", { skip }, async () => {
  const db = await freshDb();
  await db.exec(`
    insert into job_listings (title, company, status, job_status, deadline)
    values ('Role A','Amhara Bank','active','open', current_date + 30),
           ('Role B','Amhara Bank','active','open', current_date + 30),
           ('Role C','Santa Maria Construction','active','open', current_date + 30);
  `);
  // Run the directory backfill the way migration 015 does.
  await db.exec(`
    insert into employer_directory (name, name_key, aliases)
    select company, lower(regexp_replace(trim(company), '\\s+', ' ', 'g')), '{}'::text[]
      from job_listings
     where company is not null and btrim(company) <> ''
     group by company
    on conflict (name_key) do nothing;
    update job_listings l set employer_name_key = lower(regexp_replace(trim(l.company), '\\s+', ' ', 'g'))
      where l.company is not null and l.employer_name_key is null;
    update job_listings l set employer_id = e.id from employer_directory e where l.employer_name_key = e.name_key;
  `);
  const dirs = await db.query(`select name, name_key from employer_directory order by name`);
  assert.equal(dirs.rows.length, 2, "one directory row per organisation");
  const links = await db.query(`select employer_id, count(*)::int as n from job_listings group by employer_id order by employer_id`);
  assert.equal(links.rows[0].n, 2, "both Amhara Bank vacancies share one directory entry");
  assert.equal(links.rows[1].n, 1);
  await db.close();
});

test("a verified employer logo is reused across every vacancy of that organisation", { skip }, async () => {
  const db = await freshDb();
  await db.exec(`
    insert into job_listings (title, company, status, job_status, deadline)
    values ('Role A','Amhara Bank','active','open', current_date + 30),
           ('Role B','Amhara Bank','active','open', current_date + 30);
    insert into employer_directory (name, name_key, logo_url, logo_public_url, logo_verified, logo_confidence)
    values ('Amhara Bank','amhara bank','https://amharabank.com.et/logo.png','https://amharabank.com.et/logo.png', true, 95);
    update job_listings l set employer_id = e.id from employer_directory e
     where l.company = e.name and l.employer_id is null;
  `);
  const rows = await db.query(`
    select l.title, e.logo_public_url
      from public_job_listings l
      left join employer_directory e on e.id = l.employer_id
     order by l.title`);
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0].logo_public_url, rows.rows[1].logo_public_url);
  assert.equal(rows.rows[0].logo_public_url, "https://amharabank.com.et/logo.png");
  await db.close();
});

test("a board-hosted employer logo is exposed through the proxy, not directly", { skip }, async () => {
  const db = await freshDb();
  await db.exec(`
    insert into job_listings (title, company, status, job_status, deadline)
    values ('Role A','Shemmatex','active','open', current_date + 30);
    insert into employer_directory (name, name_key, logo_url, logo_public_url, logo_verified, logo_host_kind)
    values ('Shemmatex','shemmatex','https://geezjobs.com/image/logo/abc.jpeg','/api/employer-logo?id=1', true, 'board_cdn');
    update job_listings l set employer_id = e.id from employer_directory e
     where l.company = e.name and l.employer_id is null;
  `);
  const rows = await db.query(`
    select e.logo_public_url from public_job_listings l
      join employer_directory e on e.id = l.employer_id`);
  assert.equal(rows.rows[0].logo_public_url, "/api/employer-logo?id=1");
  assert.equal(rows.rows[0].logo_public_url.includes("geezjobs"), false);
  await db.close();
});

test("stored titles never keep a discovery source's own name", { skip }, async () => {
  const db = await freshDb();
  // The rows below are inserted before the scrub migration runs, so they
  // reproduce the historical titles that leaked the board's name.
  await db.exec(`
    insert into job_listings (title, company, status, job_status, deadline, normalized_title)
    values ('Secretary via GeezJobs','Amhara Bank','active','open', current_date + 30, 'secretary via geezjobs'),
           ('Accountant | GeezJobs','Addis Trading','active','open', current_date + 30, 'accountant | geezjobs'),
           ('Siinqee Bank S.C. Job Vacancy 2026: Apply for 55 Jobs in Ethiopia','Siinqee Bank','active','open', current_date + 30, 'siinqee bank sc job vacancy 2026 apply for 55 jobs in ethiopia'),
           ('Senior Software Engineer','BlueSpark','active','open', current_date + 30, 'senior software engineer');
  `);
  const migration = fs.readFileSync(path.join(MIGRATIONS_DIR, "018_scrub_source_titles.sql"), "utf8");
  await db.exec(migration);
  const brandMigration = fs.readFileSync(path.join(MIGRATIONS_DIR, "019_scrub_source_brand_titles.sql"), "utf8");
  await db.exec(brandMigration);
  const rows = await db.query(`select title from public_job_listings order by id`);
  const titles = rows.rows.map((r) => r.title);
  assert.deepEqual(titles, [
    "Secretary",
    "Accountant",
    "Siinqee Bank S.C. Job Vacancy 2026: Apply for 55",
    "Senior Software Engineer",
  ]);
  // The deduplication key follows the corrected title.
  const keys = await db.query(`select title, normalized_title from job_listings order by id`);
  assert.equal(keys.rows[0].normalized_title, "secretary");
  assert.equal(keys.rows[1].normalized_title, "accountant");
  await db.close();
});

test("every registered source has a working adapter", { skip }, async () => {
  const db = await freshDb();
  const { getAdapter } = await import("../../lib/jobs/sources/adapters.mjs");
  const rows = await db.query(`select slug, adapter_key, integration_status from job_sources order by slug`);
  const expectedAdapters = {
    geezjobs: "geezjobs",
    ngojobs: "ngojobs",
    srazone: "srazone",
    "ethiopianjobs-net": "ethiopianjobs-net",
    jobwebethiopia: "jobwebethiopia",
    dereja: "dereja",
    ethiojobs: "ethiojobs",
    workethiopia: "workethiopia",
    etcareers: "etcareers",
    alljobspo: "alljobspo",
    "ethiopian-reporter": "ethiopian-reporter",
    careersun: "careersun",
    "reliefweb-ethiopia": "reliefweb-ethiopia",
    "un-ethiopia": "un-ethiopia",
    "ethiojobs-net-et": "ethiojobs-net-et",
  };
  for (const [slug, adapterKey] of Object.entries(expectedAdapters)) {
    const row = rows.rows.find((r) => r.slug === slug);
    assert.ok(row, `expected source ${slug}`);
    assert.ok(getAdapter({ slug, adapter_key: row.adapter_key }), `expected an adapter for ${slug}`);
    assert.equal(row.adapter_key, adapterKey);
  }
  await db.close();
});

test("new sources are registered but disabled until reviewed", { skip }, async () => {
  const db = await freshDb();
  const rows = await db.query(
    `select slug, enabled from job_sources where slug in ('ngojobs','srazone','ethiopianjobs-net','jobwebethiopia','dereja')`
  );
  assert.equal(rows.rows.length, 5);
  for (const row of rows.rows) {
    assert.equal(row.enabled, false, `${row.slug} must stay disabled until an administrator reviews it`);
  }
  await db.close();
});

test("the discovery queue records a job URL only once per source", { skip }, async () => {
  const db = await freshDb();
  const source = await db.query(`select id from job_sources where slug = 'geezjobs'`);
  const sourceId = source.rows[0].id;
  await db.exec(`
    insert into job_discovery_queue (source_id, discovered_url) values (${sourceId}, 'https://geezjobs.com/job-detail/a');
  `);
  const dup = await db.query(
    `insert into job_discovery_queue (source_id, discovered_url) values ($1, 'https://geezjobs.com/job-detail/a')
     on conflict (source_id, discovered_url) do nothing returning id`,
    [sourceId]
  );
  assert.equal(dup.rows.length, 0, "a duplicate discovery URL must not be queued twice");
  await db.close();
});

test("sync locks are exclusive and expire", { skip }, async () => {
  const db = await freshDb();
  const first = await db.query(
    `insert into job_sync_locks (lock_key, owner, expires_at)
     values ('source:1','owner-a', now() + interval '5 minutes')
     on conflict (lock_key) do update set owner = excluded.owner
      where job_sync_locks.expires_at < now() or job_sync_locks.owner = excluded.owner
     returning lock_key`
  );
  assert.equal(first.rows.length, 1);
  const second = await db.query(
    `insert into job_sync_locks (lock_key, owner, expires_at)
     values ('source:1','owner-b', now() + interval '5 minutes')
     on conflict (lock_key) do update set owner = excluded.owner
      where job_sync_locks.expires_at < now() or job_sync_locks.owner = excluded.owner
     returning lock_key`
  );
  assert.equal(second.rows.length, 0, "a live lock must not be stolen by another owner");
  await db.close();
});

test("the demo seed is retired and never published", { skip }, async () => {
  const db = await freshDb();
  await db.exec(`
    insert into job_listings
      (title, company, logo, description, description_excerpt, application_instructions,
       status, job_status, origin, contact_email)
    values
      ('Senior Software Developer','Tech Solutions Ethiopia','images/companies/tech-solutions.png',
       'demo one','demo one','Apply by mail.','active','open','local','hr@techsolutions.et'),
      ('Financial Analyst','Commercial Bank of Ethiopia','images/companies/cbe.png',
       'demo two','demo two','Apply by mail.','active','open','demo',NULL),
      ('Real vacancy','Amhara Bank',NULL,'A real vacancy.','A real vacancy.','Apply by mail.',
       'active','open','aggregated',NULL);
  `);

  // Apply the demo retirement the way the migration does.
  const file = "017_scrub_source_attribution.sql";
  await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));

  const rows = await db.query("select id, title, origin from job_listings order by id");
  assert.equal(rows.rows.length, 1, "both demo rows are removed");
  assert.equal(rows.rows[0].title, "Real vacancy");

  const view = await db.query("select title from public_job_listings order by id");
  assert.deepEqual(view.rows.map((r) => r.title), ["Real vacancy"]);
  await db.close();
});

test("the public view never exposes a demo row", { skip }, async () => {
  const db = await freshDb();
  // A demo row that arrives after the cleanup must still be hidden.
  await db.exec(`
    insert into job_listings (title, company, status, job_status, origin)
    values ('Demo','Demo Org','active','open','demo');
  `);
  const view = await db.query("select title from public_job_listings");
  assert.equal(view.rows.length, 0, "a demo row is not published");
  await db.close();
});

test("source attribution is scrubbed from legacy vacancy text", { skip }, async () => {
  const db = await freshDb();
  await db.exec(`
    insert into job_listings
      (title, company, logo, description, description_excerpt, application_instructions,
       apply_url, apply_url_type, status, job_status)
    values
      ('UN intern','United Nations',
       'https://icons.duckduckgo.com/ip3/careers.un.org.ico',
       'This plain-English summary was prepared by workethiopia.net from the original advert.',
       'This plain-English summary was prepared by workethiopia.net from the original advert.',
       'Apply via the official UN Careers page: https://careers.un.org/jobSearchDescription/287744?language=en',
       'https://geezjobs.com/job-detail/x','external_application','active','open'),
      ('Real job','Amhara Bank',
       'https://www.google.com/s2/favicons?domain=amharabank.com.et&sz=128',
       'A genuine description with no source mention.',
       'A genuine description with no source mention.',
       'Send your CV to hr@amharabank.com.et',
       'https://amharabank.com.et/careers/apply','external_application','active','open');
  `);

  // Apply the attribution scrub on its own, the way the migration does.
  const file = "017_scrub_source_attribution.sql";
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  await db.exec(sql);

  const rows = await db.query("select title, logo, description, application_instructions, apply_url from job_listings order by id");
  const legacy = rows.rows.find((r) => r.title === "UN intern");
  const genuine = rows.rows.find((r) => r.title === "Real job");

  // No discovery source is named or linked in the public text.
  assert.equal(legacy.description.includes("workethiopia"), false);
  assert.equal(legacy.description.includes("careers.un.org"), false);
  assert.equal(legacy.application_instructions.includes("careers.un.org"), false);
  assert.equal(legacy.application_instructions.includes("UN Careers"), false);
  // The publisher's favicon is not kept as the organisation logo.
  assert.equal(legacy.logo, null);
  // An apply destination on a discovery source is dropped.
  assert.equal(legacy.apply_url, null);
  // The sentence is still readable.
  assert.ok(legacy.description.includes("from the original advert"));

  // A genuine employer logo and application link are untouched.
  assert.equal(genuine.logo, "https://www.google.com/s2/favicons?domain=amharabank.com.et&sz=128");
  assert.equal(genuine.apply_url, "https://amharabank.com.et/careers/apply");
  assert.ok(genuine.description.includes("no source mention"));
  await db.close();
});

test("every organisation gets its own website and logo", { skip }, async () => {
  const db = await freshDb();
  await db.exec(`
    insert into job_listings (title, company, status, job_status)
    values ('Officer','Awash Insurance Company','active','open'),
           ('Advisor','World Vision Ethiopia','active','open'),
           ('Nurse','UNICEF Ethiopia','active','open'),
           ('Engineer','Kalkidan Trading PLC','active','open');
    -- Run the directory backfill the way migration 015 does.
    insert into employer_directory (name, name_key, aliases)
    select company, lower(regexp_replace(trim(company), '\\s+', ' ', 'g')), '{}'::text[]
      from job_listings
     where company is not null and btrim(company) <> ''
     group by company
    on conflict (name_key) do nothing;
    update job_listings l set employer_id = e.id from employer_directory e
     where l.employer_id is null
       and lower(regexp_replace(trim(l.company), '\\s+', ' ', 'g')) = e.name_key;
  `);

  // The identity seeding runs the way the migration does.
  const file = "021_fix_seeded_employer_identities.sql";
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  await db.exec(sql);

  const rows = await db.query(
    `select name, website_domain, website_url, logo_public_url, logo_verified
       from employer_directory order by name`
  );
  const byName = Object.fromEntries(rows.rows.map((r) => [r.name, r]));

  // Each organisation keeps its OWN website, never another organisation's.
  assert.equal(byName["Awash Insurance Company"].website_domain, "awashinsurance.com");
  assert.equal(byName["World Vision Ethiopia"].website_domain, "worldvision.org");
  assert.equal(byName["UNICEF Ethiopia"].website_domain, "unicef.org");
  // An organisation we do not know keeps no invented identity.
  assert.equal(byName["Kalkidan Trading PLC"].website_domain, null);

  // The website is a real address, not a bare domain.
  assert.equal(byName["Awash Insurance Company"].website_url, "https://awashinsurance.com");

  // The logo is the organisation's own mark, served from its own domain.
  const logo = byName["Awash Insurance Company"].logo_public_url;
  assert.ok(logo && logo.includes("awashinsurance.com"), `unexpected logo: ${logo}`);
  assert.equal(byName["Awash Insurance Company"].logo_verified, true);

  // Every vacancy of an organisation points at the same directory entry.
  const links = await db.query(
    `select l.company, e.website_domain
       from job_listings l join employer_directory e on e.id = l.employer_id
      order by l.company`
  );
  assert.equal(links.rows.length, 4);
  for (const row of links.rows) {
    if (row.company === "World Vision Ethiopia") {
      assert.equal(row.website_domain, "worldvision.org");
    }
  }
  await db.close();
});

test("a logo taken from another organisation's domain is replaced", { skip }, async () => {
  const db = await freshDb();
  await db.exec(`
    insert into employer_directory
      (name, name_key, website_url, website_domain, logo_url, logo_public_url,
       logo_host_kind, logo_source, logo_confidence, logo_verified)
    values ('Awash Insurance Company','awash insurance company',
            'https://awashinsurance.com','awashinsurance.com',
            'https://www.google.com/s2/favicons?domain=unicef.org&sz=128',
            'https://www.google.com/s2/favicons?domain=unicef.org&sz=128',
            'employer','seeded',55,true);
  `);

  const file = "022_fix_stale_employer_logos.sql";
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  await db.exec(sql);

  const row = await db.query(
    `select logo_public_url, logo_source, logo_verified from employer_directory`
  );
  const logo = row.rows[0].logo_public_url;
  // The logo names the organisation's OWN domain, never another one's.
  assert.ok(logo && logo.includes("awashinsurance.com"), `unexpected logo: ${logo}`);
  assert.equal(logo.includes("unicef.org"), false);
  assert.equal(row.rows[0].logo_source, "favicon_service");
  assert.equal(row.rows[0].logo_verified, true);
  await db.close();
});
