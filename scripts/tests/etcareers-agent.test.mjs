// Intelligent ETcareers agent tests (pure: no network and no database).
//
// These fixtures pin the hard rules: current job only, no ads/promos/related
// jobs/footer, header-owned logo, application hierarchy and email/physical jobs.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyEtcareersResolution,
  extractEtcareersRecord,
} from "../../lib/jobs/extract/etcareers-agent.mjs";

const SOURCE = { slug: "etcareers", name: "ETcareers", base_url: "https://etcareers.com" };
const DETAIL_URL = "https://etcareers.com/jobs/seed-microfinance-vacancy-2026-4f3a9c12";

function page(body, { head = "", url = DETAIL_URL } = {}) {
  return `<html><head>${head}</head><body>${body}</body></html>`;
}

function record(html, url = DETAIL_URL, applyResolution = null) {
  return extractEtcareersRecord({ html, pageUrl: url, source: SOURCE, applyResolution });
}

const RICH_PAGE = page(`
<header><nav><a href="/jobs">All jobs</a></nav></header>
<main>
  <div class="job-header">
    <div class="flex items-start gap-4">
      <img class="h-full w-full object-contain" alt="Seed Microfinance Institution S.C. logo"
           src="/images/seed-logo.png" width="120" height="120">
      <div>
        <h1>Seed Microfinance Institution Vacancy 2026 – 2 Job Positions</h1>
        <a class="employer-link" href="https://seedmicrofinance.com/">Seed Microfinance Institution S.C.</a>
      </div>
    </div>
    <p>Posted 4 hours ago</p>
    <p>Employment type: Full-time</p>
    <p>Workplace: On-site</p>
    <p>Location: Addis Ababa, Ethiopia</p>
    <a href="/job-category/banking-finance">Banking &amp; Finance Jobs in Ethiopia</a>
    <a href="/job-category/it">IT &amp; Software Development Jobs in Ethiopia</a>
  </div>
  <div class="mt-12 rich-text">
    <p>The institution is recruiting qualified applicants.</p>
    <h2>Job Overview</h2>
    <p>Support the finance and IT teams.</p>
    <h2>Responsibilities</h2>
    <ul><li>Prepare monthly financial reports</li><li>Support internal audits</li></ul>
    <h2>Qualifications</h2>
    <ul><li>Degree in Accounting</li></ul>
    <h2>Work Experience</h2>
    <ul><li>Two years relevant experience</li></ul>
    <h2>Skills</h2>
    <ul><li>Excel</li></ul>
    <p>Duty Station: Head Office, Addis Ababa.</p>
    <p>BUY MAPS</p>
    <p>Join ETcareers on Telegram for Daily Job Updates</p>
    <p><a href="https://t.me/Etcareersjobs">Telegram</a></p>
    <h2>How to Apply</h2>
    <p>Interested and qualified applicants should submit an application letter and updated CV.</p>
    <p>Email: seedmicrofinanceinstitution@gmail.com; alemayehugebreab8@gmail.com</p>
    <p>Physical Address: Seed Microfinance Institution S.C., Degol Building, 4th Floor, Addis Ababa, Ethiopia</p>
    <p>Deadline: November 30, 2026</p>
    <a id="apply-btn" data-action="click->job#onApply" href="mailto:seedmicrofinanceinstitution@gmail.com">Apply now</a>
  </div>
  <div id="similar-jobs">
    <h2>More jobs</h2>
    <p>Addis Ababa City Administration ITDB – 46 Job Opportunities</p>
    <p>CBE Job Vacancy – Vice President – IS Project Management Office</p>
  </div>
</main>
<footer>
  <a href="/jobs">All jobs</a>
  <a href="/job-category/accounting">Accounting &amp; Auditing Jobs in Ethiopia</a>
  <p>© 2026 Etcareers.com</p>
</footer>
`, {
  head: `<meta property="og:image" content="https://assets.jobboardly.com/site-preview.jpg">
  <script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Seed Microfinance Institution Vacancy 2026 – 2 Job Positions",
    hiringOrganization: { "@type": "Organization", name: "Seed Microfinance Institution S.C." },
    datePosted: "2026-11-22",
  })}</script>`,
});

test("returns the exact structured JSON shape", () => {
  const result = record(RICH_PAGE);
  assert.deepEqual(Object.keys(result).sort(), [
    "application", "benefits", "categories", "company", "company_website", "confidence",
    "deadline", "description", "employment_type", "extraction_quality", "experience_requirements",
    "job_overview", "location", "logo", "number_of_positions", "positions", "posted_time",
    "qualifications", "responsibilities", "salary", "skills", "source", "source_url", "title",
    "workplace_type",
  ].sort());
  assert.deepEqual(Object.keys(result.application).sort(), [
    "application_url", "application_url_verified", "apply_button_text", "apply_button_url",
    "emails", "final_application_url", "instructions", "method", "phone_numbers", "physical_address",
  ].sort());
  assert.deepEqual(Object.keys(result.extraction_quality).sort(), [
    "advertisements_removed", "application_url_verified", "footer_removed", "job_content_verified",
    "logo_verified", "related_jobs_removed",
  ].sort());
  assert.deepEqual(Object.keys(result.confidence).sort(), ["application_url", "job", "logo"].sort());
  assert.equal(result.source, "ETcareers");
  assert.equal(result.source_url, DETAIL_URL);
});

test("extracts header identity, metadata and only current-job categories", () => {
  const result = record(RICH_PAGE);
  assert.equal(result.title, "Seed Microfinance Institution Vacancy 2026 – 2 Job Positions");
  assert.equal(result.company, "Seed Microfinance Institution S.C.");
  assert.equal(result.posted_time, "4 hours ago");
  assert.equal(result.employment_type, "Full-time");
  assert.equal(result.workplace_type, "On-site");
  assert.equal(result.location, "Addis Ababa, Ethiopia");
  assert.deepEqual(result.categories, [
    "Banking & Finance Jobs in Ethiopia",
    "IT & Software Development Jobs in Ethiopia",
  ]);
  assert.equal(result.categories.some((c) => /Accounting/i.test(c)), false);
  assert.equal(result.number_of_positions, 2);
  assert.equal(result.company_website, "https://seedmicrofinance.com/");
});

test("selects the employer logo from the job header and makes it absolute", () => {
  const result = record(RICH_PAGE);
  assert.deepEqual(result.logo, {
    url: "https://etcareers.com/images/seed-logo.png",
    alt: "Seed Microfinance Institution S.C. logo",
    source: "job_header",
  });
  assert.equal(result.extraction_quality.logo_verified, true);
  assert.equal(result.confidence.logo, 0.96);
});

test("removes ads, promotions, related jobs and footer from the description", () => {
  const result = record(RICH_PAGE);
  for (const noise of [
    "BUY MAPS", "Job search subscription", "Join ETcareers", "Telegram",
    "More jobs", "Addis Ababa City Administration", "CBE Job Vacancy",
    "Accounting & Auditing", "© 2026",
  ]) {
    assert.equal(result.description.includes(noise), false, `description leaked: ${noise}`);
  }
  assert.match(result.description, /The institution is recruiting qualified applicants/);
  assert.match(result.description, /Duty Station: Head Office, Addis Ababa/);
  assert.deepEqual(result.responsibilities, ["Prepare monthly financial reports", "Support internal audits"]);
  assert.deepEqual(result.qualifications, ["Degree in Accounting"]);
  assert.deepEqual(result.experience_requirements, ["Two years relevant experience"]);
  assert.deepEqual(result.skills, ["Excel"]);
  assert.equal(result.deadline, "November 30, 2026");
  assert.equal(result.salary, null);
  assert.equal(result.extraction_quality.job_content_verified, true);
  assert.equal(result.extraction_quality.advertisements_removed, true);
  assert.equal(result.extraction_quality.footer_removed, true);
  assert.equal(result.extraction_quality.related_jobs_removed, true);
});

test("email + physical job keeps application_url null and keeps real instructions", () => {
  const result = record(RICH_PAGE);
  assert.deepEqual(result.application.method, ["email", "physical"]);
  assert.deepEqual(result.application.emails, [
    "seedmicrofinanceinstitution@gmail.com",
    "alemayehugebreab8@gmail.com",
  ]);
  assert.equal(result.application.apply_button_text, "Apply now");
  assert.equal(result.application.apply_button_url, "mailto:seedmicrofinanceinstitution@gmail.com");
  assert.equal(result.application.application_url, null);
  assert.equal(result.application.final_application_url, "");
  assert.equal(result.application.application_url_verified, false);
  assert.match(result.application.instructions, /application letter and updated CV/);
  assert.match(result.application.physical_address, /Degol Building, 4th Floor/);
  assert.equal(result.application.physical_address.includes("etcareers.com"), false);
  assert.equal(result.confidence.application_url, 0);
});

const ATS_URL = "https://ilri.bamboohr.com/careers/51";
const WRAPPED_ATS_URL = `https://track.example.com/away?url=${encodeURIComponent(ATS_URL)}`;
const ATS_PAGE = page(`
<main>
  <div class="job-header">
    <img alt="International Livestock Research Institute logo" src="/logos/ilri.png">
    <h1>Senior Researcher</h1>
    <a href="https://www.ilri.org/">International Livestock Research Institute</a>
    <p>Posted 1 day ago</p>
  </div>
  <div class="rich-text">
    <p>Research duties and responsibilities for the role.</p>
    <a id="apply-btn" data-action="click->job#onApply" href="${WRAPPED_ATS_URL}">Apply now</a>
    <h2>How to Apply</h2>
    <p>Use the official application link above.</p>
  </div>
</main>
`, { url: "https://etcareers.com/jobs/senior-researcher-112105a7" });

test("decodes a wrapped Apply now href and records the real ATS destination", () => {
  const result = record(
    ATS_PAGE,
    "https://etcareers.com/jobs/senior-researcher-112105a7",
    { url: WRAPPED_ATS_URL, finalUrl: ATS_URL, verified: true }
  );
  assert.equal(result.application.apply_button_url, WRAPPED_ATS_URL);
  assert.equal(result.application.application_url, ATS_URL);
  assert.equal(result.application.final_application_url, ATS_URL);
  assert.equal(result.application.application_url_verified, true);
  assert.deepEqual(result.application.method, ["online"]);
  assert.equal(result.extraction_quality.application_url_verified, true);
  assert.equal(result.confidence.application_url, 0.99);
});

const JS_BUTTON_PAGE = page(`
<main>
  <div class="job-header">
    <h1>Programme Officer</h1>
    <a href="https://example.org/employer">Example Employer</a>
  </div>
  <div class="job-detail">
    <p>Programme delivery duties, reporting and stakeholder coordination.</p>
    <button class="apply" data-href="https://forms.example.com/apply/77">Apply now</button>
  </div>
</main>
`, { url: "https://etcareers.com/jobs/programme-officer-a1b2c3d4" });

test("uses a JavaScript/data-href Apply button when there is no anchor href", () => {
  const result = record(JS_BUTTON_PAGE, "https://etcareers.com/jobs/programme-officer-a1b2c3d4");
  assert.equal(result.application.apply_button_text, "Apply now");
  assert.equal(result.application.apply_button_url, "https://forms.example.com/apply/77");
  assert.equal(result.application.application_url, "https://forms.example.com/apply/77");
  assert.deepEqual(result.application.method, ["online"]);
});

const PHYSICAL_PAGE = page(`
<main>
  <div class="job-header">
    <h1>Branch Cashier</h1>
    <a href="/employers/sample-bank">Sample Bank</a>
  </div>
  <div class="rich-text">
    <p>Handle teller duties and daily branch reconciliation.</p>
    <h2>How to Apply</h2>
    <p>Submit a printed application letter and CV in person.</p>
    <p>Physical Address: Sample Bank Headquarters, Meskel Square, Addis Ababa, Ethiopia</p>
  </div>
</main>
`, { url: "https://etcareers.com/jobs/branch-cashier-1a2b3c4d" });

test("physical-only application never uses the ETcareers source URL", () => {
  const result = record(PHYSICAL_PAGE, "https://etcareers.com/jobs/branch-cashier-1a2b3c4d");
  assert.deepEqual(result.application.method, ["physical"]);
  assert.equal(result.application.application_url, null);
  assert.equal(result.application.apply_button_url, "");
  assert.match(result.application.physical_address, /Meskel Square/);
  assert.equal(result.description.includes("etcareers.com"), false);
});

const MULTI_POSITION_PAGE = page(`
<main>
  <div class="job-header">
    <h1>Seed Microfinance Institution Vacancy 2026 – 2 Job Positions</h1>
    <a href="https://seedmicrofinance.com/">Seed Microfinance Institution S.C.</a>
  </div>
  <div class="rich-text">
    <p>Applications are invited from qualified applicants.</p>
    <h2>Available Job Positions</h2>
    <p>1. MIS/IT Officer-II</p>
    <p>Educational Qualification: BSc in Information Technology</p>
    <p>Work Experience: Two years relevant experience</p>
    <p>2. MIS/IT Senior Officer</p>
    <p>Educational Qualification: MSc in Information Systems</p>
    <p>Work Experience: Five years relevant experience</p>
    <h2>How to Apply</h2>
    <p>Apply by email to jobs@example.org.</p>
  </div>
</main>
`, { url: DETAIL_URL });

test("preserves multiple positions without merging their requirements", () => {
  const result = record(MULTI_POSITION_PAGE);
  assert.equal(result.number_of_positions, 2);
  assert.equal(result.positions.length, 2);
  assert.deepEqual(result.positions.map((p) => p.title), ["MIS/IT Officer-II", "MIS/IT Senior Officer"]);
  assert.equal(result.positions[0].education, "BSc in Information Technology");
  assert.equal(result.positions[1].education, "MSc in Information Systems");
  assert.match(result.positions[0].experience, /Two years/);
  assert.match(result.positions[1].experience, /Five years/);
});

const AD_ONLY_PAGE = page(`
<main>
  <div class="job-header">
    <img alt="Buy Maps" src="/ads/buy-maps.png">
    <h1>Data Officer</h1>
    <a href="https://example.org/data-employer">Data Employer</a>
  </div>
  <div class="rich-text">
    <p>Collect and clean programme data for the monitoring team.</p>
    <a href="https://t.me/Etcareersjobs">Join ETcareers on Telegram</a>
  </div>
</main>
`, {
  url: "https://etcareers.com/jobs/data-officer-9f8e7d6c",
  head: `<meta property="og:image" content="https://assets.jobboardly.com/site-preview.jpg">`,
});

test("never promotes an advertisement or site preview to the employer logo", () => {
  const result = record(AD_ONLY_PAGE, "https://etcareers.com/jobs/data-officer-9f8e7d6c");
  assert.equal(result.logo, null);
  assert.equal(result.extraction_quality.logo_verified, false);
  assert.equal(result.confidence.logo, 0);
  assert.equal(result.description.includes("Join ETcareers"), false);
});

test("engine resolution patches only the audited record", () => {
  const extracted = { title: "Senior Researcher", etcareersRecord: record(RICH_PAGE) };
  const patched = applyEtcareersResolution(extracted, {
    url: "https://track.example.com/away?url=x",
    finalUrl: "https://ats.example.com/apply/9",
    verified: true,
  });
  assert.equal(patched.title, "Senior Researcher");
  assert.equal(patched.etcareersRecord.application.final_application_url, "https://ats.example.com/apply/9");
  assert.equal(patched.etcareersRecord.application.application_url, "https://ats.example.com/apply/9");
  assert.equal(patched.etcareersRecord.application.application_url_verified, true);
  assert.equal(patched.etcareersRecord.extraction_quality.application_url_verified, true);
  assert.ok(patched.etcareersRecord.confidence.application_url >= 0.82);
});

// Mirrors the real ETcareers detail layout: logo beside the h1, body in
// .rich-text, and the real CTA in a sticky sidebar AFTER the body.
const LIVE_SHAPE_PAGE = page(`
<main>
  <div class="grid md:grid-cols-12 items-start gap-6">
    <div class="md:col-span-9">
      <div class="flex flex-col md:flex-row items-start gap-5">
        <div class="flex-shrink-0 rounded-lg bg-white overflow-hidden">
          <img class="h-full w-full object-contain" alt="Benchline Reports logo" loading="lazy" width="64" height="64"
               src="https://assets.jobboardly.com/rails/active_storage/representations/proxy/abc123/benchlinereports.com.png">
        </div>
        <div class="w-full">
          <div>
            <h1>Senior Researcher</h1>
            <a target="_blank" rel="noopener noreferrer" href="https://benchlinereports.com/">Benchline Reports</a>
          </div>
          <div>
            <div id="job-posted-at">7 days ago</div>
            <div>Consultant Jobs in Ethiopia, Research Jobs in Ethiopia</div>
          </div>
        </div>
      </div>
      <div class="mt-12 rich-text">
        <p>Benchline Reports is seeking an experienced Senior Researcher.</p>
        <h2>Qualifications and Requirements</h2>
        <ul><li>Minimum of 5 years of experience in market research.</li></ul>
        <h2>How to Apply</h2>
        <p>Interested candidates should submit their applications via email.</p>
        <p><strong>Email:</strong> hiring@benchlinereports.com</p>
        <p><strong>Company Website:</strong> <a href="https://benchlinereports.com/">https://benchlinereports.com/</a></p>
        <p><strong>Office Address:</strong> 30 Hudson Yards, New York, USA.</p>
        <p>📲 <strong>Join <a href="https://t.me/Etcareersjobs">@Etcareersjobs</a> for Daily Job Updates &amp; Share with Friends.</strong></p>
      </div>
    </div>
    <div class="md:col-span-3 rounded-xl md:sticky top-6 p-4">
      <a class="inline-flex" id="apply-btn" data-action="click-&gt;job#onApply" href="mailto:hiring@benchlinereports.com">Apply now</a>
    </div>
  </div>
</main>
`, {
  head: `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Senior Researcher",
    hiringOrganization: {
      "@type": "Organization",
      name: "Benchline Reports",
      sameAs: "https://benchlinereports.com/",
      logo: "https://cdn.jobboardly.com/bpypanjodzse7shilcyuh585ofrg",
    },
    validThrough: "2026-12-15T08:20:15-06:00",
  })}</script>`,
});

test("live ETcareers layout: sidebar CTA, header logo, email-only URL, clean promo", () => {
  const result = record(LIVE_SHAPE_PAGE, "https://etcareers.com/jobs/senior-researcher-112105a7");
  assert.equal(result.title, "Senior Researcher");
  assert.equal(result.company, "Benchline Reports");
  // The visible header image wins over the JSON-LD board CDN logo.
  assert.equal(result.logo.source, "job_header");
  assert.match(result.logo.url, /benchlinereports\.com\.png$/);
  assert.equal(result.company_website, "https://benchlinereports.com/");
  // The CTA is outside .rich-text but is still the legitimate primary button.
  assert.equal(result.application.apply_button_text, "Apply now");
  assert.equal(result.application.apply_button_url, "mailto:hiring@benchlinereports.com");
  assert.deepEqual(result.application.method, ["email"]);
  assert.equal(result.application.application_url, null);
  assert.equal(result.application.final_application_url, "");
  assert.deepEqual(result.application.emails, ["hiring@benchlinereports.com"]);
  // "Company Website:" must never become the application URL.
  assert.equal(result.application.instructions.includes("https://benchlinereports.com/"), true);
  for (const noise of ["Join for", "Share with Friends", "📲", "Etcareersjobs", "t.me"]) {
    assert.equal(result.description.includes(noise), false, `description leaked: ${noise}`);
    assert.equal(result.application.instructions.includes(noise), false, `instructions leaked: ${noise}`);
  }
});
