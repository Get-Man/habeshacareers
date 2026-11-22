// Standalone ETcareers scraper tests — pure, no network and no database.
// These pin the exact container scoping, verbatim description HTML, noise
// removal, employer-logo selection and the application URL hierarchy.

import assert from "node:assert/strict";
import { test } from "node:test";

import { scrapeEtcareers } from "../etcareers-scraper.mjs";

const URL = "https://etcareers.com/jobs/example-vacancy-f7206e1b";
// Root-relative fixture paths must resolve against the page origin.
const png = (name) => `https://etcareers.com/uploads/${name}`;

function extract(html) {
  return scrapeEtcareers(URL, { html, quiet: true });
}

const ZAMZAM_LIKE = `<html><head><title>Example Vacancy at Example</title></head><body>
<img id="board-logo" alt="Etcareers.com logo" src="https://etcareers.com/logo.png">
<main>
  <div class="grid md:grid-cols-12">
    <div class="md:col-span-9">
      <div class="flex items-start gap-5">
        <div class="flex-shrink-0"><img alt="Example Bank S.C logo" width="64" height="64" src="/uploads/examplebank.png"></div>
        <div class="w-full">
          <h1>Example Bank S.C Job Vacancy 2026 – 2 Positions in Ethiopia </h1>
          <a href="/jobs/example-vacancy-f7206e1b">Example Bank S.C</a>
        </div>
      </div>
      <div class="mt-1 pt-2 flex flex-col gap-2">
        <div id="job-posted-at">2 days ago</div>
        <div>Full-time</div>
        <div>On-site</div>
        <div>Addis Ababa and Adama, Ethiopia</div>
        <div>Banking Jobs in Ethiopia</div>
      </div>
    </div>
    <div class="md:col-span-3">
      <a id="apply-btn" data-action="click-&gt;jobs#onApply" href="https://forms.gle/abc123?utm_source=Etcareers.com">Apply now</a>
    </div>
  </div>
  <div class="mt-12 rich-text">
<p>Intro paragraph.</p>
<h2>Job Overview</h2>
<ul>
<li><strong>Application Deadline:</strong> Within 7 days from the announcement date</li>
</ul>
<p><strong>Online Application Link:</strong> <a href="https://forms.gle/abc123">https://forms.gle/abc123</a></p>
<div class="advertisement">Buy Maps — Career coaching</div>
<a href="https://t.me/etcareersjobs" aria-label="Share with Friends">Join ETcareers on Telegram</a>
  </div>
  <div id="similar-jobs"><h2>More jobs</h2><a href="/jobs/other">Other job</a></div>
  <footer>ETcareers</footer>
</main></body></html>`;

test("extracts the exact header fields from the live-style layout", async () => {
  const r = await extract(ZAMZAM_LIKE);
  assert.equal(r.job_title, "Example Bank S.C Job Vacancy 2026 – 2 Positions in Ethiopia");
  assert.equal(r.organization_name, "Example Bank S.C");
  assert.equal(r.logo_url, png("examplebank.png"));
  assert.deepEqual(r.metadata.locations, ["Addis Ababa and Adama, Ethiopia"]);
  assert.equal(r.metadata.employment_type, "Full-time");
  assert.equal(r.metadata.posted_date, "2 days ago");
  assert.equal(r.metadata.deadline, "Within 7 days from the announcement date");
});

test("keeps the description markup verbatim but strips ads, social promos and related jobs", async () => {
  const r = await extract(ZAMZAM_LIKE);
  assert.match(r.description_html, /<h2>Job Overview<\/h2>/);
  assert.match(r.description_html, /<li>\s*<strong>Application Deadline:<\/strong>/);
  assert.match(r.description_html, /<a href="https:\/\/forms\.gle\/abc123">/);
  assert.doesNotMatch(r.description_html, /advertisement|Buy Maps|Career coaching/i);
  assert.doesNotMatch(r.description_html, /telegram|share with friends/i);
  assert.doesNotMatch(r.description_html, /More jobs|similar-jobs|Other job/);
});

test("uses the primary Apply now href and generates the exact button HTML", async () => {
  const r = await extract(ZAMZAM_LIKE);
  assert.equal(r.apply_url, "https://forms.gle/abc123?utm_source=Etcareers.com");
  assert.equal(
    r.apply_button_html,
    '<a href="https://forms.gle/abc123?utm_source=Etcareers.com" target="_blank" rel="noopener noreferrer" class="apply-now-btn">Apply Now</a>'
  );
});

const EMAIL_ONLY = `<html><body>
<main>
  <div><div><img alt="Benchline Reports logo" src="/uploads/benchline.png">
    <div><h1>Senior Researcher</h1><a href="https://benchlinereports.com/">Benchline Reports</a></div>
    <div id="job-posted-at">7 days ago</div><div>Part-time</div></div></div>
  <div class="rich-text"><p>Apply by email. <strong>Location:</strong> Worldwide.</p></div>
  <a id="apply-btn" href="mailto:hiring@example.com">Apply now</a>
</main></body></html>`;

test("email-only jobs keep apply_url null and still resolve the description location", async () => {
  const r = await extract(EMAIL_ONLY);
  assert.equal(r.apply_url, null);
  assert.equal(r.apply_button_html, null);
  assert.deepEqual(r.metadata.locations, ["Worldwide"]);
  assert.equal(r.organization_name, "Benchline Reports");
  assert.equal(r.logo_url, png("benchline.png"));
});

test("returns null logo when only ETcareers branding is present", async () => {
  const NO_LOGO = `<html><body><main>
  <div><img id="board-logo" alt="Etcareers.com logo" src="https://etcareers.com/logo.png">
    <div><h1>Some Job</h1><a href="/jobs/some-job">Unknown Org</a></div></div>
  <div class="rich-text"><p>Some employer content about the vacancy.</p></div>
  <a id="apply-btn" href="https://example.com/apply">Apply now</a>
</main></body></html>`;
  const r = await extract(NO_LOGO);
  assert.equal(r.logo_url, null);
  assert.equal(r.apply_url, "https://example.com/apply");
});
