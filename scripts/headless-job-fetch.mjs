#!/usr/bin/env node
/**
 * Headless, zero-page-visit job data fetcher
 * ------------------------------------------
 *
 * Retrieves a job by URL slug or title WITHOUT requesting, rendering or
 * navigating to the job detail page. Sources used instead:
 *
 *   1. The public ETcareers job syndication feed (https://etcareers.com/jobs.rss)
 *   2. Search-index snippets / mirrored listings for cross-reference
 *   3. Global image search or official-domain icons for the employer logo
 *
 * A guard rejects any request to an ETcareers HTML page path; only feeds,
 * sitemaps and robots.txt are allowed on that host. No browser is started.
 *
 * Usage
 *   node scripts/headless-job-fetch.mjs [URL or job title] [options]
 *
 * Options
 *   --out <file>          JSON output (default job_post.json)
 *   --html-out <file>     embeddable card HTML (default embed_card.html)
 *   --assets-dir <dir>    logo directory (default assets/logos)
 *   --feed <url>          RSS feed (default https://etcareers.com/jobs.rss)
 *   --no-cross-reference  skip text search snippet checks
 *   --quiet               suppress diagnostics on stderr
 *
 * stdout: the exact JSON object
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Diagnostics, stripNoisyElements } from "./etcareers-scraper.mjs";
import {
  cleanApplyUrl,
  sanitizeCardDescription,
  resolve_org_logo,
  buildPreviewHtml,
} from "./etcareers-embed.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_URL =
  "https://etcareers.com/jobs/zamzam-bank-s-c-job-vacancy-2026-3-positions-in-ethiopia-f7206e1b";
const DEFAULT_FEED = "https://etcareers.com/jobs.rss";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const ANCHOR_RE = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BOARD_HOST_RE = /(?:^|\.)etcareers\.com$/i;
const SOCIAL_HOST_RE =
  /(?:^|\.)(?:t\.me|telegram\.me|telegram\.com|facebook\.com|fb\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|youtu\.be|whatsapp\.com|wa\.me)(?:$|\.)/i;

const STOP_SLUG_TOKENS = new Set([
  "job", "jobs", "vacancy", "vacancies", "recruitment", "opening", "openings",
  "position", "positions", "in", "ethiopia", "ethiopian", "the", "and", "for",
]);

const ENTITY_MAP = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", bull: "•",
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
      return ENTITY_MAP[entity.toLowerCase()] ?? full;
    }
  );
}

function parseAttributes(raw) {
  const attrs = Object.create(null);
  const re = /([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const m of String(raw ?? "").matchAll(re)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return attrs;
}

function stripTags(value) {
  return decodeEntities(String(value ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function collapse(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hostOf(value) {
  try {
    return new URL(String(value)).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
 // Zero-visit guard
 // ---------------------------------------------------------------------------

/** ETcareers HTML pages are forbidden; only public machine feeds are allowed. */
export function isForbiddenEtcareersUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (!BOARD_HOST_RE.test(parsed.hostname)) return false;
    const allowed = /^\/(?:jobs\.rss|sitemap(?:_[a-z0-9-]+)?\.xml|robots\.txt)\/?$/i;
    return !allowed.test(parsed.pathname);
  } catch {
    return false;
  }
}

export async function guardedFetch(url, init = {}, options = {}) {
  if (isForbiddenEtcareersUrl(url)) {
    throw new Error(`zero-visit guard blocked a direct ETcareers page request: ${url}`);
  }
  const networkLog = options.networkLog || [];
  networkLog.push(String(url));
  const impl = options.fetchImpl || fetch;
  return impl(url, init);
}

async function fetchText(url, options, init = {}, timeout = 20000) {
  const res = await guardedFetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(timeout),
  }, options);
  const text = await res.text();
  return { ok: res.ok !== false, status: res.status || 0, text, url: res.url || url };
}

async function fetchJson(url, options, init = {}, timeout = 20000) {
  const result = await fetchText(url, options, init, timeout);
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  return JSON.parse(result.text);
}

// ---------------------------------------------------------------------------
 // Search providers (optional keys; DuckDuckGo works without any)
 // ---------------------------------------------------------------------------

let cachedDotEnv = null;
function readDotEnv() {
  if (cachedDotEnv) return cachedDotEnv;
  cachedDotEnv = {};
  try {
    const raw = readFileSync(path.resolve(REPO_ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      let value = m[2];
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      cachedDotEnv[m[1]] = value;
    }
  } catch {
    // Optional: no credentials are required for the RSS-based extraction.
  }
  return cachedDotEnv;
}

function envValue(name) {
  if (process.env[name] != null && process.env[name] !== "") return process.env[name];
  return readDotEnv()[name] || "";
}

function normaliseTextResult(item, provider) {
  return {
    provider,
    title: stripTags(item.title || item.name || ""),
    snippet: stripTags(item.snippet || item.description || item.content || ""),
    url: String(item.link || item.url || ""),
  };
}

async function duckDuckGoText(query, options, limit) {
  const result = await fetchText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    options
  );
  if (!result.ok || /captcha|challenge|anomaly/i.test(result.text.slice(0, 4000))) {
    throw new Error(`DuckDuckGo text search unavailable (HTTP ${result.status})`);
  }
  const matches = [];
  for (const m of result.text.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)) {
    matches.push(normaliseTextResult({ title: m[1], snippet: m[3] }, "duckduckgo"));
  }
  return matches.slice(0, limit);
}

async function serperText(query, options, limit) {
  const data = await fetchJson("https://google.serper.dev/search", options, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": envValue("SERPER_API_KEY"),
    },
    body: JSON.stringify({ q: query, num: limit }),
  });
  return (data.organic || []).map((x) => normaliseTextResult(x, "serper")).slice(0, limit);
}

async function tavilyText(query, options, limit) {
  const data = await fetchJson("https://api.tavily.com/search", options, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: envValue("TAVILY_API_KEY"),
      query,
      max_results: limit,
      search_depth: "basic",
    }),
  });
  return (data.results || []).map((x) => normaliseTextResult(x, "tavily")).slice(0, limit);
}

async function braveText(query, options, limit) {
  const data = await fetchJson(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
    options,
    { headers: { ...BROWSER_HEADERS, "X-Subscription-Token": envValue("BRAVE_SEARCH_API_KEY") } }
  );
  return (data.web?.results || []).map((x) => normaliseTextResult(x, "brave")).slice(0, limit);
}

async function serpApiText(query, options, limit) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(limit));
  url.searchParams.set("api_key", envValue("SERPAPI_KEY"));
  const data = await fetchJson(url.toString(), options);
  return (data.organic_results || []).map((x) => normaliseTextResult(x, "serpapi")).slice(0, limit);
}

async function googleCseText(query, options, limit) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", envValue("GOOGLE_CSE_KEY"));
  url.searchParams.set("cx", envValue("GOOGLE_CSE_CX"));
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(limit));
  const data = await fetchJson(url.toString(), options);
  return (data.items || []).map((x) => normaliseTextResult(x, "google_cse")).slice(0, limit);
}

async function searchText(query, options, limit = 5, diag) {
  if (typeof options.searchText === "function") {
    return options.searchText(query, { limit, diag });
  }
  if (options.noCrossReference) return [];
  const providers = [];
  if (envValue("SERPER_API_KEY")) providers.push(["serper", serperText]);
  if (envValue("TAVILY_API_KEY")) providers.push(["tavily", tavilyText]);
  if (envValue("BRAVE_SEARCH_API_KEY")) providers.push(["brave", braveText]);
  if (envValue("SERPAPI_KEY")) providers.push(["serpapi", serpApiText]);
  if (envValue("GOOGLE_CSE_KEY") && envValue("GOOGLE_CSE_CX")) providers.push(["google_cse", googleCseText]);
  providers.push(["duckduckgo", duckDuckGoText]);

  for (const [name, fn] of providers) {
    try {
      const results = await fn(query, options, limit);
      diag?.add("text search", `${name}: ${results.length} result(s)`);
      return results;
    } catch (error) {
      diag?.add("text search", `${name} unavailable: ${error.message}`);
    }
  }
  return [];
}

function normaliseImageResult(item) {
  const image = item.image || item.link || item.thumbnail || item.imageUrl || "";
  if (!/^https?:\/\//i.test(image)) return null;
  return {
    title: stripTags(item.title || ""),
    imageUrl: image,
    pageUrl: String(item.url || item.pageUrl || item.contextLink || item.image?.contextLink || ""),
    source: String(item.source?.name || item.source || ""),
    width: Number(item.width || item.image?.width || 0) || 0,
    height: Number(item.height || item.image?.height || 0) || 0,
  };
}

async function duckDuckGoImages(query, options, limit) {
  const q = encodeURIComponent(query);
  const page = await fetchText(
    `https://duckduckgo.com/?q=${q}&iax=images&ia=images`,
    options
  );
  if (!page.ok) throw new Error(`image search page HTTP ${page.status}`);
  const vqd = (page.text.match(/vqd=["']?([\d-]+)/) || [null])[1];
  if (!vqd) throw new Error("no vqd token in image search page");
  const data = await fetchJson(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${q}&vqd=${vqd}&f=,,,&p=1`,
    options,
    { headers: { ...BROWSER_HEADERS, Referer: "https://duckduckgo.com/" } }
  );
  return (data.results || [])
    .map(normaliseImageResult)
    .filter(Boolean)
    .slice(0, limit);
}

async function serpApiImages(query, options, limit) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", envValue("SERPAPI_KEY"));
  const data = await fetchJson(url.toString(), options);
  return (data.images_results || []).map(normaliseImageResult).filter(Boolean).slice(0, limit);
}

async function googleCseImages(query, options, limit) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", envValue("GOOGLE_CSE_KEY"));
  url.searchParams.set("cx", envValue("GOOGLE_CSE_CX"));
  url.searchParams.set("searchType", "image");
  url.searchParams.set("q", query);
  const data = await fetchJson(url.toString(), options);
  return (data.items || []).map(normaliseImageResult).filter(Boolean).slice(0, limit);
}

async function searchImages(query, options, limit = 5, diag) {
  if (typeof options.searchImages === "function") {
    return options.searchImages(query, { limit, diag });
  }
  const providers = [];
  if (envValue("SERPAPI_KEY")) providers.push(["serpapi", serpApiImages]);
  if (envValue("GOOGLE_CSE_KEY") && envValue("GOOGLE_CSE_CX")) providers.push(["google_cse", googleCseImages]);
  providers.push(["duckduckgo", duckDuckGoImages]);
  for (const [name, fn] of providers) {
    try {
      const results = await fn(query, options, limit);
      diag?.add("image search", `${name}: ${results.length} result(s)`);
      return results;
    } catch (error) {
      diag?.add("image search", `${name} unavailable: ${error.message}`);
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
 // RSS discovery + parsing
 // ---------------------------------------------------------------------------

function parseInput(input) {
  const value = collapse(input || DEFAULT_URL);
  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value);
    const last = parsed.pathname.split("/").filter(Boolean).pop() || "";
    const slug = last
      .replace(/-[a-f0-9]{6,}$/i, "")
      .replace(/\.[a-z]+$/i, "");
    return { kind: "url", value, slug, url: value };
  }
  return { kind: "title", value, slug: "", url: null };
}

export function parseSlugSignals(input) {
  const base = parseInput(input);
  const tokens = base.slug
    .split(/[-_]+/)
    .map(decodeEntities)
    .filter((token) => token && !STOP_SLUG_TOKENS.has(token.toLowerCase()) && !/^[a-f0-9]{6,}$/i.test(token))
    .map((token) => token.replace(/\b([sc])\b/gi, "$1"));

  const stopIndex = tokens.findIndex((token) => /^(?:job|jobs|vacancy|vacancies)$/i.test(token));
  const orgTokens = stopIndex > 0 ? tokens.slice(0, stopIndex) : tokens.slice(0, 4);
  const orgFromSlug = orgTokens
    .join(" ")
    .replace(/\bs\s+c\b/i, "S.C")
    .replace(/\bsc\b/i, "S.C")
    .replace(/\s+/g, " ")
    .trim();

  return {
    ...base,
    tokens,
    orgFromSlug: orgFromSlug ? titleCase(orgFromSlug).replace(/\bS\.c\b/g, "S.C") : "",
  };
}

function rssTag(block, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
  if (!m) return "";
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(m[1]);
  return decodeEntities(cdata ? cdata[1] : m[1]).trim();
}

export function parseRssItems(xml) {
  const items = [];
  for (const m of String(xml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    items.push({
      title: rssTag(block, "title"),
      link: rssTag(block, "link"),
      description: rssTag(block, "description"),
      guid: rssTag(block, "guid"),
      pubDate: rssTag(block, "pubDate"),
      categories: [...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)].map((x) => stripTags(x[1])),
    });
  }
  return items;
}

function titleTokens(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_SLUG_TOKENS.has(token));
}

/** Punctuation-insensitive phrase used to break ties between similar titles. */
function normalisePhrase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findRssItem(input, items, signals, diag) {
  if (signals.kind === "url" && signals.slug) {
    const exact = items.find((item) =>
      item.link.includes(signals.slug) || item.guid.includes(signals.slug)
    );
    if (exact) {
      diag?.match("RSS item by URL slug", true, exact.title.slice(0, 110));
      return exact;
    }
  }

  const query = signals.kind === "title" ? signals.value : signals.slug;
  const wanted = titleTokens(query);
  const phrase = normalisePhrase(query);
  const scored = items
    .map((item) => {
      const have = new Set(titleTokens(item.title));
      const overlap = wanted.filter((token) => have.has(token)).length;
      // A title that contains the whole search phrase wins over another
      // listing sharing the same tokens (e.g. two "Bank ... 3 Positions" posts).
      const phraseBonus = phrase && normalisePhrase(item.title).includes(phrase) ? 0.5 : 0;
      return { item, score: overlap / Math.max(1, wanted.length) + phraseBonus };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.score >= 0.5) {
    diag?.match("RSS item by title", true, `${best.item.title.slice(0, 110)} (${(best.score * 100).toFixed(0)}%)`);
    return best.item;
  }
  diag?.match("RSS item", false, "no confident match in the public feed");
  return null;
}

// ---------------------------------------------------------------------------
 // Employer content reconstruction
 // ---------------------------------------------------------------------------

/** Remove the feed's serialization artefacts without rewriting employer words. */
export function cleanRssDescription(raw, diag) {
  const logger = diag || { add() {} };
  let html = String(raw || "").trim();
  html = html.replace(/>\s*<br\s*\/?>\s*</gi, ">\n<");
  html = html.replace(/<br\s*\/?>/gi, "\n");
  html = html.replace(/^<p>\s*<p>/i, "<p>");
  html = html.replace(/<\/p>\s*<\/p>\s*$/i, "</p>");
  html = html.replace(
    /<(script|style|noscript|iframe|object|embed|template|form|button)\b[^>]*>[\s\S]*?<\/\1>/gi,
    () => {
      diag?.add("description cleaned", "removed script/embedded block");
      return " ";
    }
  );
  html = stripNoisyElements(html, logger);
  const cleaned = sanitizeCardDescription(html, "https://etcareers.com/", logger);
  diag?.add("description from RSS", `${cleaned.length} chars of employer content`);
  return cleaned;
}

function extractLabelledValue(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:<strong[^>]*>\\s*)?${escaped}\\s*:\\s*(?:<\\/strong>)?\\s*([^<\\n]+)`,
    "i"
  );
  const value = collapse(stripTags(re.exec(html)?.[1] || ""));
  return value || null;
}

function extractPositions(html) {
  const fromHeadings = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)]
    .map((m) => stripTags(m[1]).replace(/^\d+\.\s*/, ""))
    .filter(Boolean);
  if (fromHeadings.length) return fromHeadings;

  const sentence = /available positions are\s+([^.]+)/i.exec(stripTags(html))?.[1] || "";
  if (!sentence) return [];
  return sentence
    .split(/,|\s+and\s+/i)
    .map((part) => collapse(part).replace(/[.;:]+$/, ""))
    .filter(Boolean);
}

function organisationFromFeedTitle(title) {
  const parts = String(title || "").split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2];
  return "";
}

function jobTitleFromFeedTitle(title) {
  return String(title || "")
    .replace(/\s+-\s+[^-]+\s+-\s+[^-]+\s*$/, "")
    .trim();
}

/**
 * Some employers publish the application address as plain text instead of a
 * mailto anchor (for example "Email: hr@example.org"). Only accept it when the
 * surrounding text is clearly an application instruction, never a generic
 * contact/enquiry mailbox.
 */
function extractPlaintextApplyEmail(text, diag) {
  const value = collapse(text);
  let best = null;
  for (const match of value.matchAll(EMAIL_RE)) {
    const email = match[0].replace(/[.,;:!?)\]]+$/, "").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) continue;

    const before = value.slice(Math.max(0, match.index - 220), match.index);
    const after = value.slice(match.index, Math.min(value.length, match.index + 140));
    const recent = before.slice(-120);
    const applicationWords = /\b(?:apply|application|applications|applicant|applicants|submit|submitted|submission|send|sent|cv|resume)\b/i;
    const contactOnly = /\b(?:contact|inquir(?:y|ies)|enquir(?:y|ies)|question|complaint|customer\s+service|information\s+only)\b/i;
    if (contactOnly.test(recent) && !applicationWords.test(recent)) continue;

    let score = 0;
    if (/(?:^|[\s>])(?:e-?mail|apply(?:\s+via\s+email)?|submission\s+email)\s*[:\-]\s*$/i.test(before.trim())) {
      score += 60;
    }
    if (applicationWords.test(`${before} ${after}`)) score += 35;
    if (/\b(?:to|at|via|using)\s+$/i.test(before.slice(-40))) score += 35;
    if (/^(?:hr|hrm|recruit|jobs?|careers?|vacancy)/i.test(email.split("@")[0])) score += 10;
    if (contactOnly.test(`${before} ${after}`)) score -= 50;

    if (score >= 70 && (!best || score > best.score)) best = { email, score };
  }
  diag?.add("direct apply email", best ? `${best.email} (plain text, score ${best.score})` : "none");
  return best ? `mailto:${best.email}` : null;
}

function extractApplyUrl(descriptionHtml, pageUrl, diag) {
  const candidates = [];
  for (const m of descriptionHtml.matchAll(ANCHOR_RE)) {
    const attrs = parseAttributes(m[1]);
    const href = String(attrs.href || "").trim();
    if (!href) continue;
    // The "Application Link:" label often sits just before a bare-URL anchor,
    // so include nearby preceding text when scoring the destination.
    const before = stripTags(descriptionHtml.slice(0, m.index)).slice(-140);
    const label = `${stripTags(m[2])} ${before}`;
    const host = hostOf(/^mailto:/i.test(href) ? "" : href);
    if (BOARD_HOST_RE.test(host) || SOCIAL_HOST_RE.test(host)) {
      diag?.add("apply URL", `rejected board/social link ${href}`);
      continue;
    }
    let score = 0;
    if (/^mailto:/i.test(href)) score += 40;
    else if (/^https?:\/\//i.test(href)) score += 20;
    else continue;
    if (/\b(?:apply|application|online|form|submit|register)\b/i.test(label)) score += 35;
    if (/forms\.gle|rb\.gy|bit\.ly|tinyurl\.com|is\.gd|ow\.ly|cutt\.ly|careers|apply|application|recruit|talent/i.test(href)) score += 35;
    if (score >= 55) candidates.push({ href, label, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates[0] || null;
  let cleaned = chosen ? cleanApplyUrl(chosen.href, pageUrl) : null;
  if (!cleaned) {
    cleaned = extractPlaintextApplyEmail(stripTags(descriptionHtml), diag);
  }
  diag?.match("direct apply URL", !!cleaned, cleaned || "none (no employer-provided destination)");
  return cleaned;
}

function applyButtonHtml(url) {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="apply-now-btn">Apply Now</a>`;
}

async function crossReference(item, signals, positions, options, diag) {
  if (options.noCrossReference) {
    diag?.add("cross-reference", "skipped (--no-cross-reference)");
    return 0;
  }
  const org = organisationFromFeedTitle(item.title) || signals.orgFromSlug;
  const queries = [
    `site:etcareers.com "${org}" "${jobTitleFromFeedTitle(item.title)}"`,
    positions.length
      ? `site:etcareers.com "${org}" ${positions.map((p) => `"${p}"`).join(" ")}`
      : `site:etcareers.com "${org}" Ethiopia`,
  ];
  const haystack = titleTokens(`${item.title} ${item.description}`);
  let matches = 0;
  let total = 0;
  for (const query of queries) {
    const results = await searchText(query, options, 5, diag);
    for (const result of results) {
      total += 1;
      const snippetTokens = titleTokens(`${result.title} ${result.snippet}`);
      if (snippetTokens.some((token) => haystack.includes(token))) matches += 1;
    }
  }
  diag?.add("cross-reference", `${matches} matching indexed snippet(s) of ${total}`);
  return matches;
}

async function fetchLogo(orgName, pageUrl, options, diag) {
  // A batch caller can resolve logos from its own cache (for example an
  // already-verified employer-directory row) without changing the seven-field
  // output contract of extractHeadlessJob.
  if (typeof options.resolveOrgLogo === "function") {
    return options.resolveOrgLogo(orgName, pageUrl, options, diag);
  }
  const results = await searchImages(
    `${orgName} Ethiopia official logo png`,
    options,
    Number(options.maxSearchResults) || 5,
    diag
  );
  return resolve_org_logo(orgName, "", pageUrl, {
    diag,
    quiet: options.quiet,
    headerHtml: "",
    assetsDir: options.assetsDir || path.resolve(REPO_ROOT, "assets/logos"),
    allowGlobalSearch: true,
    maxSearchResults: results.length,
    searchImages: async () => results,
    downloadImage: options.downloadImage,
  });
}

// ---------------------------------------------------------------------------
 // Orchestration
 // ---------------------------------------------------------------------------

export async function extractHeadlessJob(input, options = {}) {
  const diag = options.diag || new Diagnostics(options.quiet);
  const signals = parseSlugSignals(input);
  diag.section("ZERO-VISIT QUERY SIGNALS");
  diag.add("input", signals.value);
  diag.add("slug", signals.slug || "(title lookup)");
  diag.add("clean terms", signals.tokens.join(" "));
  diag.add("organisation from slug", signals.orgFromSlug || "(none)");

  const feedUrl = options.feedUrl || DEFAULT_FEED;
  diag.section("PUBLIC FEED (NO JOB PAGE)");
  diag.add("feed", feedUrl);
  const xml = options.rssXml != null
    ? options.rssXml
    : (await fetchText(feedUrl, options, {}, 60000)).text;
  diag.add("feed bytes", String(xml.length));
  const items = parseRssItems(xml);
  diag.match("RSS items", items.length > 0, `${items.length} listings`);
  const item = findRssItem(signals.value, items, signals, diag);
  if (!item) throw new Error("No matching job found in the public RSS feed");

  diag.section("EMPLOYER CONTENT FROM FEED");
  const title = jobTitleFromFeedTitle(item.title) || stripTags(item.title);
  const descriptionHtml = cleanRssDescription(item.description, diag);
  const orgName =
    extractLabelledValue(descriptionHtml, "Hiring Organization") ||
    organisationFromFeedTitle(item.title) ||
    signals.orgFromSlug;
  const positions = extractPositions(descriptionHtml);
  const location = extractLabelledValue(descriptionHtml, "Job Location");
  const employmentType = extractLabelledValue(descriptionHtml, "Employment Type");
  const deadline = extractLabelledValue(descriptionHtml, "Application Deadline");
  diag.match("title", !!title, title);
  diag.match("organization", !!orgName, orgName || "");
  diag.match("positions", positions.length > 0, positions.join(" | "));
  diag.add("locations", location || "none");
  diag.add("employment type", employmentType || "none");
  diag.add("deadline", deadline || "none");

  diag.section("SEARCH-INDEX CROSS-REFERENCE");
  await crossReference(item, { ...signals, orgFromSlug: orgName }, positions, options, diag);

  diag.section("DIRECT APPLICATION URL");
  const directApplyUrl = extractApplyUrl(descriptionHtml, item.link, diag);

  diag.section("ORGANIZATION LOGO (GLOBAL SEARCH ONLY)");
  const logo = await fetchLogo(orgName, item.link, options, diag);

  diag.section("ZERO-VISIT AUDIT");
  diag.add("job detail page requests", "0 (guard enforced)");
  const hosts = [...new Set((options.networkLog || []).map((url) => hostOf(url)).filter(Boolean))];
  diag.add("fetched hosts", hosts.join(", ") || "injected/offline");

  return {
    title,
    org_name: orgName,
    logo_local_path: logo.logo_local_path,
    logo_url: logo.logo_url,
    description_html: descriptionHtml,
    direct_apply_url: directApplyUrl,
    apply_button_html: directApplyUrl ? applyButtonHtml(directApplyUrl) : null,
  };
}

// ---------------------------------------------------------------------------
 // CLI
 // ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    input: DEFAULT_URL,
    out: path.resolve(REPO_ROOT, "job_post.json"),
    htmlOut: path.resolve(REPO_ROOT, "embed_card.html"),
    assetsDir: path.resolve(REPO_ROOT, "assets/logos"),
    feedUrl: DEFAULT_FEED,
    noCrossReference: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") opts.out = path.resolve(argv[++i]);
    else if (arg === "--html-out") opts.htmlOut = path.resolve(argv[++i]);
    else if (arg === "--assets-dir") opts.assetsDir = path.resolve(argv[++i]);
    else if (arg === "--feed") opts.feedUrl = argv[++i];
    else if (arg === "--no-cross-reference") opts.noCrossReference = true;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg && !arg.startsWith("--")) opts.input = arg;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const diag = new Diagnostics(opts.quiet);
  const networkLog = [];
  try {
    const record = await extractHeadlessJob(opts.input, { ...opts, diag, networkLog });
    const json = `${JSON.stringify(record, null, 2)}\n`;
    writeFileSync(opts.out, json, "utf8");
    writeFileSync(opts.htmlOut, buildPreviewHtml(record), "utf8");
    diag.section("OUTPUT");
    diag.add("JSON", opts.out);
    diag.add("embed HTML", opts.htmlOut);
    process.stdout.write(json);
    diag.print();
  } catch (error) {
    console.error(`[headless-job-fetch] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();

export default extractHeadlessJob;
