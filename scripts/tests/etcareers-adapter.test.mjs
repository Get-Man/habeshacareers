// ETCareers adapter pipeline tests (pure: no network, no database).
//
// Pins each step of the requested adapter:
//   detect job cards -> extract job URL -> open individual job ->
//   identify main content -> locate "Apply now" -> extract href ->
//   follow/decode redirect -> validate application domain ->
//   return normalized job JSON.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectEtcareersJobCards,
  ETCAREERS_JOB_URL_RE,
  extractEtcareersJobUrl,
  findNextEtcareersPage,
} from "../../lib/jobs/sources/etcareers-cards.mjs";
import {
  identifyMainContent,
  locateApplyLink,
  parseJobPosting,
} from "../../lib/jobs/connectors/etcareers.mjs";
import {
  discoverSource,
  getAdapter,
  JOB_DETAIL_PATTERNS,
} from "../../lib/jobs/sources/adapters.mjs";
import { decodeRedirectUrl } from "../../lib/jobs/extract/urls.mjs";
import {
  APPLY_URL_TYPES,
  classifyDestination,
} from "../../lib/jobs/extract/apply-link.mjs";

const LISTING_HTML = `<html><body>
  <header><a href="/jobs">All jobs</a><a href="/jobs/new">Post a job</a></header>
  <main>
    <li><a class="block rounded-xl border" href="/jobs/senior-researcher-112105a7">
      <h3 class="text-lg font-medium truncate">Senior Researcher</h3>
      <p>International Livestock Research Institute</p>
      <p>Addis Ababa, Ethiopia</p>
      <p>4 hours</p>
    </a></li>
    <li><a class="block rounded-xl border" href="https://etcareers.com/jobs/wfp-programme-officer-3cb6c6ba?utm_source=rss">
      <h3>Programme Officer</h3>
      <p>World Food Programme</p>
    </a></li>
  </main>
  <a href="/jobs?page=2">Next</a>
</body></html>`;

const ATS_URL = "https://ilri.bamboohr.com/careers/51";
const REDIRECT_HREF = `https://track.example.com/away?url=${encodeURIComponent(ATS_URL)}`;

const DETAIL_HTML = `<html><head>
  <script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Senior Researcher",
    identifier: { value: "etc-112105a7" },
    hiringOrganization: { "@type": "Organization", name: "International Livestock Research Institute" },
    jobLocation: { "@type": "Place", address: { addressLocality: "Addis Ababa" } },
    employmentType: "FULL_TIME",
    datePosted: "2026-11-01",
    description: "<p>Research duties and responsibilities for the role.</p>",
  })}</script>
</head><body>
  <main id="job-description" class="job-detail">
    <h1>Senior Researcher</h1>
    <p>Research duties and responsibilities for the role.</p>
    <a href="${REDIRECT_HREF}">Apply now</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
  </main>
</body></html>`;

const DETAIL_URL = "https://etcareers.com/jobs/senior-researcher-112105a7";
const ETCAREERS_SOURCE = { slug: "etcareers", base_url: "https://etcareers.com" };

// ---------------------------------------------------------------------------
// Steps 1-2: detect job cards and extract the ETCareers job URL
// ---------------------------------------------------------------------------

test("step 1: detects job cards from the public listing page", () => {
  const cards = detectEtcareersJobCards(LISTING_HTML, "https://etcareers.com/jobs");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].title, "Senior Researcher");
  assert.equal(cards[0].company, "International Livestock Research Institute");
  assert.equal(cards[0].location, "Addis Ababa, Ethiopia");
  assert.equal(cards[1].title, "Programme Officer");
  // Navigation links are not cards.
  assert.equal(cards.some((c) => /\/jobs\/new$/.test(c.url)), false);
});

test("step 2: extracts canonical ETCareers job URLs and rejects non-detail links", () => {
  const url = extractEtcareersJobUrl("/jobs/senior-researcher-112105a7", "https://etcareers.com/jobs");
  assert.equal(url, DETAIL_URL);
  assert.ok(JOB_DETAIL_PATTERNS.etcareers.test(url));
  assert.ok(ETCAREERS_JOB_URL_RE.test(url));

  // Tracking params are stripped; archives, home and off-site links are not jobs.
  assert.equal(extractEtcareersJobUrl("/jobs/wfp-programme-officer-3cb6c6ba?utm_source=rss", "https://etcareers.com/jobs"), "https://etcareers.com/jobs/wfp-programme-officer-3cb6c6ba");
  assert.equal(extractEtcareersJobUrl("/jobs?page=2", "https://etcareers.com/jobs"), null);
  assert.equal(extractEtcareersJobUrl("/jobs/new", "https://etcareers.com/jobs"), null);
  assert.equal(extractEtcareersJobUrl("https://example.com/jobs/other-112105a7", "https://etcareers.com/jobs"), null);
  assert.equal(findNextEtcareersPage(LISTING_HTML, 1), 2);
  assert.equal(findNextEtcareersPage(LISTING_HTML, 4), null);
});

test("the ETCareers adapter resolves by slug and discovers cards without network", async () => {
  const adapter = getAdapter({ slug: "etcareers" });
  assert.ok(adapter);
  assert.equal(adapter.key, "etcareers");
  assert.equal(typeof adapter.discover, "function");

  const result = await discoverSource(
    { slug: "etcareers", fetch_config: {} },
    {
      limit: 10,
      offset: 1,
      fetchText: async (url) => ({ ok: true, text: LISTING_HTML, url }),
    }
  );
  assert.equal(result.adapter, "etcareers");
  assert.equal(result.mode, "etcareers-cards");
  assert.equal(result.urls.length, 2);
  assert.equal(result.urls[0].url, DETAIL_URL);
  assert.equal(result.nextOffset, 2);
  assert.equal(result.done, false);
});

test("discovery falls back to the public sitemap when the listing is unavailable", async () => {
  const sitemap = `<?xml version="1.0"?><urlset>
    <loc>https://etcareers.com/</loc>
    <loc>https://etcareers.com/jobs</loc>
    <loc>https://etcareers.com/jobs/natural-resource-officer-d36ab6f6</loc>
  </urlset>`;
  const result = await discoverSource(
    { slug: "etcareers", fetch_config: {} },
    {
      limit: 10,
      offset: 0,
      fetchText: async (url) =>
        /sitemap\.xml/.test(url)
          ? { ok: true, text: sitemap, url }
          : { ok: false, status: 502, error: "http_502" },
    }
  );
  assert.equal(result.mode, "sitemap");
  assert.deepEqual(result.urls.map((u) => u.url), ["https://etcareers.com/jobs/natural-resource-officer-d36ab6f6"]);
});

// ---------------------------------------------------------------------------
// Steps 3-4: open the individual job and identify its main content
// ---------------------------------------------------------------------------

test("steps 3-4: the individual page's main content is isolated", () => {
  const main = identifyMainContent(DETAIL_HTML);
  assert.match(main, /Research duties and responsibilities/);
  assert.match(main, /Apply now/);
});

// ---------------------------------------------------------------------------
// Steps 5-8: locate "Apply now", extract href, follow/decode redirect,
//            validate the application domain.
// ---------------------------------------------------------------------------

test("step 7: a wrapped redirect href is decoded to the real destination", () => {
  assert.equal(decodeRedirectUrl(REDIRECT_HREF, DETAIL_URL), ATS_URL);
});

test("step 8: the destination domain is validated, board/social links are not", () => {
  const ats = classifyDestination(ATS_URL, { source: ETCAREERS_SOURCE, pageUrl: DETAIL_URL });
  assert.equal(ats.valid, true);
  assert.equal(ats.type, APPLY_URL_TYPES.ATS);

  const board = classifyDestination("https://etcareers.com/jobs", { source: ETCAREERS_SOURCE, pageUrl: DETAIL_URL });
  assert.equal(board.valid, false);
  const social = classifyDestination("https://www.facebook.com/sharer/sharer.php?u=x", { source: ETCAREERS_SOURCE });
  assert.equal(social.valid, false);
  assert.equal(social.type, APPLY_URL_TYPES.SOCIAL);
});

test("steps 5-8: 'Apply now' href is located, decoded and domain-validated", () => {
  const result = locateApplyLink(DETAIL_HTML, DETAIL_URL, ETCAREERS_SOURCE);
  assert.ok(result.chosen, "expected an apply link");
  assert.equal(result.chosen.label, "Apply now");
  assert.equal(result.chosen.href, REDIRECT_HREF);
  assert.equal(result.chosen.decoded, ATS_URL);
  assert.equal(result.chosen.url, ATS_URL);
  assert.equal(result.chosen.valid, true);
  assert.equal(result.chosen.type, APPLY_URL_TYPES.ATS);
  // Social/share links never become application candidates.
  assert.equal(result.candidates.some((c) => c.url.includes("facebook.com")), false);
});

// ---------------------------------------------------------------------------
// Step 9: return normalized job JSON
// ---------------------------------------------------------------------------

test("step 9: normalized job JSON carries real, validated apply information", () => {
  const job = parseJobPosting(DETAIL_HTML, DETAIL_URL, ETCAREERS_SOURCE);
  assert.ok(job, "expected a normalized job");
  assert.equal(job.title, "Senior Researcher");
  assert.equal(job.company, "International Livestock Research Institute");
  assert.equal(job.location, "Addis Ababa");
  assert.equal(job.job_type, "Full Time");
  assert.equal(job.original_url, DETAIL_URL);
  assert.equal(job.source_page, DETAIL_URL);
  assert.equal(job.raw_source, "etcareers-jsonld");
  assert.match(job.description, /Research duties/);
  assert.ok(job.application_instructions.includes(ATS_URL), "validated apply URL must be published");

  // The normalized shape has no fabricated fields and no source-domain apply URL.
  assert.equal(job.contact_email, null);
  assert.equal(job.application_instructions.includes("etcareers.com/jobs/senior"), false);
});

// ---------------------------------------------------------------------------
// Real-board regression: live ETCareers pages render the CTA as
// <a id="apply-btn" ... href="mailto:...">Apply now</a>, with the employer
// homepage also present in the description. The mailto must win.
// ---------------------------------------------------------------------------

const REAL_CTA_HTML = DETAIL_HTML.replace(
  /<a href="[^"]+">Apply now<\/a>/,
  '<a id="apply-btn" data-action="click->job#onApply" href="mailto:hiring@benchlinereports.com">Apply now</a>'
);

test("real-board 'Apply now' mailto button is located, validated and published", () => {
  const located = locateApplyLink(REAL_CTA_HTML, DETAIL_URL, ETCAREERS_SOURCE);
  assert.ok(located.chosen);
  assert.equal(located.chosen.label, "Apply now");
  assert.equal(located.chosen.primary, true);
  assert.equal(located.chosen.url, "mailto:hiring@benchlinereports.com");
  assert.equal(located.chosen.type, APPLY_URL_TYPES.EMAIL);
  assert.equal(located.chosen.valid, true);

  const job = parseJobPosting(REAL_CTA_HTML, DETAIL_URL, ETCAREERS_SOURCE);
  assert.equal(job.application_instructions, "Apply by email: hiring@benchlinereports.com");
  assert.equal(job.application_instructions.includes("benchlinereports.com/"), false);
});
