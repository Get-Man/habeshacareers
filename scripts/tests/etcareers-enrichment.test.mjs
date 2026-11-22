// Deploy-time ETcareers enrichment tests — offline and fail-safe.
// These pin the title matching, stub detection, plain-text conversion and the
// injectable logo resolver used to reuse verified employer-directory logos.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import {
  ensureEmployer,
  feedJobTitle,
  findFeedItemForRow,
  htmlToText,
  isStubDescription,
  needsEnrichment,
  normaliseTitleKey,
  updateListing,
} from "../enrich-etcareers.mjs";
import { extractHeadlessJob, isForbiddenEtcareersUrl } from "../headless-job-fetch.mjs";

test("matches feed titles independent of punctuation and board suffix", () => {
  const feed =
    "ZamZam Bank S.C Job Vacancy 2026 – 3 Positions in Ethiopia  - ZamZam Bank S.C - Addis Ababa, Ethiopia";
  const publicTitle = "ZamZam Bank S.C Job Vacancy 2026 – 3 Positions in Ethiopia";
  assert.equal(feedJobTitle(feed), publicTitle);
  assert.equal(normaliseTitleKey(feedJobTitle(feed)), normaliseTitleKey(publicTitle));
});

test("matches a feed title with a dangling separator and no location", () => {
  const feed = "Social Worker Job for Fresh Graduates - Let Me Be A Child e.V. -";
  const publicTitle = "Social Worker Job for Fresh Graduates";
  assert.equal(feedJobTitle(feed), publicTitle);
  assert.equal(normaliseTitleKey(feedJobTitle(feed)), normaliseTitleKey(publicTitle));
});

test("a distinctive truncated title matches only its unique feed item", () => {
  const feed = "Siinqee Bank S.C. Job Vacancy 2026: Apply for 55 Jobs in Ethiopia - Siinqee Bank S.C - Addis Ababa, Ethiopia";
  const items = [{ title: feed, link: "https://etcareers.com/jobs/siinqee-55" }];
  const byTitle = new Map([[normaliseTitleKey(feedJobTitle(feed)), items[0]]]);
  const row = { title: "Siinqee Bank S.C. Job Vacancy 2026: Apply for 55" };
  assert.equal(findFeedItemForRow(row, byTitle, items), items[0]);
});

test("a short or ambiguous truncated title is never attached to a vacancy", () => {
  const items = [
    { title: "Social Worker - World Vision Ethiopia - Afar, Ethiopia", link: "a" },
    { title: "Social Worker Job for Fresh Graduates - Let Me Be A Child e.V. -", link: "b" },
  ];
  const byTitle = new Map();
  // Too short to be distinctive.
  assert.equal(findFeedItemForRow({ title: "Social Worker" }, byTitle, items), null);
  // Two possible extensions: ambiguous, so no match.
  const ambiguous = [
    { title: "Long Employer Vacancy 2026 Addis Ababa Ethiopia One", link: "a" },
    { title: "Long Employer Vacancy 2026 Addis Ababa Ethiopia Two", link: "b" },
  ];
  assert.equal(
    findFeedItemForRow({ title: "Long Employer Vacancy 2026 Addis Ababa" }, new Map(), ambiguous),
    null
  );
});

test("recognises only the real stub description", () => {
  assert.equal(isStubDescription("Open the official/original vacancy page for full details."), true);
  assert.equal(isStubDescription("  Open the official/original vacancy page for full details."), true);
  assert.equal(isStubDescription("SNV invites qualified applicants to apply."), false);
});

test("converts employer HTML to readable plain text without inventing content", () => {
  const html =
    "<p><strong>Employer:</strong> SNV Ethiopia</p><ul><li>Grade 12 completion</li><li>Valid licence</li></ul>";
  const text = htmlToText(html);
  assert.match(text, /Employer: SNV Ethiopia/);
  assert.match(text, /- Grade 12 completion/);
  assert.match(text, /- Valid licence/);
  assert.doesNotMatch(text, /<strong>|<li>/);
});

test("uses an injected logo resolver without any image search", async () => {
  const link = "https://etcareers.com/jobs/test-org-job-vacancy-f7206e1b";
  const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
    <item>
      <title>Test Role - Test Org - Addis Ababa, Ethiopia</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <description><![CDATA[<p><strong>Hiring Organization:</strong> Test Org</p>
      <p><strong>Application Link:</strong> <a href="https://forms.gle/test">https://forms.gle/test</a></p>]]></description>
    </item>
  </channel></rss>`;
  let resolvedFor = null;
  const record = await extractHeadlessJob(link, {
    rssXml: rss,
    quiet: true,
    noCrossReference: true,
    networkLog: [],
    resolveOrgLogo: async (orgName) => {
      resolvedFor = orgName;
      return { logo_url: "https://cdn.example.com/cached-logo.png", logo_local_path: null };
    },
  });

  assert.equal(resolvedFor, "Test Org");
  assert.equal(record.logo_url, "https://cdn.example.com/cached-logo.png");
  assert.equal(record.direct_apply_url, "https://forms.gle/test");
  assert.equal(isForbiddenEtcareersUrl(link), true);
});

test("a rejected legacy logo still needs logo enrichment", () => {
  const complete = {
    company: "Test Organization",
    description: "Real employer description.",
    apply_url: "https://example.org/apply",
    employer_logo_public_url: null,
    organization_logo_url: null,
    logo: null,
  };
  assert.equal(needsEnrichment(complete).logo, true);
  assert.equal(
    needsEnrichment({
      ...complete,
      logo: "https://www.google.com/s2/favicons?domain=geezjobs.com&sz=128",
    }).logo,
    true
  );
  assert.equal(
    needsEnrichment({ ...complete, logo: "https://cdn.example.org/logo.png" }).logo,
    false
  );
});

test("writes identity, logo, description and apply link without SQL parameter type errors", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const migrationsDir = path.join(repoRoot, "migrations");
  const db = new PGlite();
  try {
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
    await db.query(`
      insert into job_listings
        (id, title, company, description, apply_url, primary_source_id, status, posted_date)
      values
        (9901, 'Test Bank Job Vacancy', 'Unknown organization',
         'Open the official/original vacancy page for full details.', null,
         (select id from job_sources where slug = 'etcareers'), 'active', current_date)
    `);

    await db.query(`
      insert into employer_directory
        (name, name_key, logo_url, logo_public_url, logo_source,
         logo_verified, logo_confidence, identity_source)
      values
        ('Test Bank S.C', 'test bank s c',
         'https://etcareers.com/legacy-logo.png', 'https://etcareers.com/legacy-logo.png',
         'global_search', true, 90, 'manual')
    `);

    const employerId = await ensureEmployer(db, "Test Bank S.C", {
      logo_url: "https://cdn.example.com/test-bank.png",
    });
    await updateListing(
      db,
      { id: 9901 },
      {
        orgName: "Test Bank S.C",
        logoUrl: "https://cdn.example.com/test-bank.png",
        descriptionHtml: "<p>Full employer text</p>",
        descriptionText: "Full employer text",
        applyUrl: "https://forms.gle/test",
        rssLink: "https://etcareers.com/jobs/test-bank-f7206e1b",
        needs: { identity: true, description: true, apply: true, logo: true },
      },
      employerId
    );

    const result = await db.query(`
      select l.company, l.description, l.apply_url, l.apply_url_type,
             l.organization_logo_source, ed.logo_url, ed.logo_public_url
        from job_listings l
        left join employer_directory ed on ed.id = l.employer_id
       where l.id = 9901
    `);
    const row = result.rows[0];
    assert.equal(row.company, "Test Bank S.C");
    assert.equal(row.description, "Full employer text");
    assert.equal(row.apply_url, "https://forms.gle/test");
    assert.equal(row.apply_url_type, "google_form");
    assert.equal(row.organization_logo_source, "global_search");
    assert.equal(row.logo_url, "https://cdn.example.com/test-bank.png");
    assert.equal(row.logo_public_url, `/api/employer-logo?id=${employerId}`);
  } finally {
    await db.close();
  }
});

test("a direct application email is stored so the employer domain can be resolved", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const db = new PGlite();
  try {
    for (const file of fs.readdirSync(path.join(repoRoot, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = fs
        .readFileSync(path.join(repoRoot, "migrations", file), "utf8")
        .replace(/create extension if not exists pgcrypto;?/gi, "");
      await db.exec(sql);
    }
    await db.query(`
      insert into job_listings (id, title, company, status, posted_date)
      values (9902, 'Email Apply Vacancy', 'Test Organization', 'active', current_date)
    `);
    await updateListing(
      db,
      { id: 9902 },
      {
        orgName: "Test Organization",
        logoUrl: null,
        descriptionHtml: "<p>Full employer text</p>",
        descriptionText: "Full employer text",
        applyUrl: "mailto:hr@example.org",
        rssLink: "https://etcareers.com/jobs/email-apply-f7206e1b",
        needs: { identity: true, description: true, apply: true, logo: false },
      },
      null
    );
    const result = await db.query(
      "select apply_url, application_email from job_listings where id = 9902"
    );
    assert.equal(result.rows[0].apply_url, "mailto:hr@example.org");
    assert.equal(result.rows[0].application_email, "hr@example.org");
  } finally {
    await db.close();
  }
});
