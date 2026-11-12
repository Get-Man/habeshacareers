// Structured job-post formatting.
//
// A vacancy announcement is published by the employer, but the way it is
// syndicated loses its layout: section headings run into the sentence before
// them ("...quality customer service. Educational Qualifications") and
// bullet items are glued to the same line ("Work Experience • 7 years of
// relevant work experience").
//
// This module rebuilds that announcement into the sections a reader expects
// on a professional job post: summary, responsibilities, requirements,
// experience, benefits, location, salary, employment type, how to apply and
// any additional information.
//
// It is deliberately conservative: the employer's wording and order are
// preserved, only the structure is recovered. A section is never invented
// that the announcement does not contain.

import { collapseWhitespace } from "./extract/html.mjs";

export const JOB_SECTION_LABELS = {
  summary: "Job Summary",
  responsibilities: "Responsibilities",
  requirements: "Requirements & Qualifications",
  experience: "Experience",
  benefits: "Benefits",
  location: "Location",
  salary: "Salary",
  employmentType: "Employment Type",
  howToApply: "How to Apply",
  other: "Additional Information",
};

// The canonical reading order of a job post.
const SECTION_ORDER = [
  "summary",
  "responsibilities",
  "requirements",
  "experience",
  "benefits",
  "location",
  "salary",
  "employmentType",
  "howToApply",
  "other",
];

// Headings an employer announcement commonly uses, mapped to a section key.
const HEADING_ALIASES = [
  ["job summary", "summary"],
  ["position summary", "summary"],
  ["role summary", "summary"],
  ["job overview", "summary"],
  ["about the role", "summary"],
  ["about the job", "summary"],
  ["about the position", "summary"],
  ["about this position", "summary"],
  ["overview", "summary"],
  ["summary", "summary"],

  ["main responsibilities", "responsibilities"],
  ["key responsibilities", "responsibilities"],
  ["core responsibilities", "responsibilities"],
  ["responsibilities and duties", "responsibilities"],
  ["duties and responsibilities", "responsibilities"],
  ["job responsibilities", "responsibilities"],
  ["main duties", "responsibilities"],
  ["key duties", "responsibilities"],
  ["responsibilities", "responsibilities"],
  ["duties", "responsibilities"],
  ["job description", "responsibilities"],
  ["job functions", "responsibilities"],
  ["description", "responsibilities"],
  ["tasks", "responsibilities"],

  ["educational qualifications", "requirements"],
  ["education and experience", "requirements"],
  ["experience and education", "requirements"],
  ["qualifications and requirements", "requirements"],
  ["required qualifications", "requirements"],
  ["essential qualifications", "requirements"],
  ["desired qualifications", "requirements"],
  ["desirable qualifications", "requirements"],
  ["minimum requirements", "requirements"],
  ["candidate profile", "requirements"],
  ["candidate requirements", "requirements"],
  ["person specification", "requirements"],
  ["educational requirements", "requirements"],
  ["academic qualifications", "requirements"],
  ["required skills", "requirements"],
  ["skills and competencies", "requirements"],
  ["qualifications", "requirements"],
  ["requirements", "requirements"],

  ["work experience", "experience"],
  ["relevant experience", "experience"],
  ["professional experience", "experience"],
  ["employment history", "experience"],
  ["experience", "experience"],

  ["what we offer you", "benefits"],
  ["what we offer", "benefits"],
  ["benefits and perks", "benefits"],
  ["perks and benefits", "benefits"],
  ["benefits", "benefits"],

  ["place of work", "location"],
  ["work place", "location"],
  ["duty station", "location"],
  ["job location", "location"],
  ["location", "location"],

  ["salary and benefits", "salary"],
  ["salary range", "salary"],
  ["remuneration package", "salary"],
  ["salary", "salary"],

  ["contract type", "employmentType"],
  ["employment type", "employmentType"],
  ["nature of employment", "employmentType"],
  ["type of employment", "employmentType"],
  ["employment category", "employmentType"],
  ["job type", "employmentType"],

  ["how to apply for this job", "howToApply"],
  ["how to apply", "howToApply"],
  ["application procedure", "howToApply"],
  ["application process", "howToApply"],
  ["application instructions", "howToApply"],
  ["instructions to apply", "howToApply"],
  ["applying", "howToApply"],

  ["application closing date", "other"],
  ["application deadline", "other"],
  ["closing date", "other"],
  ["general information", "other"],
  ["additional information", "other"],
  ["important information", "other"],
  ["terms of service", "other"],
  ["terms and conditions", "other"],
  ["number of positions", "other"],
  ["duration of employment", "other"],
  ["reports to", "other"],
];

// Longest phrase first, so "educational qualifications" wins over
// "qualifications" and "main responsibilities" over "responsibilities".
const HEADING_LIST = [...HEADING_ALIASES].sort((a, b) => b[0].length - a[0].length);

const BULLET_CHARS = "•●▪◦*";

// A bullet marker starts a new line when it follows whitespace and is
// followed by whitespace. A hyphen inside a word ("Full-Time") is not a bullet.

/**
 * Locate every heading occurrence in the text.
 *
 * A heading must start the text, follow a bullet marker, or follow a
 * sentence boundary. It must end at a word boundary or a colon.
 */
function findHeadings(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [phrase, key] of HEADING_LIST) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(phrase, from);
      if (at === -1) break;
      from = at + phrase.length;
      const end = at + phrase.length;
      const after = end < text.length ? text[end] : "";

      // Look back over the whitespace to the character that really precedes
      // the heading, so "...service. Educational Qualifications" is seen as a
      // heading that follows a sentence, while "...relevant work experience"
      // is seen as ordinary wording.
      let i = at - 1;
      while (i >= 0 && /\s/.test(text[i])) i -= 1;
      const before = i >= 0 ? text[i] : "";

      // The heading must not begin in the middle of a word.
      if (before && /[a-z0-9]/i.test(before)) continue;
      // It must start the text, follow a bullet marker, or follow a
      // sentence boundary or closing punctuation.
      const startsClean =
        at === 0 ||
        BULLET_CHARS.includes(before) ||
        /[.!?;:\u2026)\]}"'\u2013\u2014]/.test(before);
      if (!startsClean) continue;
      // The character after the phrase must not be a word character.
      if (after && /[a-z0-9]/i.test(after)) continue;

      found.push({ start: at, end, key, phrase });
    }
  }
  // Earliest first; on a tie the longer phrase wins.
  found.sort((a, b) => (a.start - b.start) || (b.end - a.end) || (a.end - a.end));
  const kept = [];
  let lastEnd = -1;
  for (const h of found) {
    if (h.start < lastEnd) continue;
    kept.push(h);
    lastEnd = h.end;
  }
  return kept;
}

/**
 * Locate every bullet marker in the text.
 */
function findBullets(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (BULLET_CHARS.includes(ch)) {
      out.push({ start: i, end: i + 1, kind: "ul" });
      continue;
    }
    // A dash bullet: whitespace, dash, whitespace.
    if ((ch === "-" || ch === "\u2013" || ch === "\u2014") && /\s/.test(text[i - 1] || " ") && /\s/.test(text[i + 1] || " ")) {
      out.push({ start: i, end: i + 1, kind: "ul" });
      continue;
    }
    // A numbered bullet: "1." or "1)" followed by whitespace. The marker is
    // part of the marker, not of the item text.
    const numbered = /^(\d{1,3})[.)](?=\s)/.exec(text.slice(i));
    if (numbered && (i === 0 || /\s/.test(text[i - 1]))) {
      out.push({ start: i, end: i + numbered[0].length, kind: "ol" });
      i += numbered[0].length - 1;
    }
  }
  return out;
}

function headingTitle(text, hit) {
  // A heading may continue after a comma ("Desirable qualifications, skills
  // and experience"). The continuation must start with punctuation, so a
  // heading followed by plain words ("Experience coordinating reports ...")
  // keeps its items intact.
  let end = hit.end;
  if (text[end] === ":") end += 1;
  const rest = text.slice(end);
  const continuation = /^[,;–—&]\s*[a-z][\w\s,&/+()-]{0,60}/.exec(rest);
  if (continuation) end += continuation[0].length;
  const raw = collapseWhitespace(text.slice(hit.start, end)).replace(/[:\u2013\u2014]\s*$/, "").trim();
  const title = raw.length >= 3 && raw.length <= 70 ? raw : JOB_SECTION_LABELS[hit.key] || raw;
  return { title, end };
}

/**
 * The text that follows a heading mark but belongs to the PREVIOUS section.
 *
 * A heading can sit in the middle of a bullet item ("...written an oral
 * English) Desirable qualifications, skills and experience: • ..."). The
 * words before the heading stay with the item they belong to.
 */
function textBeforeHeading(text, hit) {
  return text.slice(0, hit.start);
}

/**
 * Split the announcement into segments at every bullet marker.
 *
 * A segment is either plain text or a bullet item. The text before the first
 * bullet is its own paragraph.
 */
function toSegments(text) {
  const bullets = findBullets(text);
  const segments = [];
  let cursor = 0;
  for (const bullet of bullets) {
    if (bullet.start > cursor) {
      segments.push({ bullet: false, kind: "ul", text: text.slice(cursor, bullet.start) });
    }
    const next = bullets.find((b) => b.start > bullet.end);
    const stop = next ? next.start : text.length;
    segments.push({ bullet: true, kind: bullet.kind, text: text.slice(bullet.end, stop) });
    cursor = stop;
  }
  if (cursor < text.length) segments.push({ bullet: false, kind: "ul", text: text.slice(cursor) });
  return segments;
}

/**
 * Turn a raw announcement into structured sections.
 *
 * @param {string} text             the raw announcement text
 * @param {object} [options]
 * @param {string} [options.requirements]  separate requirements text, if any
 * @returns {{key: string, title: string, type: string, items: string[], paragraphs: string[]}[]}
 */
export function formatJobSections(text, { requirements = "" } = {}) {
  const raw = String(text || "").replace(/\r\n?/g, "\n");
  if (!raw.trim() && !String(requirements || "").trim()) return [];

  const sections = [];
  let current = null;
  let listKind = null;

  const pushParagraph = (value) => {
    const text2 = collapseWhitespace(value);
    if (text2) current.paragraphs.push(text2);
  };
  const pushItem = (value, kind) => {
    const text2 = collapseWhitespace(value);
    if (!text2) return;
    if (listKind && listKind !== kind) {
      // A different list style: keep it as its own paragraph block.
      pushParagraph(text2);
      return;
    }
    current.items.push(text2);
    listKind = kind;
  };
  const closeSection = () => {
    if (current && (current.paragraphs.length || current.items.length)) sections.push(current);
    current = null;
    listKind = null;
  };
  const openSection = (key, title) => {
    current = { key, title, paragraphs: [], items: [] };
    listKind = null;
  };

  for (const segment of toSegments(raw)) {
    if (!segment.text.trim()) continue;

    // A heading can sit inside a segment, either at its start ("Educational
    // Qualifications • ...") or in the middle of a bullet item.
    let rest = segment.text;
    let first = true;
    for (;;) {
      const hit = findHeadings(rest)[0];
      if (!hit) break;
      const before = rest.slice(0, hit.start);
      const heading = headingTitle(rest, hit);

      // The words before the heading belong to the section we are in: as an
      // item when the segment is a bullet, otherwise as a paragraph.
      if (!current) openSection(hit.key, heading.title);
      if (first && segment.bullet) pushItem(before, segment.kind);
      else pushParagraph(before);

      closeSection();
      openSection(hit.key, heading.title);
      rest = rest.slice(heading.end);
      first = false;
    }

    const tail = collapseWhitespace(rest);
    if (tail) {
      if (!current) openSection("summary", JOB_SECTION_LABELS.summary);
      if (segment.bullet) pushItem(tail, segment.kind);
      else pushParagraph(tail);
    }
  }
  closeSection();

  // Nothing is ever dropped: an announcement that is only a heading (or has
  // no recognisable structure) is still published.
  if (!sections.length) {
    const whole = collapseWhitespace(raw);
    if (whole) {
      const only = findHeadings(whole)[0];
      const isJustAHeading = only && whole.length <= 70 && only.start === 0 && only.end >= whole.length - 1;
      sections.push({
        key: isJustAHeading ? only.key : "summary",
        title: isJustAHeading ? headingTitle(whole, only).title : JOB_SECTION_LABELS.summary,
        paragraphs: isJustAHeading ? [] : [whole],
        items: [],
      });
    }
  }

  // A separate requirements column is its own section.
  const reqText = collapseWhitespace(String(requirements || ""));
  if (reqText) {
    const existing = sections.find((s) => s.key === "requirements");
    if (existing) existing.paragraphs.push(reqText);
    else sections.push({ key: "requirements", title: JOB_SECTION_LABELS.requirements, paragraphs: [reqText], items: [] });
  }

  const ordered = [];
  for (const key of SECTION_ORDER) {
    const found = sections.filter((s) => s.key === key);
    if (!found.length) continue;
    // The same section can appear more than once ("Experience" as both a
    // heading and a sub-heading). They are merged into one section.
    const merged = {
      key,
      title: found[0].title || JOB_SECTION_LABELS[key] || key,
      paragraphs: [],
      items: [],
    };
    for (const s of found) {
      merged.paragraphs.push(...s.paragraphs);
      merged.items.push(...s.items);
    }
    ordered.push(merged);
  }
  for (const s of sections) if (!SECTION_ORDER.includes(s.key)) ordered.push(s);

  return ordered.map((s) => ({
    key: s.key,
    title: s.title || JOB_SECTION_LABELS[s.key] || s.key,
    type: s.items.length && !s.paragraphs.length ? "list" : s.items.length ? "mixed" : "text",
    items: s.items,
    paragraphs: s.paragraphs,
  }));
}

export { SECTION_ORDER };
