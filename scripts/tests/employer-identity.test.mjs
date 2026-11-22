// Unit tests for employer identity inference.
//
// The hosting site is never the employer: a discovery source's domain must
// never be accepted as the organisation's own website.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  careersUrlCandidates,
  domainFromEmployerName,
  inferEmployerDomain,
  usableEmployerDomain,
} from "../../lib/jobs/employer-identity.mjs";
import { publicLogo } from "../../lib/jobs/repository.mjs";

test("a discovery source's domain is never an employer website", () => {
  assert.equal(usableEmployerDomain("geezjobs.com"), null);
  assert.equal(usableEmployerDomain("ethiojobs.net"), null);
  assert.equal(usableEmployerDomain("www.reliefweb.int"), null);
});

test("a generic service is never an employer website", () => {
  assert.equal(usableEmployerDomain("forms.gle"), null);
  assert.equal(usableEmployerDomain("docs.google.com"), null);
  assert.equal(usableEmployerDomain("gmail.com"), null);
  assert.equal(usableEmployerDomain("t.me"), null);
});

test("the organisation's own domain is accepted", () => {
  assert.equal(usableEmployerDomain("www.example.et"), "example.et");
});

test("the application URL reveals the employer's own site", () => {
  const result = inferEmployerDomain({
    company: "Awash Insurance Company",
    applyUrl: "https://careers.awashinsurance.com/jobs/12",
  });
  assert.equal(result.domain, "awashinsurance.com");
  assert.equal(result.source, "apply_url");
});

test("a board-hosted application URL does not reveal the employer", () => {
  const result = inferEmployerDomain({
    company: "Kalkidan Trading PLC",
    applyUrl: "https://geezjobs.com/jobs/12",
  });
  assert.equal(result.domain, null);
});

test("a board-hosted application URL still allows a known organisation", () => {
  const result = inferEmployerDomain({
    company: "Awash Insurance Company",
    applyUrl: "https://geezjobs.com/jobs/12",
  });
  // The domain comes from the organisation's identity, never from the board.
  assert.equal(result.source, "known_employer");
  assert.equal(result.domain, "awashinsurance.com");
});

test("the application mailbox reveals the employer's own site", () => {
  const result = inferEmployerDomain({
    company: "Some Company",
    email: "hr@somecompany.et",
  });
  assert.equal(result.domain, "somecompany.et");
  assert.equal(result.source, "application_email");
});

test("a free mailbox reveals nothing", () => {
  const result = inferEmployerDomain({
    company: "Some Company",
    email: "someone@gmail.com",
  });
  assert.equal(result.domain, null);
});

test("a tender portal or forwarding mailbox is never the employer's website", () => {
  const tender = inferEmployerDomain({
    company: "Welthungerhilfe",
    applyUrl: "https://eu.eu-supply.com/ctm/supplier/publictenders",
  });
  assert.equal(tender.source, "known_employer");
  assert.equal(tender.domain, "welthungerhilfe.org");

  const mailbox = inferEmployerDomain({
    company: "Patchee Food Manufacturing PLC",
    email: "hr.patchee@atomicmail.io",
  });
  assert.equal(mailbox.domain, null);
});

test("a recruitment platform host is not an employer website", () => {
  assert.equal(usableEmployerDomain("myworkdayjobs.com"), null);
  assert.equal(usableEmployerDomain("greenhouse.io"), null);
  assert.equal(usableEmployerDomain("career55.sapsf.eu"), null);
  assert.equal(usableEmployerDomain("dashenbank.com"), "dashenbank.com");
});

test("a well-known organisation is recognised by name", () => {
  assert.equal(domainFromEmployerName("World Vision Ethiopia"), "worldvision.org");
  assert.equal(domainFromEmployerName("Ethiopian Airlines"), "ethiopianairlines.com");
  assert.equal(domainFromEmployerName("UNICEF Ethiopia"), "unicef.org");
});

test("a link inside the announcement reveals the employer's site", () => {
  const result = inferEmployerDomain({
    company: "Some Company",
    description: "Interested candidates should apply. Visit https://www.somecompany.et/jobs for details.",
  });
  assert.equal(result.domain, "somecompany.et");
  assert.equal(result.source, "announcement_link");
});

test("a job-board link inside the announcement is ignored", () => {
  const result = inferEmployerDomain({
    company: "Some Company",
    description: "Apply at https://www.ethiojobs.net/vacancy/9 or https://t.me/xyz",
  });
  assert.equal(result.domain, null);
});

test("the careers page candidates start with the conventional paths", () => {
  const candidates = careersUrlCandidates("example.et");
  assert.equal(candidates[0], "https://example.et/careers");
  assert.ok(candidates.includes("https://example.et/jobs"));
  assert.ok(candidates.length > 3);
});

test("third-party platform branding is never a public employer logo", () => {
  assert.equal(
    publicLogo({
      employer_logo_url:
        "https://www.google.com/images/branding/google_wordmark/v1/1x/googlelogo_color_white_background_272x92dp.png",
    }),
    null
  );
  assert.equal(
    publicLogo({ organization_logo_url: "https://www.gstatic.com/images/branding/googlelogo.png" }),
    null
  );
  assert.equal(
    publicLogo({ employer_logo_url: "https://cdn.example.et/logo.png" }),
    "https://cdn.example.et/logo.png"
  );
});

test("an ATS/platform favicon is never an employer logo", () => {
  assert.equal(
    publicLogo({
      employer_logo_url: "https://www.google.com/s2/favicons?domain=sapsf.eu&sz=128",
    }),
    null
  );
  assert.equal(
    publicLogo({
      organization_logo_url: "https://boards.greenhouse.io/acme/logo.png",
    }),
    null
  );
  // A real employer logo on its own domain is still accepted.
  assert.equal(
    publicLogo({ logo: "https://dashenbank.com/logo.png" }),
    "https://dashenbank.com/logo.png"
  );
});

test("a rejected directory logo falls back to a valid employer listing logo", () => {
  assert.equal(
    publicLogo({
      employer_logo_url:
        "https://www.google.com/s2/favicons?domain=etcareers.com&sz=128",
      organization_logo_url: "https://cdn.example.et/logo.png",
    }),
    "https://cdn.example.et/logo.png"
  );
});
