// Zero-visit job fetcher tests — fully offline, with injected search/logo stubs.
// These pin the exact seven-key output, the employer-only description, title
// lookup, and the guard that forbids ever requesting an ETcareers job page.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  extractHeadlessJob,
  guardedFetch,
  isForbiddenEtcareersUrl,
  parseRssItems,
  parseSlugSignals,
  cleanRssDescription,
} from "../headless-job-fetch.mjs";

const TARGET_URL =
  "https://etcareers.com/jobs/test-bank-s-c-job-vacancy-2026-3-positions-in-ethiopia-f7206e1b";
const LOGO_URL = "https://cdn.example.com/test-bank-logo.png";

// A realistic public feed: the target listing plus a low-overlap decoy, with
// employer content in CDATA and board noise that must never reach the card.
const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:job="https://www.jobboardly.com/rss">
<channel>
  <title>ETcareers Jobs</title>
  <link>https://etcareers.com</link>
  <description>Public job syndication feed</description>
  <item>
    <title>Test Bank S.C Job Vacancy 2026 - Test Bank S.C - Addis Ababa, Ethiopia</title>
    <link>${TARGET_URL}</link>
    <guid>${TARGET_URL}</guid>
    <category>Banking &amp; Finance Jobs in Ethiopia</category>
    <pubDate>Mon, 01 Jan 2026 00:00:00 +0000</pubDate>
    <description><![CDATA[
      <p>Test Bank S.C is inviting qualified applicants to apply for two banking vacancies in Ethiopia.</p>
      <br /><h2>Job Overview</h2>
      <ul>
      <li><strong>Hiring Organization:</strong> Test Bank S.C</li>
      <li><strong>Job Location:</strong> Addis Ababa, Ethiopia</li>
      <li><strong>Employment Type:</strong> Full-time</li>
      <li><strong>Application Deadline:</strong> Within 7 days from the announcement date</li>
      </ul>
      <br /><h2>Available Job Positions</h2>
      <h3>1. Banking Business Officer I</h3>
      <p><strong>Work Experience</strong></p>
      <ul><li>Minimum of 2 years of branch banking experience.</li></ul>
      <h3>2. Branch Manager I</h3>
      <ul><li>Minimum of 5 years of banking experience.</li></ul>
      <h2>How to Apply</h2>
      <p><strong>Online Application Link:</strong> <a href="https://forms.gle/test123">https://forms.gle/test123</a></p>
      <p><a href="/jobs/other-vacancy">Read more on the portal</a></p>
      <script>var TELEGRAM_URL = 'https://t.me/x';</script>
      <div>Join ETcareers on Telegram</div>
    ]]></description>
  </item>
  <item>
    <title>Other Corp Manager Vacancy 2026 - Other Corp - Addis Ababa</title>
    <link>https://etcareers.com/jobs/other-corp-manager-f0000000</link>
    <guid>https://etcareers.com/jobs/other-corp-manager-f0000000</guid>
    <description><![CDATA[<p>An unrelated listing.</p>]]></description>
  </item>
</channel>
</rss>`;

function pngLogo(width = 256, height = 256) {
  const bytes = Buffer.alloc(512);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return { ok: true, contentType: "image/png", bytes };
}

function offlineOptions(assetsDir, calls = {}) {
  return {
    rssXml: RSS_XML,
    quiet: true,
    noCrossReference: true,
    assetsDir,
    networkLog: calls.networkLog || [],
    searchImages: async (query) => {
      calls.imageQuery = query;
      return [{
        title: "Test Bank S.C official logo",
        imageUrl: LOGO_URL,
        pageUrl: "https://testbank.com/",
        width: 256,
        height: 256,
      }];
    },
    downloadImage: async () => {
      calls.downloads = (calls.downloads || 0) + 1;
      return pngLogo();
    },
  };
}

test("extracts exactly the seven embed keys from offline RSS with zero network requests", async () => {
  const assetsDir = mkdtempSync(path.join(tmpdir(), "headless-job-fetch-"));
  const calls = { networkLog: [] };
  try {
    const record = await extractHeadlessJob(TARGET_URL, offlineOptions(assetsDir, calls));

    assert.deepEqual(Object.keys(record), [
      "title",
      "org_name",
      "logo_local_path",
      "logo_url",
      "description_html",
      "direct_apply_url",
      "apply_button_html",
    ]);

    assert.equal(record.title, "Test Bank S.C Job Vacancy 2026");
    assert.equal(record.org_name, "Test Bank S.C");
    assert.equal(record.direct_apply_url, "https://forms.gle/test123");
    assert.equal(
      record.apply_button_html,
      '<a href="https://forms.gle/test123" target="_blank" rel="noopener noreferrer" class="apply-now-btn">Apply Now</a>'
    );
    assert.equal(record.logo_url, LOGO_URL);
    assert.equal(calls.imageQuery, "Test Bank S.C Ethiopia official logo png");
    assert.ok(record.logo_local_path.replace(/\\/g, "/").endsWith("/test-bank-s-c.png"));
    assert.ok(readFileSync(path.join(assetsDir, "test-bank-s-c.png")).length > 0);

    // Employer content only: headings, bold labels and bullet lists survive.
    assert.match(record.description_html, /<h2>Job Overview<\/h2>/);
    assert.match(record.description_html, /<strong>Hiring Organization:<\/strong> Test Bank S.C/);
    assert.match(record.description_html, /<li>Minimum of 2 years of branch banking experience\.<\/li>/);
    assert.match(record.description_html, /<h3>2\. Branch Manager I<\/h3>/);
    assert.match(record.description_html, /<a href="https:\/\/forms\.gle\/test123">/);

    // No board chrome, ads, tracking, social promo or internal portal links.
    assert.doesNotMatch(record.description_html, /href="(?:\/jobs|https:\/\/etcareers\.com)/i);
    assert.doesNotMatch(
      record.description_html,
      /TELEGRAM_URL|t\.me\/|telegram|ETcareers|advertis|sponsored|more jobs/i
    );

    // No feed, search, image or redirect request was made at all.
    assert.deepEqual(calls.networkLog, []);
    assert.equal(calls.downloads, 1);
  } finally {
    rmSync(assetsDir, { recursive: true, force: true });
  }
});

test("resolves the same vacancy from a job title instead of a URL slug", async () => {
  const assetsDir = mkdtempSync(path.join(tmpdir(), "headless-job-title-"));
  try {
    const record = await extractHeadlessJob(
      "Test Bank S.C Job Vacancy 2026 – 2 Positions in Ethiopia",
      offlineOptions(assetsDir)
    );
    assert.equal(record.title, "Test Bank S.C Job Vacancy 2026");
    assert.equal(record.org_name, "Test Bank S.C");
    assert.equal(record.direct_apply_url, "https://forms.gle/test123");
  } finally {
    rmSync(assetsDir, { recursive: true, force: true });
  }
});

const AMBIGUOUS_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>ZamZam Bank S.C Job Vacancy 2026 - ZamZam Bank S.C - Addis Ababa, Ethiopia</title>
    <link>https://etcareers.com/jobs/zamzam-bank-s-c-job-vacancy-2026-it-f0000001</link>
    <guid>https://etcareers.com/jobs/zamzam-bank-s-c-job-vacancy-2026-it-f0000001</guid>
    <description><![CDATA[<h2>Job Overview</h2><ul><li><strong>Hiring Organization:</strong> ZamZam Bank S.C</li></ul>]]></description>
  </item>
  <item>
    <title>ZamZam Bank S.C Job Vacancy 2026 - 3 Positions in Ethiopia - ZamZam Bank S.C - Ginir, Ethiopia</title>
    <link>https://etcareers.com/jobs/zamzam-bank-s-c-job-vacancy-2026-3-positions-in-ethiopia-f7206e1b</link>
    <guid>https://etcareers.com/jobs/zamzam-bank-s-c-job-vacancy-2026-3-positions-in-ethiopia-f7206e1b</guid>
    <description><![CDATA[
      <h2>Job Overview</h2>
      <ul><li><strong>Hiring Organization:</strong> ZamZam Bank S.C</li></ul>
      <h2>How to Apply</h2>
      <p><strong>Application Link:</strong> <a href="https://rb.gy/abc123">https://rb.gy/abc123</a></p>
    ]]></description>
  </item>
</channel></rss>`;

test("a full title phrase picks the right listing and a bare application URL is detected", async () => {
  const assetsDir = mkdtempSync(path.join(tmpdir(), "headless-job-ambiguous-"));
  try {
    const record = await extractHeadlessJob(
      "ZamZam Bank S.C Job Vacancy 2026 – 3 Positions in Ethiopia",
      { ...offlineOptions(assetsDir), rssXml: AMBIGUOUS_RSS }
    );
    assert.equal(record.title, "ZamZam Bank S.C Job Vacancy 2026 - 3 Positions in Ethiopia");
    assert.equal(record.direct_apply_url, "https://rb.gy/abc123");
    assert.equal(
      record.apply_button_html,
      '<a href="https://rb.gy/abc123" target="_blank" rel="noopener noreferrer" class="apply-now-btn">Apply Now</a>'
    );
  } finally {
    rmSync(assetsDir, { recursive: true, force: true });
  }
});

test("parses slug signals into clean search terms and an organisation name", () => {
  const signals = parseSlugSignals(TARGET_URL);
  assert.equal(signals.kind, "url");
  assert.equal(
    signals.slug,
    "test-bank-s-c-job-vacancy-2026-3-positions-in-ethiopia"
  );
  assert.ok(signals.tokens.includes("test"));
  assert.ok(signals.tokens.includes("bank"));
  assert.ok(!signals.tokens.includes("vacancy"));
  assert.ok(!signals.tokens.includes("ethiopia"));
  assert.match(signals.orgFromSlug, /Bank S\.C/);
});

test("parseRssItems and cleanRssDescription read CDATA and strip board artefacts", () => {
  const items = parseRssItems(RSS_XML);
  assert.equal(items.length, 2);
  assert.equal(items[0].link, TARGET_URL);
  assert.deepEqual(items[0].categories, ["Banking & Finance Jobs in Ethiopia"]);
  assert.match(items[0].description, /<h2>Job Overview<\/h2>/);

  const cleaned = cleanRssDescription(items[0].description);
  assert.match(cleaned, /<ul>/);
  assert.doesNotMatch(cleaned, /<script|TELEGRAM_URL|telegram|Join ETcareers/i);
  assert.doesNotMatch(cleaned, /href="\/jobs\/other-vacancy"/);
  assert.match(cleaned, /Read more on the portal/); // employer words preserved, link detached
});

test("the zero-visit guard blocks ETcareers job pages but allows public feeds", async () => {
  assert.equal(isForbiddenEtcareersUrl(TARGET_URL), true);
  assert.equal(isForbiddenEtcareersUrl("https://etcareers.com/jobs.rss"), false);
  assert.equal(isForbiddenEtcareersUrl("https://etcareers.com/sitemap.xml"), false);
  assert.equal(isForbiddenEtcareersUrl("https://etcareers.com/robots.txt"), false);
  assert.equal(isForbiddenEtcareersUrl("https://example.com/jobs/anything"), false);

  let called = false;
  await assert.rejects(
    guardedFetch(TARGET_URL, {}, {
      fetchImpl: async () => { called = true; return { ok: true }; },
    }),
    /zero-visit guard blocked a direct ETcareers page request/
  );
  assert.equal(called, false, "guard must reject before any fetch is attempted");

  const networkLog = [];
  const ok = await guardedFetch("https://etcareers.com/jobs.rss", {}, {
    fetchImpl: async () => ({ ok: true, status: 200 }),
    networkLog,
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(networkLog, ["https://etcareers.com/jobs.rss"]);
});
