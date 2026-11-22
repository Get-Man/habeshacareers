// Tests for the additional, compliance-reviewed vacancy sources.
//
// These are pure unit tests: no network and no database. They pin the adapter
// registry, the Ethiopia filter for the global UN feed, the public verification
// label, and the admin monitoring column mapping.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRssKeywordMatcher,
  discoverSource,
  getAdapter,
  JOB_DETAIL_PATTERNS,
  listAdapterKeys,
  parseRssItems,
} from "../../lib/jobs/sources/adapters.mjs";
import { isKnownSourceDomain } from "../../lib/jobs/extract/hosts.mjs";
import {
  EXTRACTION_STATUS,
  JOB_STATUS,
  toVerificationStatus,
  VERIFICATION_STATUS,
} from "../../lib/jobs/extract/validate.mjs";
import { toFrontendJob, toMonitoringRow } from "../../lib/jobs/repository.mjs";

test("new discovery adapters resolve by slug and adapter_key", () => {
  for (const slug of ["srafelagi", "aradajobs", "un-careers-ethiopia", "unjobnet"]) {
    const adapter = getAdapter({ slug });
    assert.ok(adapter, `expected adapter for ${slug}`);
    assert.equal(adapter.key, slug);
    assert.equal(typeof adapter.discover, "function");
    assert.ok(listAdapterKeys().includes(slug));
  }
  assert.ok(getAdapter({ adapter_key: "un-careers-ethiopia" }));
});

test("job detail patterns match vacancies but skip archive/listing pages", () => {
  assert.ok(JOB_DETAIL_PATTERNS.srafelagi.test("https://www.srafelagi.com/job/14036"));
  assert.ok(!JOB_DETAIL_PATTERNS.srafelagi.test("https://www.srafelagi.com/post-job"));
  assert.ok(JOB_DETAIL_PATTERNS.aradajobs.test("https://www.aradajobs.com/jobs/efsTzEUajm-hr-officer"));
  assert.ok(!JOB_DETAIL_PATTERNS.aradajobs.test("https://www.aradajobs.com/jobs/category/accounting-and-finance"));
  assert.ok(!JOB_DETAIL_PATTERNS.aradajobs.test("https://www.aradajobs.com/jobs/location/addis-ababa"));
  assert.ok(JOB_DETAIL_PATTERNS.unCareers.test("https://careers.un.org/jobSearchDescription/287216?language=en"));
  assert.ok(!JOB_DETAIL_PATTERNS.unCareers.test("https://careers.un.org/jobfeed"));
  assert.ok(JOB_DETAIL_PATTERNS.unjobnet.test("https://www.unjobnet.org/jobs/detail/undp-national-intern-regional-trade-associate-90794392"));
  assert.ok(!JOB_DETAIL_PATTERNS.unjobnet.test("https://www.unjobnet.org/jobs?locations%5B0%5D=Ethiopia"));
  assert.ok(!JOB_DETAIL_PATTERNS.unjobnet.test("https://www.unjobnet.org/organizations/UNDP"));
});

test("UN Jobnet listing fallback yields individual vacancy URLs", async () => {
  const listingUrl = "https://www.unjobnet.org/jobs?locations%5B0%5D=Ethiopia&orderby=recent";
  const html = `<div class="js-fallback">
    <a href="/organizations/UNECA">United Nations Economic Commission for Africa</a>
    <a href="/jobs/detail/uneca-cfnd-nelga-communication-specialist-90804680">CFND - NELGA Communication Specialist</a>
    <a href="/jobs/detail/undp-national-intern-regional-trade-associate-90794392">National Intern - Regional Trade Associate</a>
    <nav><a href="https://www.unjobnet.org/jobs?locations%5B0%5D=Ethiopia&amp;orderby=recent&amp;page=2">Next</a></nav>
  </div>`;
  const result = await discoverSource(
    {
      adapter_key: "unjobnet",
      fetch_config: { listingUrl, limit: 10, offset: 1 },
    },
    {
      limit: 10,
      offset: 1,
      fetchText: async () => ({ ok: true, status: 200, text: html, url: listingUrl }),
    }
  );
  assert.equal(result.adapter, "unjobnet");
  assert.equal(result.mode, "listing");
  assert.deepEqual(
    result.urls.map((u) => u.url),
    [
      "https://www.unjobnet.org/jobs/detail/uneca-cfnd-nelga-communication-specialist-90804680",
      "https://www.unjobnet.org/jobs/detail/undp-national-intern-regional-trade-associate-90794392",
    ]
  );
  assert.equal(result.nextOffset, 2);
  assert.equal(result.done, false);
});

test("UN Jobnet is classified as an internal discovery source", () => {
  assert.ok(isKnownSourceDomain("www.unjobnet.org"));
  assert.ok(isKnownSourceDomain("jobs.unjobnet.org"));
  assert.ok(!isKnownSourceDomain("example.org"));
});

test("RSS parser keeps item description text for keyword filtering", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Programme Officer]]></title>
      <link>https://careers.un.org/jobSearchDescription/287216?language=en</link>
      <guid>https://careers.un.org/jobSearchDescription/287216?language=en</guid>
      <description><![CDATA[Duty Station : <b>ADDIS ABABA</b>]]></description>
    </item></channel></rss>`;
  const [item] = parseRssItems(xml);
  assert.ok(item);
  assert.match(item.text, /ADDIS ABABA/);
  assert.equal(item.url, "https://careers.un.org/jobSearchDescription/287216?language=en");
});

test("RSS keyword matcher narrows the global UN feed to Ethiopia", () => {
  const config = {
    keywordPattern: "ethiopia|addis ababa|dire dawa|mekele|hawassa|bahir dar|adama|gondar|jigjiga",
  };
  const matches = buildRssKeywordMatcher(config);
  assert.ok(matches({ title: "Programme Officer", text: "Duty Station : ADDIS ABABA" }));
  assert.ok(matches({ title: "Ethiopia field officer", text: "" }));
  assert.equal(matches({ title: "Programme Officer", text: "Duty Station : NEW YORK" }), false);
  // An absent or invalid pattern must never drop every item.
  assert.ok(buildRssKeywordMatcher({})({ title: "Any", text: "" }));
  assert.ok(buildRssKeywordMatcher({ keywordPattern: "[" })({ title: "Any", text: "" }));
});

test("public verification labels derive from stored values without changing enums", () => {
  // Existing stored enums stay exactly as they were.
  assert.equal(EXTRACTION_STATUS.PARTIAL, "partial");
  assert.equal(EXTRACTION_STATUS.NEEDS_REVIEW, "needs_manual_review");
  assert.equal(JOB_STATUS.EXPIRED, "expired");

  assert.equal(toVerificationStatus({ extractionStatus: EXTRACTION_STATUS.VERIFIED }), VERIFICATION_STATUS.VERIFIED);
  assert.equal(toVerificationStatus({ extractionStatus: EXTRACTION_STATUS.PARTIAL }), VERIFICATION_STATUS.PARTIALLY_VERIFIED);
  assert.equal(toVerificationStatus({ extractionStatus: EXTRACTION_STATUS.NEEDS_REVIEW }), VERIFICATION_STATUS.NEEDS_REVIEW);
  assert.equal(toVerificationStatus({}), VERIFICATION_STATUS.NEEDS_REVIEW);
  assert.equal(toVerificationStatus({ status: "expired", extractionStatus: EXTRACTION_STATUS.VERIFIED }), VERIFICATION_STATUS.EXPIRED);
  assert.equal(toVerificationStatus({ jobStatus: JOB_STATUS.EXPIRED, extractionStatus: EXTRACTION_STATUS.VERIFIED }), VERIFICATION_STATUS.EXPIRED);
});

test("public job mapping exposes verificationStatus alongside status/jobStatus", () => {
  const job = toFrontendJob({
    id: 1,
    title: "Programme Officer",
    company: "United Nations",
    status: "active",
    job_status: null,
    extraction_status: EXTRACTION_STATUS.VERIFIED,
  });
  assert.equal(job.verificationStatus, "verified");
  assert.equal(job.status, "active");
});

test("UN Jobnet applications are proxied and source identity never reaches the public job", () => {
  const job = toFrontendJob({
    id: 42,
    title: "Country Consultant for Somalia",
    company: "United Nations Economic Commission for Africa",
    status: "active",
    apply_url: "https://www.unjobnet.org/apply/90804681",
    apply_url_type: "source_application",
    canonical_job_url: "https://www.unjobnet.org/jobs/detail/uneca-consultant-90804681",
    original_job_url: "https://www.unjobnet.org/jobs/detail/uneca-consultant-90804681",
    // Fields that exist on an internal row but must never reach the public API.
    source_name: "UN Jobnet (Ethiopia)",
    source_domain: "www.unjobnet.org",
    logo_url: "https://www.unjobnet.org/assets/images/logo/platform.png",
  });
  // The board-hosted application hop is served via our own redirect, so the
  // source domain is not exposed to the reader.
  assert.equal(job.applyUrl, "/api/apply?id=42");
  assert.equal(job.applyUrlType, "source_application");
  // No source name, domain, asset URL or detail URL may leak anywhere in the
  // public job payload (including structured-data and apply metadata).
  const payload = JSON.stringify(job);
  assert.ok(!/unjobnet/i.test(payload), payload);
  assert.ok(!/90804681/.test(payload), payload);
});

test("monitoring rows map to the required admin columns", () => {
  const row = toMonitoringRow({
    slug: "srafelagi",
    name: "Srafelagi",
    enabled: true,
    integration_status: "connected",
    last_sync_at: "2026-11-21T10:00:00.000Z",
    jobs_found: 8,
    new_jobs: 3,
    updated: 2,
    errors: 0,
  });
  assert.equal(row.status, "Active");
  assert.equal(row.last_fetch, "2026-11-21T10:00:00.000Z");
  assert.equal(row.jobs_found, 8);
  assert.equal(row.new_jobs, 3);
  assert.equal(row.updated, 2);
  assert.equal(row.errors, 0);

  // Before the first run, queued items surface as "found" and a stored error
  // counts as one; disabled/blocked sources keep a truthful status label.
  const pending = toMonitoringRow({
    enabled: true, integration_status: "pending", queue_total: 12, last_error: "timeout",
  });
  assert.equal(pending.status, "Pending");
  assert.equal(pending.jobs_found, 12);
  assert.equal(pending.errors, 1);
  assert.equal(pending.last_fetch, null);
  assert.equal(toMonitoringRow({ enabled: false, integration_status: "connected" }).status, "Disabled");
  assert.equal(toMonitoringRow({ enabled: true, integration_status: "blocked" }).status, "Blocked");
});

test("admin monitoring feed exposes exactly the required columns", () => {
  const row = toMonitoringRow({
    id: 1,
    slug: "test-source",
    name: "Test Source",
    enabled: true,
    integration_status: "connected",
    last_sync_at: "2026-01-01T00:00:00Z",
    last_error: null,
    jobs_found: 12,
    new_jobs: 3,
    updated: 4,
    errors: 0,
  });
  // The React admin console renders these fields under the exact headings
  // Source | Status | Last Fetch | Jobs Found | New Jobs | Updated | Errors.
  const displayFields = ["name", "slug", "status", "last_fetch", "jobs_found", "new_jobs", "updated", "errors"];
  for (const field of displayFields) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, field), `missing monitoring field: ${field}`);
  }
  assert.equal(row.last_fetch, "2026-01-01T00:00:00Z");
  assert.equal(row.jobs_found, 12);
  assert.equal(row.new_jobs, 3);
  assert.equal(row.updated, 4);
  assert.equal(row.errors, 0);
});
