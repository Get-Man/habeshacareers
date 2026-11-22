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
  htmlToText,
  isStubDescription,
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
             l.organization_logo_source, ed.logo_public_url
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
    assert.equal(row.logo_public_url, `/api/employer-logo?id=${employerId}`);
  } finally {
    await db.close();
  }
});
