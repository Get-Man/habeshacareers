#!/usr/bin/env node
/**
 * ETcareers vacancy scraper (standalone, reusable)
 * ------------------------------------------------
 *
 * Fetches one ETcareers job detail page and reconstructs the *employer's*
 * vacancy — not the ETcareers webpage. It never fabricates a logo, deadline,
 * salary or application URL: every returned value is traceable to a specific
 * element on the live page, and the diagnostics print the exact selectors and
 * matches used.
 *
 * The live pages are server-rendered, so plain HTTP with browser-like headers
 * is the primary path. A headless-browser fallback (Playwright/Puppeteer, if
 * installed) is used only when the page looks blocked or JavaScript-rendered.
 *
 * Usage
 *   node scripts/etcareers-scraper.mjs [URL] [options]
 *
 * Options
 *   --out <file>         also write the structured JSON to <file>
 *   --logo-out <file>    download logo_url to <file> (optional)
 *   --html <file>        extract from a previously saved HTML file (offline test)
 *   --force-browser      skip the HTTP result and render with a headless browser
 *   --quiet              suppress the human-readable diagnostics on stderr
 *
 * Output
 *   stdout: the exact structured JSON object
 *   stderr: fetch + selector diagnostics (unless --quiet)
 *
 * Structured shape
 *   {
 *     job_title, organization_name, logo_url,
 *     metadata: { locations, employment_type, posted_date, deadline },
 *     description_html, apply_url, apply_button_html
 *   }
 */

import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_URL =
  "https://etcareers.com/jobs/zamzam-bank-s-c-job-vacancy-2026-3-positions-in-ethiopia-f7206e1b";

// Realistic browser headers: ETcareers serves slightly different markup to
// bare clients, and this also avoids naive bot blocking.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://etcareers.com/jobs",
};

// ---------------------------------------------------------------------------
// Small, dependency-free HTML helpers. All tag-matching regexes are
// quote-aware because ETcareers' CTA has `data-action="click->job#onApply"`
// — a `>` inside a quoted attribute value.
// ---------------------------------------------------------------------------

const ANCHOR_RE = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi;
const IMG_RE = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/gi;
const OPEN_TAG_RE = /<([a-z][a-z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const VOID_TAGS = new Set(["img", "source", "meta", "br", "hr", "input", "link"]);

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”",
  ldquo: "“", hellip: "…", times: "×", copy: "©", bull: "•",
};

function decodeEntities(value) {
  return String(value ?? "").replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (full, entity) => {
      if (entity[0] === "#") {
        const n = /^#x/i.test(entity)
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff
          ? String.fromCodePoint(n)
          : full;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? full;
    }
  );
}

/** Quote-aware attribute parser (handles `data-action="click->job#onApply"`). */
function parseAttributes(raw) {
  const attrs = Object.create(null);
  const re = /([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const m of String(raw ?? "").matchAll(re)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return attrs;
}

/**
 * Return the complete element starting at `start` (opening tag through its
 * balanced closing tag). Used so we slice the *exact* inner HTML of a
 * container instead of re-serialising it.
 */
function balancedElement(html, start) {
  const m = /^<([a-z][a-z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(
    html.slice(start)
  );
  if (!m) return "";
  const tag = m[1].toLowerCase();
  if (VOID_TAGS.has(tag) || m[0].endsWith("/>")) return m[0];
  const re = new RegExp(`<\\/?${tag}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, "gi");
  let depth = 1;
  const rest = html.slice(start + m[0].length);
  for (const match of rest.matchAll(re)) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (depth === 0) {
      return html.slice(start, start + m[0].length + match.index + match[0].length);
    }
  }
  return html.slice(start);
}

/** Stack of block-level elements open immediately before `index`. */
function enclosingBlocks(html, index) {
  const stack = [];
  const re = /<\/?(div|section|article|main)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const m of html.matchAll(re)) {
    if (m.index >= index) break;
    const tag = m[1].toLowerCase();
    if (m[0][1] === "/") {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      stack.push({ tag, attrs: m[2] || "", start: m.index });
    }
  }
  return stack;
}

/** Strip tags to newline-separated text (for labels/metadata, never for HTML output). */
function toLines(html) {
  return String(html ?? "")
    .replace(/<(script|style|noscript|svg|template|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(?:p|div|li|ul|ol|h[1-6]|tr|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .split(/\n/)
    .map((line) => decodeEntities(line).replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function collapse(value) {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function absoluteUrl(raw, base) {
  const value = decodeEntities(raw).trim();
  if (!value) return null;
  // Accept absolute, scheme-relative and root/path-relative URLs, but never
  // treat a bare domain string (e.g. "zamzambank.com") as a link.
  if (
    !/^(?:https?:)?\/\//i.test(value) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !/^[./]/.test(value)
  ) {
    return null;
  }
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(value) {
  try {
    return new URL(String(value)).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

const BOARD_HOST_RE = /(?:^|\.)etcareers\.com$/i;
const SOCIAL_HOST_RE =
  /(?:^|\.)(?:t\.me|telegram\.me|telegram\.com|facebook\.com|fb\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|youtu\.be|whatsapp\.com|wa\.me)(?:$|\.)/i;

function companyTokens(company) {
  return String(company ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

class Diagnostics {
  constructor(quiet = false) {
    this.quiet = quiet;
    this.lines = [];
  }

  section(title) {
    this.lines.push(`\n=== ${title} ===`);
  }

  add(label, value) {
    this.lines.push(`${label}: ${value}`);
  }

  match(selector, found, detail) {
    this.lines.push(
      `  ${found ? "MATCH" : "MISS "}  ${selector} -> ${
        found ? detail : "no match"
      }`
    );
  }

  candidate(label, accepted, reason) {
    this.lines.push(`  ${accepted ? "KEEP " : "REJECT"}  ${label} — ${reason}`);
  }

  print() {
    if (this.quiet) return;
    console.error(this.lines.join("\n"));
  }
}

// ---------------------------------------------------------------------------
// Fetch (HTTP first, optional headless fallback)
// ---------------------------------------------------------------------------

function looksJsRenderedOrBlocked(html, status) {
  if (status && status !== 200) return `HTTP ${status}`;
  if (html.length < 2500) return `only ${html.length} bytes`;
  if (!/<h1\b/i.test(html)) return "no <h1> in markup";
  if (/<div\b[^>]*\bid\s*=\s*["'](?:root|app|__next)["'][^>]*>\s*<\/div>/i.test(html)) {
    return "empty JS app shell";
  }
  return "";
}

/**
 * Try to render with an installed headless browser. Returns null (with a
 * diagnostic) when no browser package is available — this is normal here:
 * ETcareers detail pages are server-rendered and need no fallback.
 */
async function headlessFetch(url, diag) {
  const packages = ["playwright", "playwright-core", "puppeteer", "puppeteer-core"];
  for (const name of packages) {
    let mod;
    try {
      mod = await import(name);
    } catch {
      diag.add(`headless fallback: ${name}`, "not installed");
      continue;
    }
    try {
      diag.add("headless fallback", `using ${name}`);
      if (name.startsWith("playwright")) {
        const browser = await mod.chromium.launch({ headless: true });
        const page = await browser.newPage({ extraHTTPHeaders: BROWSER_HEADERS });
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        const html = await page.content();
        await browser.close();
        return html;
      }
      const browser = await mod.launch({ headless: true });
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders(BROWSER_HEADERS);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      const html = await page.content();
      await browser.close();
      return html;
    } catch (error) {
      diag.add(`headless fallback: ${name} failed`, error.message);
    }
  }
  return null;
}

async function fetchPage(url, { forceBrowser = false, diag }) {
  diag.section("FETCH");
  diag.add("url", url);
  diag.add("headers", Object.keys(BROWSER_HEADERS).join(", "));

  if (forceBrowser) {
    const html = await headlessFetch(url, diag);
    if (html) return { html: await html, via: "headless browser", status: 200 };
    diag.add("headless fallback", "unavailable — cannot extract without HTML");
    return { html: "", via: "none", status: 0 };
  }

  let html = "";
  let status = 0;
  let finalUrl = url;
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    status = res.status;
    finalUrl = res.url || url;
    html = await res.text();
  } catch (error) {
    diag.add("HTTP request failed", error.message);
  }
  diag.add("HTTP status", String(status));
  diag.add("bytes", String(html.length));
  diag.add("final url", finalUrl);

  const reason = looksJsRenderedOrBlocked(html, status);
  if (reason) {
    diag.add("fallback reason", reason);
    const rendered = await headlessFetch(url, diag);
    if (rendered) return { html: rendered, via: "headless browser", status };
    diag.add("fallback", "no headless browser installed; continuing with HTTP HTML");
  } else {
    diag.add("fallback", "not needed — server-rendered HTML contains the job");
  }
  return { html, via: "HTTP", status };
}

// ---------------------------------------------------------------------------
// Selector 1 — the job header (title, employer, logo, metadata)
// ---------------------------------------------------------------------------

const HEADER_REJECT_RE =
  /(?:rich[-_ ]?text|job[-_ ]?(?:description|content|body|posting)|id\s*=\s*["'][^"']*apply-btn|similar[-_ ]?jobs|<h[2-6]\b|<form\b|<button\b)/i;

function extractHeader(html, diag) {
  diag.section("SELECTOR 1 — JOB HEADER");
  const h1 = /<h1\b([^>]*)>([\s\S]*?)<\/h1>/i.exec(html);
  if (!h1 || h1.index == null) {
    diag.match("<h1>", false, "");
    return { headerHtml: "", title: null };
  }
  const title = collapse(h1[2]);
  diag.match("<h1>", true, `"${title}"`);

  const stack = enclosingBlocks(html, h1.index);
  diag.add("h1 ancestor blocks", stack.length ? stack.map((s) => s.tag).join(" > ") : "none");

  // Walk outward and keep the widest block that still contains header content
  // only. For this layout that is the `md:col-span-9` wrapper: it includes the
  // logo, title, employer and metadata, but not .rich-text or the CTA sidebar.
  let best = "";
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const chunk = balancedElement(html, stack[i].start);
    if (!chunk || HEADER_REJECT_RE.test(chunk)) {
      diag.candidate(`ancestor <${stack[i].tag}> @${stack[i].start}`, false, "contains body/CTA content");
      continue;
    }
    if (toLines(chunk).length > 4000) {
      diag.candidate(`ancestor <${stack[i].tag}> @${stack[i].start}`, false, "too large to be a header");
      continue;
    }
    best = chunk;
    diag.candidate(`ancestor <${stack[i].tag}> @${stack[i].start}`, true, "header-only block kept");
  }
  diag.match("header container", !!best, best ? `${best.length} chars of exact markup` : "");
  return { headerHtml: best, title };
}

function extractOrganization(headerHtml, diag) {
  diag.section("SELECTOR 2 — ORGANIZATION NAME");
  // The employer is the first anchor in the header, adjacent to the <h1>.
  // Its href is the self-referencing job URL, so it is never used as a website.
  const anchors = [...headerHtml.matchAll(ANCHOR_RE)];
  for (const m of anchors) {
    const a = parseAttributes(m[1]);
    const text = collapse(toLines(m[2]));
    if (!text || /\bjobs?\s+in\s+ethiopia\b/i.test(text)) continue;
    diag.match("header employer anchor", true, `"${text}" (href=${a.href || "none"})`);
    return text;
  }
  const logoAlt = /<img\b[^>]*\balt\s*=\s*["']([^"']+)["'][^>]*>/i.exec(headerHtml);
  if (logoAlt) {
    const name = collapse(logoAlt[1]).replace(/\s+logo$/i, "").trim();
    if (name && !/etcareers/i.test(name)) {
      diag.match("logo alt fallback", true, `"${name}"`);
      return name;
    }
  }
  diag.match("header employer anchor", false, "");
  return null;
}

/**
 * Inspect a single <img> for known logo sources, in the order requested:
 * src, data-src, data-lazy-src, data-original, highest-res srcset, CSS bg.
 */
function imageSources(attrs) {
  const sources = [];
  for (const key of ["src", "data-src", "data-lazy-src", "data-original"]) {
    if (attrs[key]) sources.push({ value: attrs[key], from: key });
  }
  if (attrs.srcset) {
    let best = null;
    for (const entry of attrs.srcset.split(/\s*,\s*/)) {
      const parts = entry.trim().split(/\s+/);
      const descriptor = parseFloat(parts[1]) || 1;
      if (!best || descriptor > best.density) {
        best = { value: parts[0], from: `srcset(${parts[1] || "1x"})`, density: descriptor };
      }
    }
    if (best) sources.push(best);
  }
  const bg = /background-image\s*:\s*url\(\s*["']?([^"')]+)/i.exec(attrs.style || "");
  if (bg) sources.push({ value: bg[1], from: "background-image" });
  return sources;
}

function extractLogo(fullHtml, headerHtml, company, pageUrl, diag) {
  diag.section("SELECTOR 3 — EMPLOYER LOGO");
  const tokens = companyTokens(company);
  const all = [];

  // Scan every image so the diagnostics explicitly show why the navbar logo
  // and related-job thumbnails were rejected.
  for (const m of fullHtml.matchAll(IMG_RE)) {
    const attrs = parseAttributes(m[1]);
    const alt = collapse(attrs.alt || attrs.title || "");
    const sources = imageSources(attrs);
    const inHeader = headerHtml.includes(m[0]);
    const boardBrand =
      /board-logo|site-logo|etcareers/i.test(`${attrs.id || ""} ${attrs.class || ""} ${alt}`) ||
      /etcareers|board-logo/i.test(sources.map((s) => s.value).join(" "));

    let reason = "";
    if (boardBrand) reason = "ETcareers board/navbar branding";
    else if (!inHeader) reason = "outside the job header (related job / page chrome)";
    else if (!sources.length) reason = "no usable image source";
    else if (!tokens.length) reason = "employer name unavailable";

    const url = sources.length ? absoluteUrl(sources[0].value, pageUrl) : null;
    let score = 0;
    if (!reason) {
      if (/\blogo\b/i.test(alt)) score += 25;
      if (tokens.some((t) => alt.toLowerCase().includes(t))) score += 30;
      if (tokens.some((t) => decodeURIComponent(sources[0].value).toLowerCase().includes(t))) score += 25;
      if (Number(attrs.width) >= 64 || Number(attrs.height) >= 64) score += 5;
      if (score < 50) reason = "not confidently associated with this employer";
    }
    const candidate = {
      alt,
      url,
      from: sources[0]?.from || "",
      inHeader,
      reason,
      score,
      rawTag: m[0],
    };
    all.push(candidate);

    const label = `${alt || "(no alt)"} @ ${url || sources[0]?.value || "no source"}`;
    diag.candidate(label, !reason, reason || `logo score ${score} (${sources[0].from})`);
  }

  const best = all.filter((c) => !c.reason).sort((a, b) => b.score - a.score)[0] || null;
  diag.match("employer logo", !!best, best ? `${best.url} (${best.from})` : "");
  return best ? { url: best.url, alt: best.alt, source: "job_header" } : null;
}

// ---------------------------------------------------------------------------
// Selector 4 — header metadata + description-derived deadline
// ---------------------------------------------------------------------------

/** The metadata rows live in one wrapper below <h1>; scope to it so the job
 *  title (which often also mentions "Ethiopia") is never read as a location. */
function metadataContainer(headerHtml) {
  const posted = /<[^>]*\bid\s*=\s*["']job-posted-at["'][^>]*>/i.exec(headerHtml);
  if (!posted) return headerHtml;
  let best = "";
  for (const block of enclosingBlocks(headerHtml, posted.index)) {
    const chunk = balancedElement(headerHtml, block.start);
    if (!chunk.includes("job-posted-at") || /<h1\b/i.test(chunk)) continue;
    if (toLines(chunk).split("\n").length < 2) continue; // need multiple metadata rows
    best = chunk; // keep the widest rows-only wrapper
  }
  return best || headerHtml;
}

function extractMetadata(headerHtml, descriptionText, diag) {
  diag.section("SELECTOR 4 — METADATA");
  const lines = toLines(metadataContainer(headerHtml))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let postedDate = null;
  const postedEl = /<[^>]*\bid\s*=\s*["']job-posted-at["'][^>]*>([\s\S]*?)<\/div>/i.exec(headerHtml);
  if (postedEl) postedDate = collapse(toLines(postedEl[1])) || null;
  if (!postedDate) {
    postedDate =
      lines.find((l) =>
        /\b(?:ago|just now|today|yesterday|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2})/i.test(l)
      ) || null;
  }
  diag.match("#job-posted-at", !!postedDate, postedDate || "");

  const employmentType =
    lines.find((l) => /^(?:full|part)[- ]?time\b|\b(?:contract|temporary|internship|freelance|permanent)\b/i.test(l)) || null;
  diag.match("employment type row", !!employmentType, employmentType || "");

  const locationLines = lines.filter(
    (l) => /ethiopia\b/i.test(l) && !/\bjobs?\s+in\b/i.test(l) && !/\bapply\b/i.test(l)
  );
  const descriptionLocation =
    /(?:job\s+location|duty\s+station|place\s+of\s+work|work\s+location|location)\s*:\s*([^\n]{3,160})/i.exec(descriptionText);
  const locations = [];
  for (const value of [...locationLines, descriptionLocation?.[1]].filter(Boolean)) {
    const text = collapse(value).replace(/[.,;:]+$/, "").trim();
    if (text && !locations.includes(text)) locations.push(text);
  }
  diag.match("location row", locations.length > 0, locations.join(" | "));

  const deadlineMatch =
    /(?:application\s+deadline|deadline|closing\s+date|apply\s+before|last\s+date)\s*:\s*([^\n]{3,160})/i.exec(descriptionText) ||
    /\b(?:within\s+\d+\s+days?\s+from\s+[^\n.]{3,120}|on\s+or\s+before\s+[^\n.]{3,120})\b/i.exec(descriptionText);
  const deadline = deadlineMatch ? collapse(deadlineMatch[1] || deadlineMatch[0]) : null;
  diag.match("deadline in description", !!deadline, deadline || "");

  return {
    locations,
    employment_type: employmentType,
    posted_date: postedDate,
    deadline,
  };
}

// ---------------------------------------------------------------------------
// Selector 5 — the main description (exact inner HTML, noise removed)
// ---------------------------------------------------------------------------

const NOISE_ATTR_RE =
  /(?:^|[\s_-])(?:ad|ads|advert|advertisement|sponsor(?:ed)?|promo|promotion|share|social|telegram|newsletter|subscribe|more[-_ ]?jobs|related|similar|job[-_ ]?alerts?)(?:$|[\s_-])/i;

const NOISE_PHRASE_RE =
  /(?:job\s+search\s+subscription|ethiopian\s+job\s+market|buy\s+maps|career\s+coaching|join\s+etcareers(?:\s+on\s+telegram)?|etcareers\s+job\s+alerts?|job\s+alerts?|daily\s+job\s+updates|subscribe(?:\s+to\s+[^<]{0,60})?|more\s+jobs|share\s+with\s+friends|t\.me\/|telegram|advertis(?:e|ement)|sponsored)/i;

/** Remove whole noisy elements without reformatting the surrounding markup. */
function stripNoisyElements(html, diag) {
  const spans = [];
  const re = /<(p|li|div|section|aside|span|figure)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const m of html.matchAll(re)) {
    const chunk = balancedElement(html, m.index);
    if (!chunk) continue;
    const text = toLines(chunk);
    let reason = "";
    if (NOISE_ATTR_RE.test(m[2] || "")) reason = "noise class/id";
    else if (text.length < 300 && NOISE_PHRASE_RE.test(text)) reason = "noise phrase";
    if (reason) spans.push({ start: m.index, end: m.index + chunk.length, reason });
  }
  // Keep only outer spans so nested matches are not removed twice.
  const outer = spans.filter(
    (s) => !spans.some((other) => other !== s && other.start <= s.start && other.end >= s.end && other.start !== s.start)
  );
  for (const span of outer.sort((a, b) => b.start - a.start)) {
    diag.add("description noise removed", `${span.reason}: "${collapse(toLines(html.slice(span.start, span.end))).slice(0, 90)}"`);
    html = html.slice(0, span.start) + " " + html.slice(span.end);
  }
  return html;
}

function extractDescription(html, diag) {
  diag.section("SELECTOR 5 — DESCRIPTION HTML");
  let container = null;
  const re = /<(div|section|article)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const m of html.matchAll(re)) {
    if (!/\brich[-_ ]?text\b/i.test(m[2] || "")) continue;
    const element = balancedElement(html, m.index);
    container = { openTag: m[0], element };
    break;
  }
  if (!container) {
    diag.match(".rich-text", false, "");
    return { descriptionHtml: "", text: "" };
  }

  // Slice the inner HTML verbatim: strip exactly the opening tag and the
  // final matching closing tag, with no entity decoding or re-serialisation.
  let inner = container.element.slice(container.openTag.length);
  inner = inner.replace(/<\/(?:div|section|article)>\s*$/i, "").trim();

  diag.match(".rich-text", true, `${inner.length} chars of verbatim inner HTML`);
  diag.add("preserved tags", (inner.match(/<(?:h[1-6]|p|ul|ol|li|strong|a)\b/gi) || []).length + " headings/paragraphs/lists/bold/links");

  inner = inner.replace(
    /<(script|style|noscript|iframe|object|embed|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
    () => {
      diag.add("description noise removed", "script/style/embedded block");
      return " ";
    }
  );
  inner = stripNoisyElements(inner, diag);
  inner = inner.replace(ANCHOR_RE, (full, attrsRaw, body) => {
    const attrs = parseAttributes(attrsRaw);
    const href = decodeEntities(attrs.href || "");
    const host = absoluteUrl(href, "https://etcareers.com/") ? hostOf(absoluteUrl(href, "https://etcareers.com/")) : "";
    const shareAttrs = `${attrs.class || ""} ${attrs.id || ""} ${attrs["aria-label"] || ""}`;
    const isApply = /\b(?:apply|application|form)\b/i.test(`${collapse(toLines(body))} ${href}`);
    if (!isApply && (SOCIAL_HOST_RE.test(host) || /\b(?:share|tweet|telegram|follow)\b/i.test(shareAttrs))) {
      diag.add("description noise removed", `social/share anchor -> ${href}`);
      return " ";
    }
    return full;
  });

  const final = inner.trim();
  diag.add("description length after cleaning", String(final.length));
  diag.add("related-jobs leakage", /\bsimilar-jobs\b|\bmore jobs\b|telegram/i.test(final) ? "FOUND (unexpected)" : "none");
  return { descriptionHtml: final, text: toLines(final) };
}

// ---------------------------------------------------------------------------
// Selector 6 — application URL + generated button HTML
// ---------------------------------------------------------------------------

const APPLY_LABEL_RE = /\bapply(?:\s+(?:now|online|here|today|for\s+(?:this\s+)?(?:job|role|position)))?\b|\bsubmit\s+(?:your\s+)?(?:application|cv|resume)\b/i;
const SHARE_LABEL_RE = /\b(?:share|tweet|facebook|linkedin|whatsapp|telegram|pinterest|print|subscribe|newsletter)\b/i;

function cutBeforeRelated(html) {
  const patterns = [
    /<[^>]*\bid\s*=\s*["'][^"']*(?:similar|related)[-_]?jobs?[^"']*["'][^>]*>/i,
    /<h[1-6]\b[^>]*>[\s\S]{0,160}?\bmore\s+jobs\b[\s\S]{0,80}?<\/h[1-6]>/i,
    /<footer\b/i,
  ];
  let cut = html.length;
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m.index > 0 && m.index < cut) cut = m.index;
  }
  return html.slice(0, cut);
}

function isUsableDestination(url, pageUrl, { allowMailto = false } = {}) {
  if (!url) return false;
  // Public catalogue stays link-free for email-only jobs. The embeddable card
  // opts in so a real `mailto:` CTA can be used without inventing a URL.
  if (/^mailto:/i.test(url)) return allowMailto;
  if (/^tel:/i.test(url)) return false;
  if (BOARD_HOST_RE.test(hostOf(url)) || hostOf(url) === hostOf(pageUrl)) return false;
  return /^https?:\/\//i.test(url);
}

/** Unwrap common redirect wrappers (?url=..., ?to=..., encoded targets). */
function unwrapRedirect(url, pageUrl) {
  try {
    const parsed = new URL(url);
    for (const [, value] of parsed.searchParams) {
      const decoded = absoluteUrl(value, pageUrl);
      if (decoded && !BOARD_HOST_RE.test(hostOf(decoded))) return decoded;
    }
  } catch {
    /* not a wrapper */
  }
  return url;
}

async function resolveFinalRedirect(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    return /^https?:\/\//i.test(res.url) ? res.url : null;
  } catch {
    return null;
  }
}

function applyButtonHtml(url) {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="apply-now-btn">Apply Now</a>`;
}

async function extractApplication(fullHtml, descriptionHtml, descriptionText, pageUrl, diag, options = {}) {
  diag.section("SELECTOR 6 — APPLICATION URL");
  const region = cutBeforeRelated(fullHtml);
  const candidates = [];

  for (const m of region.matchAll(ANCHOR_RE)) {
    const attrs = parseAttributes(m[1]);
    const label = collapse(toLines(m[2]));
    const href = decodeEntities(attrs.href || "");
    const idClass = `${attrs.id || ""} ${attrs.class || ""}`;
    if (!APPLY_LABEL_RE.test(label) && !/\bapply\b/i.test(idClass)) continue;
    if (SHARE_LABEL_RE.test(label) && !APPLY_LABEL_RE.test(label)) continue;

    let score = 0;
    if (/\bapply[-_]?(?:now|button|btn)\b/i.test(attrs.id || "")) score += 120;
    if (/^apply\b/i.test(label)) score += 50;
    if (/\bapply\b/i.test(attrs.class || "")) score += 20;

    const url = absoluteUrl(href, pageUrl);
    if (url && isUsableDestination(url, pageUrl, options)) score += 30;

    // JavaScript-opened URL stored on the element.
    const jsUrl =
      /(?:window\s*\.\s*open|location(?:\s*\.\s*href)?\s*=|location\s*\.\s*assign)\s*\(\s*["']([^"']+)["']/i.exec(attrs.onclick || "")?.[1] ||
      attrs["data-href"] ||
      attrs["data-url"] ||
      "";
    const jsAbsolute = jsUrl ? absoluteUrl(jsUrl, pageUrl) : null;

    candidates.push({ label, href, url, jsAbsolute, score, attrs });
    diag.candidate(
      `anchor "${label.slice(0, 48)}" -> ${href.slice(0, 110) || "(no href)"}`,
      true,
      `score ${score}${jsAbsolute ? `, JS url ${jsAbsolute}` : ""}`
    );
  }

  // A <button> may carry the real destination in data-* or onclick.
  for (const m of region.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const label = collapse(toLines(m[2]));
    if (!APPLY_LABEL_RE.test(label)) continue;
    const attrs = parseAttributes(m[1]);
    const raw = attrs["data-href"] || attrs["data-url"] || attrs["data-target"] || "";
    const js = /(?:window\s*\.\s*open|location\s*\.\s*assign|location(?:\s*\.\s*href)?\s*=)\s*\(\s*["']([^"']+)["']/i.exec(attrs.onclick || "")?.[1] || "";
    const url = absoluteUrl(raw || js, pageUrl);
    if (url) {
      candidates.push({ label, href: raw || js, url, jsAbsolute: null, score: 60, attrs });
      diag.candidate(`button "${label}"`, true, `JS/data url ${url}`);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  diag.match("apply candidates", candidates.length > 0, `${candidates.length} found`);

  const chosen = candidates[0] || null;
  let applyUrl = null;
  let source = null;

  // Hierarchy: legitimate Apply button href -> JS-opened URL -> final redirect
  // -> employer-provided online application URL -> null.
  if (chosen) {
    const mailto = options.allowMailto && /^mailto:/i.test(chosen.href) ? chosen.href : null;
    const direct = chosen.url || mailto;
    const unwrapped = direct ? unwrapRedirect(direct, pageUrl) : null;
    if (isUsableDestination(unwrapped, pageUrl, options)) {
      applyUrl = unwrapped;
      source = unwrapped === direct ? "primary Apply now href" : "unwrapped redirect href";
    } else if (isUsableDestination(chosen.jsAbsolute, pageUrl, options)) {
      applyUrl = chosen.jsAbsolute;
      source = "JavaScript-opened URL";
    } else if (direct && BOARD_HOST_RE.test(hostOf(direct))) {
      const final = await resolveFinalRedirect(direct);
      if (isUsableDestination(final, pageUrl, options)) {
        applyUrl = final;
        source = "final redirect URL";
      }
    }
    if (/^mailto:/i.test(chosen.href)) {
      diag.add(
        "primary CTA",
        options.allowMailto
          ? `mailto (${chosen.href}) — embeddable card keeps it as direct_apply_url`
          : `mailto only (${chosen.href}) — email application, apply_url stays null`
      );
    }
  }

  if (!applyUrl) {
    // Employer-provided online application link inside the description.
    for (const m of descriptionHtml.matchAll(ANCHOR_RE)) {
      const attrs = parseAttributes(m[1]);
      const url = absoluteUrl(attrs.href || "", pageUrl);
      if (!isUsableDestination(url, pageUrl, options)) continue;
      const context = collapse(toLines(descriptionText));
      const near = descriptionText.split("\n").find((line) => (attrs.href || "").includes(line.trim())) || "";
      if (!/\b(?:apply|application|online|form|submit)\b/i.test(`${near} ${context.slice(0, 0)}`)) {
        // Only accept a link labelled as the application/form.
        const label = collapse(toLines(m[2]));
        if (!/\b(?:apply|application|form|https?:\/\/forms\.gle)/i.test(`${label} ${url}`)) continue;
      }
      applyUrl = url;
      source = "employer-provided online application link in description";
      break;
    }
  }

  diag.add("apply_url source", source || "none (no verified destination)");
  diag.match("apply_url", !!applyUrl, applyUrl || "null");
  diag.add("apply_button_html", applyUrl ? applyButtonHtml(applyUrl) : "not generated (no apply_url)");
  return { applyUrl, source, candidates };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    url: DEFAULT_URL,
    out: null,
    logoOut: null,
    htmlFile: null,
    forceBrowser: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--logo-out") opts.logoOut = argv[++i];
    else if (arg === "--html") opts.htmlFile = argv[++i];
    else if (arg === "--force-browser") opts.forceBrowser = true;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg && !arg.startsWith("--")) opts.url = arg;
  }
  return opts;
}

async function saveLogo(logoUrl, file, diag) {
  try {
    const res = await fetch(logoUrl, {
      headers: { ...BROWSER_HEADERS, Accept: "image/avif,image/webp,image/png,image/*,*/*" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, bytes);
    diag.add("logo download", `${file} (${bytes.length} bytes)`);
  } catch (error) {
    diag.add("logo download failed", error.message);
  }
}

/** Lightweight text pass used by metadata extraction so diagnostics stay in
 *  page order (header -> metadata -> description -> application). */
function rawDescriptionText(html) {
  const re = /<(div|section|article)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const m of html.matchAll(re)) {
    if (!/\brich[-_ ]?text\b/i.test(m[2] || "")) continue;
    const element = balancedElement(html, m.index);
    return toLines(element.slice(m[0].length).replace(/<\/(?:div|section|article)>\s*$/i, ""));
  }
  return "";
}

export async function scrapeEtcareers(url, options = {}) {
  const diag = options.diag || new Diagnostics(options.quiet);
  let html;
  if (options.html) {
    diag.section("FETCH");
    html = options.html;
    diag.add("source", "in-memory HTML");
    diag.add("bytes", String(html.length));
  } else if (options.htmlFile) {
    diag.section("FETCH");
    html = readFileSync(options.htmlFile, "utf8");
    diag.add("source", `local file ${options.htmlFile}`);
    diag.add("bytes", String(html.length));
  } else {
    const page = await fetchPage(url, { forceBrowser: !!options.forceBrowser, diag });
    html = page.html;
    diag.add("extraction from", page.via);
  }
  if (!html) throw new Error("No HTML available to extract");

  const { headerHtml, title } = extractHeader(html, diag);
  const organizationName = extractOrganization(headerHtml, diag);
  const logo = extractLogo(html, headerHtml, organizationName || "", url, diag);
  const metadata = extractMetadata(headerHtml, rawDescriptionText(html), diag);
  const { descriptionHtml, text: descriptionText } = extractDescription(html, diag);
  const { applyUrl } = await extractApplication(html, descriptionHtml, descriptionText, url, diag);

  return {
    job_title: title,
    organization_name: organizationName,
    logo_url: logo ? logo.url : null,
    metadata,
    description_html: descriptionHtml,
    apply_url: applyUrl,
    apply_button_html: applyUrl ? applyButtonHtml(applyUrl) : null,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const diag = new Diagnostics(opts.quiet);
  try {
    const record = await scrapeEtcareers(opts.url, { ...opts, diag });
    diag.section("RESULT");
    diag.add("job_title", record.job_title || "null");
    diag.add("organization_name", record.organization_name || "null");
    diag.add("logo_url", record.logo_url || "null");
    diag.add("description_html length", String(record.description_html.length));

    const json = JSON.stringify(record, null, 2);
    process.stdout.write(`${json}\n`);
    if (opts.out) {
      writeFileSync(opts.out, `${json}\n`, "utf8");
      diag.add("JSON saved", opts.out);
    }
    if (opts.logoOut && record.logo_url) {
      await saveLogo(record.logo_url, opts.logoOut, diag);
    }
    diag.print();
  } catch (error) {
    console.error(`[etcareers-scraper] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

// Run main only when invoked directly, so this file can be imported as a module.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  await main();
}

// Named exports let the embeddable-card scraper reuse the exact, already
// verified selectors without maintaining a second HTML parser.
export {
  ANCHOR_RE,
  IMG_RE,
  BOARD_HOST_RE,
  SOCIAL_HOST_RE,
  Diagnostics,
  fetchPage,
  extractHeader,
  extractOrganization,
  imageSources,
  extractDescription,
  extractApplication,
  parseAttributes,
  balancedElement,
  collapse,
  toLines,
  absoluteUrl,
  hostOf,
  companyTokens,
  applyButtonHtml,
};

export default scrapeEtcareers;
