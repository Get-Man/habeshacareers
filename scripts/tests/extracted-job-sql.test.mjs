// Regression coverage for Stage B persistence with NULL provenance fields.
//
// The RSS backfill leaves every `original_source_*` field NULL. Those params
// are reused in `case when $N is not null then now() else ... end` to stamp
// `original_source_checked_at`, and an untyped NULL parameter previously made
// the whole INSERT/UPDATE fail with "could not determine data type of
// parameter $56" in production. These tests run the REAL `upsertExtractedJob`
// against an in-memory Postgres so a removed cast fails the build offline.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import {
  INSERT_EXTRACTED_JOB_SQL,
  UPDATE_EXTRACTED_JOB_SQL,
  upsertExtractedJob,
} from "../../lib/jobs/repository.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function freshDb() {
  const db = new PGlite();
  const migrationsDir = path.join(REPO_ROOT, "migrations");
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs
      .readFileSync(path.join(migrationsDir, file), "utf8")
      .replace(/create extension if not exists pgcrypto;?/gi, "");
    await db.exec(sql);
  }
  await db.query(`
    insert into job_sources (slug, name, enabled)
    values ('etcareers', 'ET Careers', true)
    on conflict (slug) do nothing
  `);
  const rows = await db.query("select * from job_sources where slug = 'etcareers'");
  return { db, source: rows.rows[0] };
}

const LINK = "https://etcareers.com/jobs/zamzam-3-positions-f7206e1b";

function backfillJob(overrides = {}) {
  return {
    title: "ZamZam Bank S.C Job Vacancy 2026 - 3 Positions in Ethiopia",
    company: "ZamZam Bank S.C",
    canonicalJobUrl: LINK,
    originalJobUrl: LINK,
    location: "Addis Ababa, Ethiopia",
    postedDate: "2026-11-09",
    description: "ZamZam Bank S.C invites qualified applicants to apply.",
    descriptionHtml: "<p>ZamZam Bank S.C invites qualified applicants to apply.</p>",
    applyUrl: "https://forms.gle/Muqmf2ZrZCqzGuw58",
    applyUrlType: "google_form",
    applyUrlVerified: true,
    applyCandidates: [],
    applyConfidence: 90,
    organizationVerified: true,
    extractionMethod: "public_rss_feed",
    extractionStatus: "verified",
    // No originalSourceUrl / originalSourceKind / originalSourceConfidence /
    // isRepostedAnnouncement — exactly the shape produced by the RSS backfill.
    ...overrides,
  };
}

test("the persistence SQL explicitly casts the provenance params it reuses in IS NOT NULL", () => {
  // Guards against someone dropping a cast while editing these large statements.
  for (const [name, sql] of [
    ["update", UPDATE_EXTRACTED_JOB_SQL],
    ["insert", INSERT_EXTRACTED_JOB_SQL],
  ]) {
    assert.match(sql, /case when \$\d+::text is not null then now\(\)/, `${name} checked_at cast`);
    assert.match(sql, /::integer/, `${name} integer cast`);
    assert.match(sql, /::boolean/, `${name} boolean cast`);
  }
});

test("upsertExtractedJob INSERTs a backfill job with all provenance fields null", async () => {
  const { db, source } = await freshDb();
  try {
    const result = await upsertExtractedJob(source, backfillJob(), { client: db });
    assert.equal(result.action, "new");

    const row = (
      await db.query(
        `select title, description, apply_url, extraction_status,
                original_source_url, original_source_kind, original_source_confidence,
                is_reposted_announcement, original_source_checked_at
           from job_listings where canonical_job_url = $1`,
        [LINK]
      )
    ).rows[0];

    assert.equal(row.title, "ZamZam Bank S.C Job Vacancy 2026 - 3 Positions in Ethiopia");
    assert.match(row.description, /ZamZam Bank S.C invites qualified applicants/);
    assert.equal(row.apply_url, "https://forms.gle/Muqmf2ZrZCqzGuw58");
    assert.equal(row.extraction_status, "verified");
    assert.equal(row.original_source_url, null);
    assert.equal(row.original_source_kind, null);
    assert.equal(row.original_source_confidence, null);
    assert.equal(row.is_reposted_announcement, false);
    assert.equal(row.original_source_checked_at, null);
  } finally {
    await db.close();
  }
});

test("upsertExtractedJob UPDATEs the same job with null provenance fields without a type error", async () => {
  const { db, source } = await freshDb();
  try {
    const first = await upsertExtractedJob(source, backfillJob(), { client: db });
    assert.equal(first.action, "new");
    const second = await upsertExtractedJob(
      source,
      backfillJob({ description: "ZamZam Bank S.C announces an updated, complete vacancy announcement." }),
      { client: db }
    );
    assert.equal(second.action, "updated");

    const row = (
      await db.query(
        `select original_source_url, original_source_confidence, original_source_checked_at
           from job_listings where canonical_job_url = $1`,
        [LINK]
      )
    ).rows[0];
    assert.equal(row.original_source_url, null);
    assert.equal(row.original_source_confidence, null);
    assert.equal(row.original_source_checked_at, null);
  } finally {
    await db.close();
  }
});

test("a real original source URL still stamps original_source_checked_at", async () => {
  const { db, source } = await freshDb();
  try {
    const result = await upsertExtractedJob(
      source,
      backfillJob({
        originalSourceUrl: "https://employer.example.org/careers/123",
        originalSourceKind: "employer_website",
        originalSourceConfidence: 95,
        isRepostedAnnouncement: true,
      }),
      { client: db }
    );
    assert.equal(result.action, "new");

    const row = (
      await db.query(
        `select original_source_url, original_source_kind, original_source_confidence,
                is_reposted_announcement, original_source_checked_at
           from job_listings where canonical_job_url = $1`,
        [LINK]
      )
    ).rows[0];
    assert.equal(row.original_source_url, "https://employer.example.org/careers/123");
    assert.equal(row.original_source_kind, "employer_website");
    assert.equal(row.original_source_confidence, 95);
    assert.equal(row.is_reposted_announcement, true);
    assert.ok(row.original_source_checked_at, "checked_at is stamped when a source URL is present");
  } finally {
    await db.close();
  }
});
