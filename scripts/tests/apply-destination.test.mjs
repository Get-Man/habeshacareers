// Unit tests for the application-destination classifier.
//
// The rule under test: every vacancy ends up with ONE visible Apply Now
// button, and the reader is told whether it goes to the employer's own site
// or to a third party.

import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyApplyDestination } from "../../lib/jobs/apply-destination.mjs";

test("a link on the employer's own domain is an official link", () => {
  const result = classifyApplyDestination({
    applyUrl: "https://www.ethiopianairlines.com/careers/apply",
    employerDomain: "ethiopianairlines.com",
  });
  assert.equal(result.kind, "official_employer");
  assert.equal(result.official, true);
  assert.equal(result.url, "https://www.ethiopianairlines.com/careers/apply");
});

test("a subdomain of the employer's domain is still official", () => {
  const result = classifyApplyDestination({
    applyUrl: "https://careers.example.et/jobs/42",
    employerDomain: "example.et",
  });
  assert.equal(result.kind, "official_employer");
});

test("an ATS portal is the employer's own recruitment flow", () => {
  const result = classifyApplyDestination({
    applyUrl: "https://boards.greenhouse.io/acmejobs/jobs/1",
  });
  assert.equal(result.kind, "official_ats");
  assert.equal(result.official, true);
});

test("a form service is described honestly as third party", () => {
  const result = classifyApplyDestination({
    applyUrl: "https://docs.google.com/forms/d/e/abc/viewform",
  });
  assert.equal(result.kind, "third_party");
  assert.equal(result.official, false);
});

test("an application mailbox is used when there is no link", () => {
  const result = classifyApplyDestination({
    applicationEmail: "hr@example.et",
  });
  assert.equal(result.kind, "email");
  assert.equal(result.url, "mailto:hr@example.et");
  assert.equal(result.official, true);
});

test("the employer's careers page is the fallback when nothing else exists", () => {
  const result = classifyApplyDestination({
    careersUrl: "https://example.et/careers",
  });
  assert.equal(result.kind, "employer_careers");
  assert.equal(result.url, "https://example.et/careers");
  assert.equal(result.official, true);
});

test("the employer's own website is the last resort", () => {
  const result = classifyApplyDestination({
    employerWebsite: "https://example.et",
  });
  assert.equal(result.kind, "employer_careers");
  assert.equal(result.url, "https://example.et");
});

test("every result carries a button label", () => {
  const inputs = [
    { applyUrl: "https://example.et/apply" },
    { applyUrl: "https://boards.greenhouse.io/x/jobs/1" },
    { applyUrl: "https://t.me/somechannel" },
    { applicationEmail: "jobs@example.et" },
    { careersUrl: "https://example.et/careers" },
    {},
  ];
  for (const input of inputs) {
    const result = classifyApplyDestination(input);
    assert.equal(result.buttonLabel, "Apply Now");
    assert.ok(result.note.length > 0);
  }
});

test("a mailto apply URL is treated as an email application", () => {
  const result = classifyApplyDestination({
    applyUrl: "mailto:hr@example.et?subject=Job",
  });
  assert.equal(result.kind, "email");
});
