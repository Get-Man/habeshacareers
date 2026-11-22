// Deploy-time ETcareers enrichment tests — offline and fail-safe.
// These pin the title matching, stub detection, plain-text conversion and the
// injectable logo resolver used to reuse verified employer-directory logos.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  feedJobTitle,
  htmlToText,
  isStubDescription,
  normaliseTitleKey,
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
