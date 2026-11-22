// Deploy-time ETcareers feed backfill tests — offline, injectable and fail-soft.
// These pin the repository payload shape, the honest verification levels, the
// absence of source identity in job-facing fields, and the zero-page-visit
// guarantee for every item in the public feed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { APPLY_URL_TYPES } from "../../lib/jobs/extract/apply-link.mjs";
import { EXTRACTION_STATUS } from "../../lib/jobs/extract/validate.mjs";
import {
  buildBackfillJob,
  collectBackfillJobs,
  feedDate,
  runBackfill,
} from "../backfill-etcareers-feed.mjs";
import {
  extractFeedItemRecord,
  isForbiddenEtcareersUrl,
  parseRssItems,
} from "../headless-job-fetch.mjs";

const SOURCE = {
  id: 7,
  slug: "etcareers",
  name: "ET Careers",
  base_url: "https://etcareers.com",
};

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>ETcareers.com RSS Feed</title>
  <item>
    <title>ZamZam Bank S.C Job Vacancy 2026 - 3 Positions in Ethiopia - ZamZam Bank S.C - Addis Ababa, Ethiopia</title>
    <link>https://etcareers.com/jobs/zamzam-3-positions-f7206e1b</link>
    <guid>https://etcareers.com/jobs/zamzam-3-positions-f7206e1b</guid>
    <category>Banking Jobs in Ethiopia</category>
    <pubDate>Mon, 09 Nov 2026 00:00:00 +0000</pubDate>
    <description><![CDATA[
      <p>ZamZam Bank S.C invites qualified applicants to apply.</p>
      <h2>Job Overview</h2>
      <ul>
        <li><strong>Hiring Organization:</strong> ZamZam Bank S.C</li>
        <li><strong>Job Location:</strong> Addis Ababa, Ethiopia</li>
        <li><strong>Employment Type:</strong> Full-time</li>
        <li><strong>Application Deadline:</strong> November 30, 2026</li>
      </ul>
      <h2>How to Apply</h2>
      <p><strong>Apply Here:</strong> <a href="https://forms.gle/Muqmf2ZrZCqzGuw58">apply now</a></p>
      <div>Join ETcareers on Telegram</div>
    ]]></description>
  </item>
  <item>
    <title>Driver - 2 Positions - SNV Ethiopia - Addis Ababa, Ethiopia</title>
    <link>https://etcareers.com/jobs/driver-2-positions-80a6abdf</link>
    <guid>https://etcareers.com/jobs/driver-2-positions-80a6abdf</guid>
    <description><![CDATA[
      <p>SNV invites drivers to apply.</p>
      <ul><li><strong>Hiring Organization:</strong> SNV Ethiopia</li></ul>
      <p>Please send your CV to hr@example.org.</p>
    ]]></description>
  </item>
</channel></rss>`;

function payloadFor(xml = FEED_XML, index = 0) {
  const item = parseRssItems(xml)[index];
  const record = extractFeedItemRecord(item);
  return { item, record, job: buildBackfillJob(item, record, { source: SOURCE }) };
}

test("feed deadlines are calendar dates, never shifted by a server timezone", () => {
  assert.equal(feedDate("November 30, 2026"), "2026-11-30");
  assert.equal(feedDate("30 November 2026."), "2026-11-30");
  assert.equal(feedDate("2026-11-30"), "2026-11-30");
  assert.equal(feedDate("Within 7 days from the announcement date"), null);
});

test("buildBackfillJob writes a complete, source-free repository payload", () => {
  const { job } = payloadFor();

  assert.equal(job.title, "ZamZam Bank S.C Job Vacancy 2026 - 3 Positions in Ethiopia");
  assert.equal(job.company, "ZamZam Bank S.C");
  assert.equal(job.organizationVerified, true);
  assert.equal(job.canonicalJobUrl, "https://etcareers.com/jobs/zamzam-3-positions-f7206e1b");
  assert.equal(job.originalJobUrl, job.canonicalJobUrl);
  assert.equal(job.location, "Addis Ababa, Ethiopia");
  assert.equal(job.jobType, "Full-time");
  assert.equal(job.deadline, "2026-11-30");
  assert.equal(job.postedDate, "2026-11-09");

  assert.equal(job.applyUrl, "https://forms.gle/Muqmf2ZrZCqzGuw58");
  assert.equal(job.applyUrlType, APPLY_URL_TYPES.GOOGLE_FORM);
  assert.equal(job.applyUrlSource, "rss_feed");
  assert.equal(job.applyUrlVerified, true);
  assert.equal(job.extractionStatus, EXTRACTION_STATUS.VERIFIED);

  // Full employer-written content, not a stub, and no board chrome.
  assert.match(job.description, /ZamZam Bank S.C invites qualified applicants/);
  assert.match(job.descriptionHtml, /<strong>Hiring Organization:<\/strong> ZamZam Bank S.C/);
  assert.doesNotMatch(job.description, /ETcareers|telegram|t\.me/i);
  assert.doesNotMatch(job.descriptionHtml, /ETcareers|telegram|t\.me/i);

  // Discovery-source identity never enters a job-facing field.
  assert.equal(job.sourceDomain, null);
  assert.equal(job.sourceWebsiteName, null);
  const jobFacing = JSON.stringify({
    title: job.title,
    description: job.description,
    descriptionHtml: job.descriptionHtml,
    applicationInstructions: job.applicationInstructions,
  });
  assert.doesNotMatch(jobFacing, /etcareers/i);
});

test("plain-text application emails become a verified email application", () => {
  const { job } = payloadFor(FEED_XML, 1);
  assert.equal(job.applyUrl, "mailto:hr@example.org");
  assert.equal(job.applyUrlType, APPLY_URL_TYPES.EMAIL);
  assert.equal(job.applicationEmail, "hr@example.org");
  assert.equal(job.extractionStatus, EXTRACTION_STATUS.VERIFIED);
});

test("a posting without an employer is held for review, never invented", () => {
  const xml = FEED_XML.replace(
    "<li><strong>Hiring Organization:</strong> SNV Ethiopia</li>",
    ""
  ).replace("Driver - 2 Positions - SNV Ethiopia - Addis Ababa, Ethiopia", "Driver - Addis Ababa, Ethiopia");
  const { job } = payloadFor(xml, 1);
  assert.equal(job.company, "Organization not verified");
  assert.equal(job.extractionStatus, EXTRACTION_STATUS.NEEDS_REVIEW);
  assert.equal(job.needsReview, true);
  assert.equal(job.organizationVerified, false);
});

test("a posting without a usable application link is only partial", () => {
  const xml = FEED_XML.replace(
    '<a href="https://forms.gle/Muqmf2ZrZCqzGuw58">apply now</a>',
    '<a href="/jobs/other-vacancy">read more on the portal</a>'
  );
  const { job } = payloadFor(xml);
  assert.equal(job.applyUrl, null);
  assert.equal(job.applyUrlType, null);
  assert.equal(job.extractionStatus, EXTRACTION_STATUS.PARTIAL);
  assert.ok(job.description, "the employer description is still kept");
});

test("collectBackfillJobs handles every feed item and records incomplete ones", () => {
  const { items, jobs, samples } = collectBackfillJobs(FEED_XML, { source: SOURCE });
  assert.equal(items.length, 2);
  assert.equal(jobs.length, 2);
  assert.deepEqual(samples, []);
});

test("runBackfill processes the whole feed offline and counts upsert results", async () => {
  const networkLog = [];
  let seen = 0;
  const result = await runBackfill({
    networkLog,
    fetchXml: async () => FEED_XML,
    loadSource: async () => SOURCE,
    upsert: async (source, job) => {
      seen += 1;
      assert.equal(source.id, SOURCE.id);
      assert.ok(job.canonicalJobUrl.startsWith("https://etcareers.com/jobs/"));
      return { action: seen === 1 ? "new" : "updated", id: 100 + seen };
    },
  });

  assert.equal(seen, 2);
  assert.equal(result.feedItems, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.new, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.withDescription, 2);
  assert.equal(result.withApply, 2);
  assert.equal(result.jobPageRequests, 0);
  assert.deepEqual(networkLog, []);
});

test("runBackfill fails closed if any ETcareers page request is logged", async () => {
  const networkLog = [];
  await assert.rejects(
    runBackfill({
      networkLog,
      fetchXml: async () => {
        networkLog.push("https://etcareers.com/jobs/zamzam-3-positions-f7206e1b");
        return FEED_XML;
      },
      loadSource: async () => SOURCE,
      upsert: async () => ({ action: "new", id: 1 }),
    }),
    /zero-visit guard blocked 1 ETcareers page request/
  );
  assert.equal(isForbiddenEtcareersUrl(networkLog[0]), true);
});

test("runBackfill is safe to repeat: the same feed deduplicates on rerun", async () => {
  const seen = new Map();
  const upsert = async (_source, job) => {
    if (seen.has(job.canonicalJobUrl)) return { action: "duplicate" };
    seen.set(job.canonicalJobUrl, true);
    return { action: "new", id: seen.size };
  };
  const options = {
    fetchXml: async () => FEED_XML,
    loadSource: async () => SOURCE,
    upsert,
  };
  const first = await runBackfill(options);
  const second = await runBackfill(options);
  assert.equal(first.new, 2);
  assert.equal(second.duplicate, 2);
  assert.equal(second.new, 0);
  assert.equal(second.failed, 0);
});
