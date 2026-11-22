// Embeddable ETcareers card tests — pure, offline and network-stubbed.
// These pin the "employer vacancy only" output, tracking-free apply URL,
// mailto support and all three logo resolver steps.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildPreviewHtml,
  extractEtcareersCard,
  resolve_org_logo,
  sanitizeCardDescription,
} from "../etcareers-embed.mjs";

const PAGE_URL = "https://etcareers.com/jobs/test-bank-vacancy-f7206e1b";

function svgDownload(width = 64, height = 64) {
  const bytes = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="M0 0h${width}v${height}H0z" fill="#0f766e"/></svg>`
  );
  return { ok: true, contentType: "image/svg+xml", bytes };
}

function tempAssets() {
  return mkdtempSync(path.join(tmpdir(), "etcareers-embed-"));
}

const HEADER_CARD = `<html><body>
<img id="board-logo" alt="Etcareers.com logo" src="https://etcareers.com/logo.png">
<nav>ETcareers navigation</nav>
<main>
  <div class="grid md:grid-cols-12">
    <div class="md:col-span-9">
      <div class="flex items-start gap-5">
        <div class="flex-shrink-0"><img alt="Test Bank S.C logo" width="64" height="64" src="/uploads/testbank.png"></div>
        <div><h1>Test Bank S.C Job Vacancy 2026</h1><a href="/jobs/test-bank-vacancy-f7206e1b">Test Bank S.C</a></div>
      </div>
      <div id="job-posted-at">1 day ago</div>
    </div>
    <div>
      <a id="apply-btn" data-action="click-&gt;jobs#onApply" href="https://forms.gle/abc123?utm_source=Etcareers.com&amp;utm_id=42">Apply now</a>
    </div>
  </div>
  <div class="mt-12 rich-text">
    <h2>About the role</h2>
    <p><strong>Apply online:</strong> <a href="https://forms.gle/abc123">Application form</a></p>
    <p><a href="/jobs/other-vacancy">Internal job link</a></p>
    <script>var TELEGRAM_URL = 'https://t.me/+123';</script>
    <div class="telegram-promo">Join ETcareers on Telegram</div>
  </div>
  <div id="similar-jobs"><h2>More jobs</h2><a href="/jobs/other">Other job</a></div>
  <footer>ETcareers footer</footer>
</main></body></html>`;

test("extracts only the card fields, unwraps internal links and cleans the apply URL", async () => {
  const assetsDir = tempAssets();
  try {
    const record = await extractEtcareersCard(PAGE_URL, {
      html: HEADER_CARD,
      quiet: true,
      allowGlobalSearch: false,
      assetsDir,
      downloadImage: async () => svgDownload(),
    });

    assert.equal(record.title, "Test Bank S.C Job Vacancy 2026");
    assert.equal(record.org_name, "Test Bank S.C");
    assert.equal(record.logo_source, "etcareers");
    assert.ok(record.logo_local_path.replace(/\\/g, "/").endsWith("/test-bank-s-c.svg"));
    assert.ok(readFileSync(path.join(assetsDir, "test-bank-s-c.svg")).length > 0);

    assert.equal(record.direct_apply_url, "https://forms.gle/abc123");
    assert.equal(
      record.apply_button_html,
      '<a href="https://forms.gle/abc123" target="_blank" rel="noopener noreferrer" class="apply-now-btn">Apply Now</a>'
    );

    assert.match(record.description_html, /<h2>About the role<\/h2>/);
    assert.match(record.description_html, /<strong>Apply online:<\/strong>/);
    assert.match(record.description_html, /<a href="https:\/\/forms\.gle\/abc123">Application form<\/a>/);
    assert.doesNotMatch(record.description_html, /<a href="\/jobs\/other-vacancy">/);
    assert.doesNotMatch(record.description_html, /etcareers\.com|telegram|TELEGRAM_URL|similar-jobs|More jobs|ETcareers navigation|ETcareers footer/i);

    const preview = buildPreviewHtml(record);
    assert.match(preview, /class="job-card"/);
    assert.match(preview, /class="apply-now-btn"/);
    assert.doesNotMatch(preview, /board-logo|similar-jobs|ETcareers navigation/i);
  } finally {
    rmSync(assetsDir, { recursive: true, force: true });
  }
});

const MAILTO_CARD = `<html><body><main>
  <div><div><div><h1>Research Assistant</h1><a href="/jobs/research-assistant">Benchline Reports</a></div></div></div>
  <div class="rich-text"><p>Apply by email to <a href="mailto:hiring@example.com">hiring@example.com</a>.</p></div>
  <a id="apply-btn" data-action="click-&gt;job#onApply" href="mailto:hiring@example.com">Apply now</a>
</main></body></html>`;

test("keeps a real mailto destination in the embeddable card", async () => {
  const record = await extractEtcareersCard(PAGE_URL, {
    html: MAILTO_CARD,
    quiet: true,
    allowGlobalSearch: false,
  });
  assert.equal(record.direct_apply_url, "mailto:hiring@example.com");
  assert.equal(
    record.apply_button_html,
    '<a href="mailto:hiring@example.com" target="_blank" rel="noopener noreferrer" class="apply-now-btn">Apply Now</a>'
  );
  assert.equal(record.logo_source, "none");
  assert.equal(record.logo_local_path, null);
});

const LETTER_AVATAR_CARD = `<html><body><main>
  <div class="md:col-span-9">
    <div class="flex items-start gap-5">
      <div class="flex-shrink-0 h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center"><span>Z</span></div>
      <div><h1>ZamZam Bank Vacancy</h1><a href="/jobs/zamzam">ZamZam Bank S.C</a></div>
    </div>
  </div>
  <div class="rich-text"><p>Employer vacancy content.</p></div>
  <a id="apply-btn" href="https://zamzambank.com/careers">Apply now</a>
</main></body></html>`;

test("rejects a letter avatar and resolves a verified logo via global search", async () => {
  const assetsDir = tempAssets();
  try {
    let searched = "";
    const record = await extractEtcareersCard("https://etcareers.com/jobs/zamzam", {
      html: LETTER_AVATAR_CARD,
      quiet: true,
      assetsDir,
      searchImages: async (query) => {
        searched = query;
        return [{
          title: "ZamZam Bank official logo",
          imageUrl: "https://cdn.example.com/zamzam-logo.png",
          pageUrl: "https://zamzambank.com/",
          width: 512,
          height: 512,
        }];
      },
      downloadImage: async () => svgDownload(512, 512),
    });

    assert.equal(searched, "ZamZam Bank S.C Ethiopia official logo png");
    assert.equal(record.logo_source, "global_search");
    assert.ok(record.logo_local_path.endsWith("/zamzam-bank-s-c.svg") || record.logo_local_path.endsWith("\\zamzam-bank-s-c.svg"));
    assert.ok(readFileSync(path.join(assetsDir, "zamzam-bank-s-c.svg")).length > 0);
  } finally {
    rmSync(assetsDir, { recursive: true, force: true });
  }
});

test("resolve_org_logo returns none instead of inventing a logo when all steps fail", async () => {
  const result = await resolve_org_logo("No Logo Org", "<html><body><h1>Job</h1></body></html>", PAGE_URL, {
    quiet: true,
    searchImages: async () => [],
    allowGlobalSearch: true,
    domains: [],
  });
  assert.deepEqual(result, {
    logo_url: null,
    logo_source: "none",
    logo_local_path: null,
    logo_width: 0,
    logo_height: 0,
  });
});

test("sanitizeCardDescription detaches internal links without losing employer words", () => {
  const diag = { add() {} };
  const cleaned = sanitizeCardDescription(
    '<p>Read <a href="/jobs/x">the job detail</a> at <a href="https://etcareers.com/jobs/x">ETcareers</a>.</p>' +
      '<a href="https://forms.gle/ok">Apply</a>',
    PAGE_URL,
    diag
  );
  assert.match(cleaned, /Read the job detail at ETcareers\./);
  assert.doesNotMatch(cleaned, /href="(?:\/jobs|https:\/\/etcareers\.com)/);
  assert.match(cleaned, /<a href="https:\/\/forms\.gle\/ok">Apply<\/a>/);
});

test("sanitizeCardDescription removes the ETcareers Telegram promo footer", () => {
  const employer =
    "<p>The employer invites qualified applicants to apply.</p>" +
    "<p>Application Deadline: November 15, 2026</p>";
  const promos = [
    '<p>📲 <strong>Join @Etcareersjobs for Daily Job Updates &amp; Share with Friends:</strong> <a href="https://t.me/Etcareersjobs">https://t.me/Etcareersjobs</a></p></p>',
    '<p>📲 <strong>Join on Telegram for Daily Job Updates &amp; Share with Friends:</strong></p><p><a href="https://t.me/Etcareersjobs">https://t.me/Etcareersjobs</a></p></p>',
  ];
  for (const promo of promos) {
    const cleaned = sanitizeCardDescription(employer + "<br /><hr>" + promo, PAGE_URL, { add() {} });
    assert.match(cleaned, /The employer invites qualified applicants to apply\./);
    assert.match(cleaned, /Application Deadline: November 15, 2026/);
    assert.doesNotMatch(cleaned, /Etcareersjobs|Daily Job Updates|Share with Friends|t\.me|Telegram/i, cleaned);
  }
});
