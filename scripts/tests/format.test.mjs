// Unit tests for the structured job-post formatter.
//
// The formatter rebuilds a syndicated announcement into the sections a
// reader expects, without inventing content the employer did not write.

import assert from "node:assert/strict";
import { test } from "node:test";

import { formatJobSections } from "../../lib/jobs/format.mjs";

test("a heading followed by bullets becomes its own section", () => {
  const sections = formatJobSections(
    "Job Summary We are looking for a nurse to join our team. " +
    "Educational Qualifications • BA/BSc. Degree in Nursing. " +
    "Work Experience • 5 years of relevant experience. " +
    "Place of Work • Addis Ababa."
  );
  assert.deepEqual(sections.map((s) => s.key), ["summary", "requirements", "experience", "location"]);
  assert.equal(sections[0].title, "Job Summary");
  assert.equal(sections[1].items.length, 1);
  assert.equal(sections[1].items[0], "BA/BSc. Degree in Nursing.");
  assert.equal(sections[3].items[0], "Addis Ababa.");
});

test("a heading inside a bullet item keeps the item's own words", () => {
  const sections = formatJobSections(
    "• Proficient in written English) Desirable qualifications, skills and experience: " +
    "• Strong analytical skills."
  );
  const experience = sections.find((s) => s.key === "requirements");
  assert.ok(experience, "a requirements section is produced");
  assert.equal(
    experience.items.some((i) => i.includes("Proficient in written English")),
    true,
    "the text before the heading stays with its bullet"
  );
});

test("a heading is not detected in the middle of a word", () => {
  const sections = formatJobSections(
    "We need someone with 7 years of relevant work experience. Apply today."
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].key, "summary");
  assert.equal(sections[0].items.length, 0);
});

test("ordinary wording that names a section is left alone", () => {
  const sections = formatJobSections(
    "The role requires strong communication skills across every team."
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].items.length, 0);
});

test("bullets without any heading become a list section", () => {
  const sections = formatJobSections(
    "Main purpose of job: The adviser will deliver programmes. " +
    "• Provide strategic advice to teams. • Drive delivery of commitments."
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].items.length, 2);
  assert.equal(sections[0].items[0], "Provide strategic advice to teams.");
  // The lead-in sentence is kept as the section's paragraph.
  assert.match(sections[0].paragraphs.join(" "), /Main purpose of job/);
});

test("numbered items are kept as a numbered list", () => {
  const sections = formatJobSections("1. First duty 2. Second duty 3. Third duty");
  assert.equal(sections[0].type, "list");
  assert.equal(sections[0].items.length, 3);
  assert.equal(sections[0].items[0], "First duty");
});

test("the employer's own heading wording is kept", () => {
  const sections = formatJobSections("Educational Qualifications • Degree in Nursing.");
  assert.equal(sections[0].title, "Educational Qualifications");
});

test("the section order is the reading order of a job post", () => {
  const sections = formatJobSections(
    "How to Apply Send your CV to the address below. " +
    "Job Summary We need a nurse. " +
    "Responsibilities • Provide care. " +
    "Requirements • Degree in Nursing."
  );
  assert.deepEqual(sections.map((s) => s.key), [
    "summary",
    "responsibilities",
    "requirements",
    "howToApply",
  ]);
});

test("a separate requirements column becomes the requirements section", () => {
  const sections = formatJobSections("About the role We need a nurse.", {
    requirements: "BA/BSc. Degree in Nursing.",
  });
  const requirements = sections.find((s) => s.key === "requirements");
  assert.ok(requirements);
  assert.equal(requirements.paragraphs.join(" "), "BA/BSc. Degree in Nursing.");
});

test("an empty announcement produces no sections", () => {
  assert.deepEqual(formatJobSections(""), []);
  assert.deepEqual(formatJobSections(null), []);
  assert.deepEqual(formatJobSections("   "), []);
});

test("a heading alone still produces its section", () => {
  const sections = formatJobSections("Benefits");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].key, "benefits");
});
