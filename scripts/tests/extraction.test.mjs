// Unit tests for the pure extraction helpers.
//
// These modules contain no network or database access, so they are tested
// directly against fixtures and synthetic pages.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalEmployerName,
  collectPublisherAssets,
  employerKey,
  extractJsonLdLogo,
  extractSiteLogoCandidates,
  faviconServiceCandidates,
  inferEmployerDomain,
  isFaviconServiceUrl,
  isPublishableLogo,
  isSourceHostedLogo,
  pickBestLogo,
  verifyLogoOwnership,
} from "../../lib/jobs/extract/employer-logo.mjs";

import {
  APPLY_URL_TYPES,
  classifyDestination,
  detectApplicationLinks,
  isSourceApplicationPath,
} from "../../lib/jobs/extract/apply-link.mjs";

import { identifyEmployer, cleanOrgName, isGenericOrganization, UNVERIFIED_ORGANIZATION } from "../../lib/jobs/extract/employer.mjs";
import { computeJobStatus, daysUntil, detectUnavailablePage, isJsonLdEligible } from "../../lib/jobs/extract/validate.mjs";
import { canonicalUrl, isLikelyJobUrl, isListingUrl, jobPublicPath, normalizeUrl } from "../../lib/jobs/extract/urls.mjs";
import { extractJsonLd, extractMeta, findJobPosting, sanitizeHtml, stripDangerousBlocks } from "../../lib/jobs/extract/html.mjs";
import { collectFlightText, decodeFlightPayload, findJobRecords } from "../../lib/jobs/extract/flight.mjs";
import { extractFromStructuredJob } from "../../lib/jobs/extract/structured.mjs";
import { extractDerejaRecords } from "../../lib/jobs/sources/dereja.mjs";
import { getAdapter, listAdapterKeys } from "../../lib/jobs/sources/adapters.mjs";

const SOURCE = { name: "GeezJobs", slug: "geezjobs", base_url: "https://geezjobs.com/", listing_url: "https://geezjobs.com/" };

// ---------------------------------------------------------------------------
// Employer identity
// ---------------------------------------------------------------------------

test("employerKey collapses legal suffixes and punctuation", () => {
  assert.equal(employerKey("Amhara Bank PLC"), "amhara bank");
  assert.equal(employerKey("Santa Maria Construction"), "santa maria construction");
  assert.equal(employerKey("  Amhara   Bank  "), "amhara bank");
  // The same organisation written differently must collapse to one key.
  assert.equal(employerKey("Amhara Bank S.C."), "amhara bank");
});

test("canonicalEmployerName strips trailing source noise", () => {
  assert.equal(canonicalEmployerName("TikTok Live | GeezJobs"), "TikTok Live");
  assert.equal(canonicalEmployerName("Amhara Bank"), "Amhara Bank");
});

test("generic organisation names are rejected", () => {
  assert.equal(isGenericOrganization("Jobs"), true);
  assert.equal(isGenericOrganization("Organization not verified"), true);
  assert.equal(isGenericOrganization("Amhara Bank"), false);
});

test("employer is read from the hiring organisation, not the publisher", () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "WASH Officer",
    hiringOrganization: { "@type": "Organization", name: "Imagine1day International Organization" },
  })}</script></head><body></body></html>`;
  const jsonLd = findJobPosting(extractJsonLd(html));
  const employer = identifyEmployer({ jsonLd, html, pageUrl: "https://geezjobs.com/job-detail/x", source: SOURCE });
  assert.equal(employer.name, "Imagine1day International Organization");
  assert.equal(employer.verified, true);
});

test("the publishing site is never accepted as the employer", () => {
  const jsonLd = { hiringOrganization: { name: "GeezJobs" } };
  const employer = identifyEmployer({ jsonLd, html: "", pageUrl: "https://geezjobs.com/job-detail/x", source: SOURCE });
  assert.equal(employer.name, UNVERIFIED_ORGANIZATION);
});

test("an unverified employer falls back to the placeholder", () => {
  const employer = identifyEmployer({ jsonLd: null, html: "<p>nothing here</p>", pageUrl: "https://geezjobs.com/job-detail/x", source: SOURCE });
  assert.equal(employer.name, UNVERIFIED_ORGANIZATION);
  assert.equal(employer.verified, false);
});

// ---------------------------------------------------------------------------
// Employer domain inference
// ---------------------------------------------------------------------------

test("the employer's own domain is inferred from structured data", () => {
  const jsonLd = { hiringOrganization: { name: "IDC", sameAs: "https://idcoalition.org/" } };
  const inferred = inferEmployerDomain({ jsonLd, source: SOURCE, employerName: "IDC" });
  assert.equal(inferred.domain, "idcoalition.org");
});

test("the announcement's own url is never taken as the employer website", () => {
  const inferred = inferEmployerDomain({
    jsonLd: { hiringOrganization: { name: "IDC" } },
    meta: { "og:url": "https://geezjobs.com/job-detail/wash-officer" },
    source: SOURCE,
    employerName: "IDC",
  });
  // No employer evidence at all -> no website inferred.
  assert.equal(inferred, null);
});

test("a source-hosted sameAs link is not the employer's website", () => {
  const jsonLd = { hiringOrganization: { name: "Santa Maria", sameAs: "https://srazone.et/employers/Santa" } };
  const inferred = inferEmployerDomain({ jsonLd, source: { ...SOURCE, base_url: "https://srazone.et/" }, employerName: "Santa Maria" });
  assert.equal(inferred, null);
});

test("the employer's domain is found in the application url address", () => {
  const inferred = inferEmployerDomain({
    jsonLd: { hiringOrganization: { name: "Great Abyssinia Group" } },
    applyUrl: "https://ats.ethiojobs.net/company/jobs/corporate-hr@greatabyssinia.com",
    source: SOURCE,
    employerName: "Great Abyssinia Group",
  });
  assert.equal(inferred.domain, "greatabyssinia.com");
});

test("an address on a source domain does not become the employer's website", () => {
  const inferred = inferEmployerDomain({
    jsonLd: { hiringOrganization: { name: "Great Abyssinia Group" } },
    applyUrl: "https://ats.ethiojobs.net/company/jobs/recruiter@geezjobs.com",
    source: SOURCE,
    employerName: "Great Abyssinia Group",
  });
  assert.equal(inferred, null);
});

// ---------------------------------------------------------------------------
// Logo verification
// ---------------------------------------------------------------------------

test("a logo on the employer's own domain is accepted", () => {
  const verdict = verifyLogoOwnership(
    { url: "https://idcoalition.org/wp-content/uploads/logo.png", kind: "employer_site" },
    { employerDomain: "idcoalition.org" }
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.kind, "employer_site");
});

test("a logo on an unrelated host is rejected", () => {
  const verdict = verifyLogoOwnership(
    { url: "https://some-random-blog.example/logo.png", kind: "employer_site" },
    { employerDomain: "idcoalition.org" }
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "unrelated_host");
});

test("a favicon service keyed on the employer's domain is accepted", () => {
  const verdict = verifyLogoOwnership(
    { url: "https://www.google.com/s2/favicons?domain=idcoalition.org&sz=128", kind: "favicon_service" },
    { employerDomain: "idcoalition.org" }
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.kind, "favicon_service");
});

test("a favicon service keyed on the SOURCE domain is rejected", () => {
  const verdict = verifyLogoOwnership(
    { url: "https://www.google.com/s2/favicons?domain=geezjobs.com&sz=128", kind: "favicon_service" },
    { employerDomain: "idcoalition.org", source: SOURCE }
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "favicon_service_points_at_source");
});

test("a favicon service keyed on another organisation is rejected", () => {
  const verdict = verifyLogoOwnership(
    { url: "https://icons.duckduckgo.com/ip3/other.org.ico", kind: "favicon_service" },
    { employerDomain: "idcoalition.org" }
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "favicon_service_domain_mismatch");
});

test("the publisher's own logo assets are rejected", () => {
  for (const url of [
    "https://geezjobs.com/assets/image/geezjobs-logo.png",
    "https://geezjobs.com/image/ogimage/geezjobsog.webp",
    "https://example.com/default-logo.png",
    "https://example.com/placeholder-logo.svg",
  ]) {
    const verdict = verifyLogoOwnership({ url, kind: "employer_site" }, { employerDomain: "example.com" });
    assert.equal(verdict.ok, false, `expected ${url} to be rejected`);
  }
});

test("the publisher's favicon is not treated as an employer logo", () => {
  const html = `<link rel="icon" href="https://geezjobs.com/favicon.png">`;
  const assets = collectPublisherAssets(html);
  assert.ok(assets.includes("https://geezjobs.com/favicon.png"));
  const verdict = verifyLogoOwnership(
    { url: "https://geezjobs.com/favicon.png", kind: "employer_site" },
    { employerDomain: "geezjobs.com", publisherAssets: assets }
  );
  assert.equal(verdict.ok, false);
});

test("a logo declared for the hiring organisation on the board CDN is accepted as a mirror", () => {
  const verdict = verifyLogoOwnership(
    { url: "https://geezjobs.com/image/logo/38df8e032004e330.jpeg", kind: "jsonld" },
    { employerDomain: null, source: SOURCE }
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.kind, "board_mirror");
});

test("site logo candidates are read from the employer's own website", () => {
  const html = `<html><head>
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" href="/favicon.ico">
    <meta property="og:image" content="/og.png">
    </head><body><img src="/assets/logo.svg" alt="Company logo"></body></html>`;
  const candidates = extractSiteLogoCandidates(html, "https://idcoalition.org/");
  assert.ok(candidates.length >= 3);
  assert.ok(candidates.every((c) => c.host === "idcoalition.org"));
  // The apple touch icon outranks the og:image.
  assert.equal(candidates[0].label, "apple-touch-icon");
});

test("favicon service candidates are keyed on the organisation domain", () => {
  const candidates = faviconServiceCandidates("idcoalition.org");
  assert.ok(candidates.length >= 1);
  assert.ok(candidates.every((c) => c.url.includes("idcoalition.org")));
  assert.equal(faviconServiceCandidates("not a domain").length, 0);
});

test("isFaviconServiceUrl recognises both services", () => {
  assert.equal(isFaviconServiceUrl("https://www.google.com/s2/favicons?domain=x.org&sz=128"), true);
  assert.equal(isFaviconServiceUrl("https://icons.duckduckgo.com/ip3/x.org.ico"), true);
  assert.equal(isFaviconServiceUrl("https://x.org/logo.png"), false);
});

test("source-hosted logos are never publishable directly but are detected as source hosted", () => {
  const url = "https://geezjobs.com/image/logo/abc.jpeg";
  assert.equal(isPublishableLogo(url, { source: SOURCE }), false);
  assert.equal(isSourceHostedLogo(url, { source: SOURCE }), true);
  assert.equal(isPublishableLogo("https://idcoalition.org/logo.png", { source: SOURCE }), true);
});

test("the best logo is the highest weighted verified candidate", () => {
  const best = pickBestLogo(
    [
      { url: "https://idcoalition.org/favicon.ico", kind: "employer_site", weight: 80 },
      { url: "https://www.google.com/s2/favicons?domain=idcoalition.org&sz=128", kind: "favicon_service", weight: 55 },
      { url: "https://evil.example/logo.png", kind: "employer_site", weight: 99 },
    ],
    { employerDomain: "idcoalition.org" }
  );
  assert.equal(best.url, "https://idcoalition.org/favicon.ico");
});

// ---------------------------------------------------------------------------
// Application links
// ---------------------------------------------------------------------------

test("a listing page is never a valid application destination", () => {
  const dest = classifyDestination("https://geezjobs.com/jobs-in-ethiopia", { source: SOURCE, pageUrl: "https://geezjobs.com/job-detail/x" });
  assert.equal(dest.valid, false);
  assert.equal(dest.type, APPLY_URL_TYPES.SOURCE);
});

test("a per-vacancy application form on the board is accepted", () => {
  const dest = classifyDestination("https://geezjobs.com/job-application/tiktok-live-shemmatex", {
    source: SOURCE,
    pageUrl: "https://geezjobs.com/job-detail/tiktok-live-shemmatex",
  });
  assert.equal(dest.valid, true);
  assert.equal(dest.type, APPLY_URL_TYPES.SOURCE_APPLICATION);
});

test("a board category page is not an application destination", () => {
  const dest = classifyDestination("https://geezjobs.com/jobs/category/it", { source: SOURCE, pageUrl: "https://geezjobs.com/job-detail/x" });
  assert.equal(dest.valid, false);
});

test("an ATS application page is classified as an ATS destination", () => {
  const dest = classifyDestination("https://idc.bamboohr.com/careers/51", { source: SOURCE });
  assert.equal(dest.valid, true);
  assert.equal(dest.type, APPLY_URL_TYPES.ATS);
});

test("a social share link is never an application destination", () => {
  const dest = classifyDestination("https://www.facebook.com/sharer/sharer.php?u=x", { source: SOURCE });
  assert.equal(dest.valid, false);
  assert.equal(dest.type, APPLY_URL_TYPES.SOCIAL);
});

test("an image link is never an application destination", () => {
  const dest = classifyDestination("https://geezjobs.com/image/logo/abc.jpeg", { source: SOURCE });
  assert.equal(dest.valid, false);
  assert.equal(dest.type, APPLY_URL_TYPES.IMAGE);
});

test("an application email is accepted", () => {
  const dest = classifyDestination("mailto:jobs@employer.example", { source: SOURCE });
  assert.equal(dest.valid, true);
  assert.equal(dest.type, APPLY_URL_TYPES.EMAIL);
});

test("a source-domain email is rejected", () => {
  const dest = classifyDestination("mailto:jobs@geezjobs.com", { source: SOURCE });
  assert.equal(dest.valid, false);
});

test("isSourceApplicationPath requires a per-vacancy path", () => {
  assert.equal(isSourceApplicationPath("https://geezjobs.com/job-application/abc", { pageUrl: "https://geezjobs.com/job-detail/abc" }), true);
  assert.equal(isSourceApplicationPath("https://geezjobs.com/jobs", { pageUrl: "https://geezjobs.com/job-detail/abc" }), false);
  assert.equal(isSourceApplicationPath("https://geezjobs.com/job-application/other", { pageUrl: "https://geezjobs.com/job-detail/abc" }), false);
});

test("application links are detected and ranked from a page", () => {
  const html = `<html><body>
    <h2>How to apply</h2>
    <p>Send your CV to <a href="mailto:hr@employer.example">hr@employer.example</a></p>
    <a href="https://geezjobs.com/job-application/wash-officer">Apply now</a>
    <a href="https://www.facebook.com/sharer">Share</a>
  </body></html>`;
  const result = detectApplicationLinks({
    html,
    pageUrl: "https://geezjobs.com/job-detail/wash-officer",
    source: SOURCE,
    employerName: "Employer",
  });
  assert.ok(result.selected, "expected a selected application destination");
  assert.equal(result.selected.urlType, APPLY_URL_TYPES.EMAIL);
  assert.ok(result.candidates.length >= 2);
  // The social share link must never be a candidate.
  assert.equal(result.candidates.some((c) => c.url.includes("facebook.com")), false);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("an unavailable page is detected", () => {
  assert.equal(detectUnavailablePage("This job is no longer available"), true);
  assert.equal(detectUnavailablePage("A normal job description"), false);
});

test("job status reflects the deadline", () => {
  const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  assert.equal(computeJobStatus({ deadline: past, extractionStatus: "verified" }), "expired");
  assert.equal(computeJobStatus({ deadline: future, extractionStatus: "verified" }), "open");
  assert.equal(computeJobStatus({ deadline: future, extractionStatus: "failed" }), "unavailable");
  assert.ok(daysUntil(future) > 0);
});

test("structured data is only eligible for complete open vacancies", () => {
  const base = {
    title: "Engineer",
    company: "Amhara Bank",
    status: "active",
    jobStatus: "open",
    extractionStatus: "verified",
    applyUrl: "https://employer.example/apply",
    description: "x".repeat(200),
  };
  assert.equal(isJsonLdEligible(base), true);
  assert.equal(isJsonLdEligible({ ...base, status: "pending" }), false);
  assert.equal(isJsonLdEligible({ ...base, jobStatus: "expired" }), false);
  assert.equal(isJsonLdEligible({ ...base, company: "Organization not verified" }), false);
  assert.equal(isJsonLdEligible({ ...base, applyUrl: null }), false);
});

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

test("tracking parameters are stripped and the path is normalised", () => {
  assert.equal(normalizeUrl("https://Example.com:443/Job//1/?utm_source=x&b=2&a=1#top"), "https://example.com/Job/1?a=1&b=2");
  assert.equal(canonicalUrl("https://example.com/job/1?utm_source=x&sid=abc"), "https://example.com/job/1");
});

test("job and listing urls are distinguished", () => {
  assert.equal(isLikelyJobUrl("https://example.com/job/senior-engineer"), true);
  assert.equal(isLikelyJobUrl("https://example.com/vacancy-detail.php?id=12"), true);
  assert.equal(isListingUrl("https://example.com/jobs"), true);
  assert.equal(isListingUrl("https://example.com/jobs?page=2"), true);
});

test("the public job path is stable and readable", () => {
  assert.equal(jobPublicPath(42, "Senior Engineer"), "/job/42/senior-engineer");
  assert.equal(jobPublicPath(7, "Ünïcode Tïtle"), "/job/7/unicode-title");
});

// ---------------------------------------------------------------------------
// HTML sanitising
// ---------------------------------------------------------------------------

test("scripts and their content are removed from text", () => {
  const html = `<div>Visible<script>var x = {"url":"https://schema.org/"};</script>Hidden</div>`;
  const text = stripDangerousBlocks(html);
  assert.equal(text.includes("schema.org"), false);
});

test("dangerous markup and handlers are stripped", () => {
  const out = sanitizeHtml('<p onclick="steal()">Hi</p><script>bad()</script><a href="javascript:evil()">x</a>');
  assert.equal(out.includes("onclick"), false);
  assert.equal(out.includes("javascript:"), false);
  assert.equal(out.includes("bad()"), false);
  assert.ok(out.includes("Hi"));
});

test("meta extraction reads og tags", () => {
  const meta = extractMeta('<meta property="og:title" content="A title"><meta name="description" content="Desc">');
  assert.equal(meta["og:title"], "A title");
  assert.equal(meta.description, "Desc");
});

// ---------------------------------------------------------------------------
// Next.js flight payload (client-rendered sources)
// ---------------------------------------------------------------------------

test("the flight payload is decoded and job records are found", () => {
  const record = JSON.stringify({
    slug: "wash-officer",
    title: "WASH Officer",
    company: { name: "Imagine1day", website: "www.imagine1day.org" },
    description: "Some description",
  });
  const payload = `7:${record}`;
  const jobs = findJobRecords(payload, { requiredKeys: ["slug"] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].slug, "wash-officer");
});

test("flight text is collected in document order", () => {
  const tree = ["$", "div", null, { children: ["$", "p", "0", { children: "Hello" }] }];
  assert.deepEqual(collectFlightText(tree), ["Hello"]);
});

test("dereja records are read from a listing payload", () => {
  const record = JSON.stringify({
    slug: "wash-officer",
    title: "WASH Officer",
    company: { name: "Imagine1day", website: "www.imagine1day.org" },
    description: "Description body",
    requirement: "Requirement body",
    how_to_apply: '<p><a href="https://forms.gle/abc">Apply</a></p>',
    date_expiry: "2026-11-21T23:59:59.000000Z",
    city: "Kemashi",
    career_page_link: "https://forms.gle/abc",
  });
  const records = extractDerejaRecords(`3:I[1,2,3]\n7:${record}`);
  assert.equal(records.length, 1);
  assert.equal(records[0].slug, "wash-officer");

  const built = extractFromStructuredJob(records[0], { pageUrl: "https://www.dereja.com/jobs/wash-officer" });
  assert.equal(built.title, "WASH Officer");
  assert.equal(built.company, "Imagine1day");
  assert.equal(built.applyUrl, "https://forms.gle/abc");
  assert.equal(built.deadline, "2026-11-21");
  assert.ok(built.description.includes("Description body"));
});

test("the html flight wrapper is decoded", () => {
  const html = `<script>self.__next_f.push([1,"7:[{\\"slug\\":\\"abc\\"}]"])</script>`;
  const decoded = decodeFlightPayload(html);
  assert.ok(decoded.includes("slug"));
});

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

test("every registered source slug resolves to an adapter", () => {
  const keys = listAdapterKeys();
  assert.ok(keys.includes("dereja"));
  assert.ok(keys.includes("ngojobs"));
  assert.ok(keys.includes("srazone"));
  assert.ok(keys.includes("jobwebethiopia"));
  assert.ok(keys.includes("ethiopianjobs-net"));
  assert.ok(keys.includes("geezjobs"));
});

test("historical adapter aliases still resolve", () => {
  assert.ok(getAdapter({ slug: "etcaeers" }));
  assert.ok(getAdapter({ slug: "ethiopianreporterjobs" }));
  assert.ok(getAdapter({ adapter_key: "ngojobs" }));
  assert.equal(getAdapter({ slug: "not-a-source" }), null);
});
