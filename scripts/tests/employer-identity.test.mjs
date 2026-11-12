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
