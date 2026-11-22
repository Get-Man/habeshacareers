#!/usr/bin/env node
/**
 * ETcareers embeddable job-card extractor
 * ---------------------------------------
 *
 * Fetches one ETcareers job URL and returns only the pieces needed to render
 * the employer's vacancy on another site:
 *
 *   title, org_name, description_html, direct_apply_url, apply_button_html,
 *   logo_url, logo_source, logo_local_path
 *
 * It never emits ETcareers navigation, breadcrumbs, share widgets, Telegram
 * promos, related jobs or footer chrome. Logos are resolved in three steps:
 * the verified employer header image, a global image-search fallback, then a
 * favicon/Apple-touch-icon on a domain actually found in the page or search
 * results. Every accepted image is downloaded into ./assets/logos so the card
 * never hotlinks a third-party host.
 *
 * Usage
 *   node scripts/etcareers-embed.mjs [URL] [options]
 *
 * Options
 *   --out <file>          JSON output (default job_output.json)
 *   --preview <file>      standalone preview HTML (default preview.html)
 *   --assets-dir <dir>    local logo directory (default assets/logos)
 *   --html <file>         extract from saved HTML instead of the network
 *   --force-browser       use the optional headless-browser fetch path
 *   --no-logo-search      skip global search + favicon fallback
 *   --quiet               suppress diagnostics on stderr
 *
 * stdout: the exact JSON object
 * stderr: selector, logo and application diagnostics
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANCHOR_RE,
  IMG_RE,
  BOARD_HOST_RE,
  SOCIAL_HOST_RE,
  Diagnostics,
  fetchPage,
  extractHeader,
  extractOrganization,
  extractDescription,
  extractApplication,
  imageSources,
  parseAttributes,
  collapse,
  toLines,
  absoluteUrl,
  hostOf,
  companyTokens,
  applyButtonHtml,
} from "./etcareers-scraper.mjs";
import { slugify } from "../lib/jobs/extract/urls.mjs";
import { isKnownSourceDomain } from "../lib/jobs/extract/hosts.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_URL =
  "https://etcareers.com/jobs/zamzam-bank-s-c-job-vacancy-2026-3-positions-in-ethiopia-f7206e1b";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://duckduckgo.com/",
};

const TRACKING_PARAM_RE =
  /^(?:utm_|fbclid$|gclid$|dclid$|msclkid$|mc_[ce]id$|yclid$|igshid$|ref$|referrer$|source$|src$|campaign$|_ga$)/i;

const GENERIC_IMAGE_RE =
  /(?:stock|shutterstock|getty|istock|freepik|watermark|logo\s*maker|template|icon\s*set|vector\s*free|pngtree|dreamstime|clip\s*art|googlelogo|google\s*logo|google\s*wordmark|gstatic|duckduckgo|bing\s*logo|yahoo\s*logo|facebook\s*logo|twitter\s*logo|linkedin\s*logo)/i;

// ETcareers appends a Telegram "Join @Etcareersjobs for Daily Job Updates &
// Share with Friends" footer to every RSS description. The link itself is
// stripped by the anchor sanitiser, but the plain-text invitation survives and
// is not employer content. Remove the whole promo paragraph.
const SOURCE_PROMO_BLOCK_RE =
  /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?(?:etcareersjobs|daily\s+job\s+(?:updates|alerts)|share\s+with\s+friends|t\.me\/etcareersjobs|get\s+daily\s+job\s+alerts)(?:(?!<\/p>)[\s\S])*?<\/p>/gi;
const SOURCE_PROMO_TEXT_RE =
  /📲\s*|(?:join|get)\s+(?:on\s+telegram|@?etcareersjobs|daily\s+job\s+(?:updates|alerts))[^\n<>]*(?:daily\s+job\s+(?:updates|alerts)|share\s+with\s+friends|job\s+alerts?)?[^\n<>]*/gi;

// The feed also appends a self-attribution notice ("ETcareers publishes job
// opportunities for informational purposes…"). It is board boilerplate, not
// employer content, and must never reach a public vacancy.
const SOURCE_NOTICE_BLOCK_RE =
  /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?etcareers\s+publishes(?:(?!<\/p>)[\s\S])*?<\/p>/gi;
const SOURCE_NOTICE_TEXT_RE =
  /(?:important\s+notice\s*:\s*)?etcareers\s+publishes[^\n<>]*/gi;

// A search hit may be a real photo from the employer's site but still not be
// its logo. Editorial and promotional imagery is never a verified brand mark.
const NON_LOGO_IMAGE_RE =
  /(?:press[ _-]?release|press[ _-]?statement|annual\s*report|report[ _-]?on|newsletter|news[ _-]?article|article|video|still001|screenshot|conference|gallery|photo\s*gallery|wallpaper|infographic|advertis|promo(?:tion|tional)?[ _-]?image|job[ _-]?(?:vacancy|opening|posting)|vacancy|recruitment|hiring|apply\s*now|career\s*fair)/i;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38]);
const WEBP_MAGIC = Buffer.from([0x57, 0x45, 0x42, 0x50]);

// ---------------------------------------------------------------------------
 // General helpers
 // ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function toPosix(value) {
  return String(value).replace(/\\/g, "/");
}

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
    // No .env file is required; DuckDuckGo works without credentials.
  }
  return cachedDotEnv;
}

function envValue(name) {
  if (process.env[name] != null && process.env[name] !== "") return process.env[name];
  return readDotEnv()[name] || "";
}

async function fetchText(url, headers = BROWSER_HEADERS, timeout = 15000) {
  const res = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  return { ok: res.ok, status: res.status, text: await res.text(), url: res.url || url };
}

async function fetchJson(url, headers = BROWSER_HEADERS, timeout = 15000) {
  const res = await fetchText(url, headers, timeout);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.text);
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
 // Application URL
 // ---------------------------------------------------------------------------

/** Strip tracking parameters without changing the employer's destination. */
export function cleanApplyUrl(raw, pageUrl) {
  const value = decodeSafe(String(raw || "").trim());
  if (!value) return null;
  if (/^mailto:/i.test(value)) return value;
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value, pageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM_RE.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    const cleaned = parsed.toString();
    if (BOARD_HOST_RE.test(hostOf(cleaned))) return null;
    if (pageUrl && hostOf(cleaned) === hostOf(pageUrl)) return null;
    return cleaned;
  } catch {
    return null;
  }
}

/**
 * Remove ETcareers links and tracking artefacts from the exact description
 * markup. External employer links (including forms.gle) are left verbatim.
 */
export function sanitizeCardDescription(descriptionHtml, pageUrl, diag) {
  let html = String(descriptionHtml || "");

  html = html.replace(
    /<(script|style|noscript|iframe|object|embed|template|form|button)\b[^>]*>[\s\S]*?<\/\1>/gi,
    () => {
      diag?.add("description sanitised", "removed script/style/embedded block");
      return " ";
    }
  );

  // Strip the discovery source's Telegram promo and self-attribution notice
  // before any link unwrapping.
  html = html.replace(SOURCE_PROMO_BLOCK_RE, () => {
    diag?.add("description sanitised", "removed discovery-source Telegram promo");
    return " ";
  });
  html = html.replace(SOURCE_NOTICE_BLOCK_RE, () => {
    diag?.add("description sanitised", "removed discovery-source attribution notice");
    return " ";
  });

  html = html.replace(IMG_RE, (full, rawAttrs) => {
    const attrs = parseAttributes(rawAttrs);
    const raw = attrs.src || attrs["data-src"] || attrs["data-lazy-src"] || attrs.srcset || "";
    const resolved = absoluteUrl(String(raw).split(/\s+/)[0], pageUrl);
    const internal = BOARD_HOST_RE.test(hostOf(resolved)) ||
      (resolved && pageUrl && hostOf(resolved) === hostOf(pageUrl));
    if (internal || /utm_|etcareers|telegram|\bshare\b/i.test(full)) {
      diag?.add("description sanitised", `removed tracking/internal image ${String(raw).slice(0, 90)}`);
      return " ";
    }
    return full;
  });

  html = html.replace(ANCHOR_RE, (full, rawAttrs, body) => {
    const attrs = parseAttributes(rawAttrs);
    const href = String(attrs.href || "").trim();
    const resolved = href ? absoluteUrl(href, pageUrl) : null;
    const host = resolved ? hostOf(resolved) : "";
    const shareAttrs = `${attrs.class || ""} ${attrs.id || ""} ${attrs["aria-label"] || ""}`;

    // Relative hrefs resolve back to the ETcareers page; keep the employer's
    // words but detach them from the portal.
    if (BOARD_HOST_RE.test(host) || (pageUrl && host === hostOf(pageUrl)) || /^(?:#|\/(?!\/))/i.test(href)) {
      diag?.add("description sanitised", `unwrapped internal link ${href || "(relative)"}`);
      return body;
    }
    if (SOCIAL_HOST_RE.test(host) || /\b(?:share|tweet|telegram|follow)\b/i.test(shareAttrs)) {
      diag?.add("description sanitised", `removed social/share link ${href}`);
      return " ";
    }
    return full;
  });

  // A promo that was not wrapped in a paragraph (or whose anchor was stripped
  // first) still leaves a bare invitation line — remove it as text.
  html = html.replace(SOURCE_PROMO_TEXT_RE, () => {
    diag?.add("description sanitised", "removed discovery-source promo text");
    return " ";
  });
  html = html.replace(SOURCE_NOTICE_TEXT_RE, () => {
    diag?.add("description sanitised", "removed discovery-source attribution text");
    return " ";
  });

  // Some feeds prepend a plain-text board banner ("ETcareers.com – Jobs in
  // Ethiopia") or append a "Find the latest vacancies… at ETcareers.com" line.
  // These are not employer words and must never be published as job content.
  const beforeBrandLines = html;
  html = html
    .split("\n")
    .filter((line) => !/\betcareers(?:\.com)?\b/i.test(line))
    .join("\n");
  if (html !== beforeBrandLines) {
    diag?.add("description sanitised", "removed discovery-source brand lines");
  }

  return html.trim();
}

// ---------------------------------------------------------------------------
 // Image search + validation
 // ---------------------------------------------------------------------------

function normaliseSearchResult(item, provider) {
  const image = item.image || item.link || item.thumbnail || item.imageUrl || item.original || "";
  const pageUrl = item.pageUrl || item.url || item.contextLink ||
    item.image?.contextLink || item.source?.url || "";
  if (!image || !/^https?:\/\//i.test(image)) return null;
  const width = Number(item.width || item.image?.width || 0) || 0;
  const height = Number(item.height || item.image?.height || 0) || 0;
  return {
    provider,
    title: String(item.title || item.name || ""),
    imageUrl: image,
    pageUrl: String(pageUrl || ""),
    source: String(item.source?.name || item.source || ""),
    width,
    height,
  };
}

async function duckDuckGoImages(query, limit, diag) {
  const q = encodeURIComponent(query);
  const page = await fetchText(`https://duckduckgo.com/?q=${q}&iax=images&ia=images`);
  if (!page.ok) throw new Error(`search page HTTP ${page.status}`);
  const vqd = (page.text.match(/vqd=["']?([\d-]+)/) || [null])[1];
  if (!vqd) throw new Error("no vqd token in search page");

  const data = await fetchJson(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${q}&vqd=${vqd}&f=,,,&p=1`,
    { ...BROWSER_HEADERS, Referer: "https://duckduckgo.com/" }
  );
  const results = (data.results || [])
    .map((item) => normaliseSearchResult(item, "duckduckgo"))
    .filter(Boolean)
    .slice(0, limit);
  diag?.add("global image search", `duckduckgo returned ${results.length} usable result(s)`);
  return results;
}

async function serpApiImages(query, limit, diag) {
  const key = envValue("SERPAPI_KEY");
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  const data = await fetchJson(url.toString());
  const results = (data.images_results || [])
    .map((item) => normaliseSearchResult(item, "serpapi"))
    .filter(Boolean)
    .slice(0, limit);
  diag?.add("global image search", `serpapi returned ${results.length} usable result(s)`);
  return results;
}

async function googleCseImages(query, limit, diag) {
  const key = envValue("GOOGLE_CSE_KEY");
  const cx = envValue("GOOGLE_CSE_CX");
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("q", query);
  const data = await fetchJson(url.toString());
  const results = (data.items || [])
    .map((item) => normaliseSearchResult(item, "google_cse"))
    .filter(Boolean)
    .slice(0, limit);
  diag?.add("global image search", `google_cse returned ${results.length} usable result(s)`);
  return results;
}

async function globalImageSearch(query, limit, diag) {
  const attempts = [];
  if (envValue("SERPAPI_KEY")) attempts.push(["serpapi", serpApiImages]);
  if (envValue("GOOGLE_CSE_KEY") && envValue("GOOGLE_CSE_CX")) attempts.push(["google_cse", googleCseImages]);
  attempts.push(["duckduckgo", duckDuckGoImages]);

  for (const [name, fn] of attempts) {
    try {
      return await fn(query, limit, diag);
    } catch (error) {
      diag?.add("global image search", `${name} failed: ${error.message}`);
    }
  }
  return [];
}

function imageDimensions(bytes, ext) {
  try {
    if (ext === "png" && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (ext === "gif" && bytes.length >= 10) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (ext === "webp" && bytes.length >= 30) {
      const format = bytes.toString("ascii", 12, 16);
      if (format === "VP8X") {
        return {
          width: 1 + bytes.readUIntLE(24, 3),
          height: 1 + bytes.readUIntLE(27, 3),
        };
      }
      if (format === "VP8 ") {
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      }
      if (format === "VP8L") {
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
    }
    if (ext === "jpg" && bytes.length >= 16) {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) { i += 1; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
        }
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const size = bytes.readUInt16BE(i + 2);
        if (size < 2) break;
        i += 2 + size;
      }
    }
    if (ext === "svg") {
      const text = bytes.toString("utf8", 0, Math.min(bytes.length, 4096));
      const open = /<svg\b([^>]*)>/i.exec(text)?.[1] || "";
      const width = Number(/\bwidth\s*=\s*["']([\d.]+)/i.exec(open)?.[1]) || 0;
      const height = Number(/\bheight\s*=\s*["']([\d.]+)/i.exec(open)?.[1]) || 0;
      const viewBox = /\bviewBox\s*=\s*["'][^"']*?([\d.]+)\s+([\d.]+)\s*$/i.exec(open);
      return {
        width: width || (viewBox ? Number(viewBox[1]) : 0),
        height: height || (viewBox ? Number(viewBox[2]) : 0),
      };
    }
  } catch {
    /* unreadable metadata is handled by the caller */
  }
  return { width: 0, height: 0 };
}

function looksLikePlaceholderSvg(bytes) {
  const text = bytes.toString("utf8", 0, Math.min(bytes.length, 8192));
  if (/placeholder|default[-_ ]?(?:logo|avatar|image)|no[-_ ]?logo|initials?\b|letter[-_ ]?avatar/i.test(text)) {
    return true;
  }
  const body = text.replace(/<\?[\s\S]*?\?>/g, "").replace(/^\s*<svg\b[^>]*>/i, "");
  const visibleText = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (visibleText && visibleText.length <= 6 && /^[\p{L}\d]{1,6}$/u.test(visibleText)) return true;
  if (!/<(?:path|circle|ellipse|polygon|polyline|rect|image)\b/i.test(body)) return true;
  if (body.length < 180 && /<rect\b/i.test(body) && /<text\b/i.test(body)) return true;
  return false;
}

function validateImageBytes(bytes, contentType = "", url = "", { minSize = 32 } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buffer.length) return { ok: false, reason: "empty response" };
  if (buffer.length < 32) return { ok: false, reason: `only ${buffer.length} bytes` };
  if (buffer.length > 12_000_000) return { ok: false, reason: "image larger than 12 MB" };

  const ct = String(contentType || "").toLowerCase();
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 512));
  let ext = "";

  if (PNG_MAGIC.equals(buffer.subarray(0, 8))) ext = "png";
  else if (GIF_MAGIC.equals(buffer.subarray(0, 4))) ext = "gif";
  else if (buffer.length >= 12 && WEBP_MAGIC.equals(buffer.subarray(8, 12))) ext = "webp";
  else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ext = "jpg";
  else if (/svg/.test(ct) || /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(head)) ext = "svg";
  else if (buffer.toString("ascii", 4, 8) === "ftyp" && /avif|avis/i.test(buffer.toString("ascii", 8, 32))) ext = "avif";

  if (!ext) {
    if (!/^image\//i.test(ct)) return { ok: false, reason: `not an image (${ct || "unknown content-type"})` };
    return { ok: false, reason: "unrecognised image format" };
  }
  // Raster logos are rarely smaller than this; a hand-written SVG often is.
  if (ext !== "svg" && buffer.length < 256) {
    return { ok: false, reason: `only ${buffer.length} bytes` };
  }
  if (ext === "svg" && looksLikePlaceholderSvg(buffer)) {
    return { ok: false, reason: "placeholder/letter SVG" };
  }

  const dims = imageDimensions(buffer, ext);
  if (dims.width && dims.height && (dims.width < minSize || dims.height < minSize)) {
    return { ok: false, reason: `low resolution ${dims.width}x${dims.height}` };
  }
  return { ok: true, ext, url, bytes: buffer.length, ...dims };
}

async function downloadImage(url, options, diag, label) {
  if (!url || !/^https?:\/\//i.test(url)) {
    diag?.add("logo download", `${label}: no HTTP(S) URL`);
    return null;
  }
  try {
    if (typeof options.downloadImage === "function") {
      const result = await options.downloadImage(url, { label });
      if (!result?.ok) diag?.add("logo download", `${label}: ${result?.reason || "rejected by test downloader"}`);
      return result || null;
    }
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: "image/avif,image/webp,image/svg+xml,image/png,image/*,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      diag?.add("logo download", `${label}: HTTP ${res.status}`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get("content-type") || "",
      bytes,
      finalUrl: res.url || url,
    };
  } catch (error) {
    diag?.add("logo download", `${label}: ${error.message}`);
    return null;
  }
}

function saveLogoFile(downloaded, validation, orgName, options) {
  const directory = options.assetsDir
    ? path.resolve(options.assetsDir)
    : path.resolve(REPO_ROOT, "assets/logos");
  const file = path.resolve(directory, `${slugify(orgName || "employer", 80)}.${validation.ext}`);
  if (!options.dryRun) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, downloaded.bytes);
  }
  let localPath = toPosix(path.relative(REPO_ROOT, file));
  if (localPath.startsWith("../")) localPath = toPosix(file);
  return localPath;
}

function isEmployerHeaderLogo(attrs, sources, orgName) {
  const tokens = companyTokens(orgName);
  const alt = collapse(`${attrs.alt || ""} ${attrs.title || ""}`);
  const haystack = `${alt} ${sources.map((s) => decodeSafe(s.value)).join(" ")}`.toLowerCase();
  if (/etcareers|board-logo|site-logo/i.test(haystack) && !tokens.some((t) => haystack.includes(t))) return false;
  return /\blogo\b/i.test(alt) || tokens.some((t) => haystack.includes(t));
}

function searchResultReason(result, orgName) {
  const tokens = companyTokens(orgName);
  const haystack = `${result.title} ${result.source} ${result.imageUrl} ${result.pageUrl}`.toLowerCase();
  if (GENERIC_IMAGE_RE.test(haystack) && !tokens.some((t) => haystack.includes(t))) {
    return "generic stock/watermarked image";
  }
  const imageHost = hostOf(result.imageUrl || "");
  if (imageHost && (isKnownSourceDomain(imageHost) || BOARD_HOST_RE.test(imageHost))) {
    return "discovery-source asset, not an employer logo";
  }
  if (NON_LOGO_IMAGE_RE.test(haystack)) {
    return "editorial/promotional image, not a logo";
  }
  // The employer's name must appear in the image itself or in its label — a
  // merely related page is not enough to call the image that employer's logo.
  const imageLabel = `${decodeSafe(result.imageUrl || "")} ${result.title || ""}`.toLowerCase();
  if (!tokens.some((t) => imageLabel.includes(t))) {
    return "no employer brand signal in the image or its title";
  }
  const { width, height } = result;
  if (width && height && (width < 96 || height < 96)) return `thumbnail too small (${width}x${height})`;
  const ratio = width && height ? width / height : 0;
  if (ratio && (ratio < 0.4 || ratio > 4)) return `extreme aspect ratio ${ratio.toFixed(2)}`;
  return "";
}

function searchResultScore(result, orgName) {
  const tokens = companyTokens(orgName);
  const title = String(result.title || "").toLowerCase();
  const pageHost = hostOf(result.pageUrl || "");
  const imageUrl = String(result.imageUrl || "").toLowerCase();
  let score = 0;
  if (tokens.some((t) => title.includes(t))) score += 30;
  if (tokens.some((t) => pageHost.includes(t))) score += 25;
  if (tokens.some((t) => decodeSafe(imageUrl).includes(t))) score += 20;
  if (/\.(png|webp|svg)(?:\?|$)/i.test(imageUrl)) score += 15;
  if (result.width && result.height) {
    const ratio = result.width / result.height;
    if (ratio >= 0.75 && ratio <= 2.2) score += 20;
    if (result.width >= 256 && result.height >= 256) score += 10;
  }
  return score;
}

function domainMatchesOrg(host, orgName) {
  const tokens = companyTokens(orgName);
  const labels = String(host || "").toLowerCase().split(/\./).filter(Boolean);
  return tokens.some((token) => labels.some((label) => label.includes(token) || token.includes(label)));
}

function collectOfficialDomains(html, orgName, pageUrl, searchResults = []) {
  const found = new Map();
  const add = (url, reason) => {
    const absolute = absoluteUrl(url, pageUrl);
    if (!absolute) return;
    const host = hostOf(absolute);
    if (!host || BOARD_HOST_RE.test(host) || SOCIAL_HOST_RE.test(host)) return;
    if (!domainMatchesOrg(host, orgName)) return;
    if (!found.has(host)) found.set(host, { host, reason });
  };

  for (const m of html.matchAll(ANCHOR_RE)) add(parseAttributes(m[1]).href || "", "page anchor");
  for (const result of searchResults) {
    add(result.pageUrl, "search result source");
    add(result.source, "search result source");
  }
  return [...found.values()].slice(0, 5);
}

function officialIconUrls(host) {
  return [
    `https://${host}/apple-touch-icon.png`,
    `https://${host}/apple-touch-icon-precomposed.png`,
    `https://${host}/favicon.png`,
    `https://${host}/favicon.ico`,
  ];
}

// ---------------------------------------------------------------------------
 // Logo resolver — the requested three-step pipeline
 // ---------------------------------------------------------------------------

/**
 * @param {string} org_name
 * @param {string|{html?: string}} soup  the page HTML (dependency-free "soup")
 * @param {string} page_url
 * @param {object} options  diag, assetsDir, headerHtml, downloadImage,
 *                          searchImages, allowGlobalSearch, dryRun
 */
export async function resolve_org_logo(org_name, soup, page_url, options = {}) {
  const diag = options.diag || new Diagnostics(options.quiet);
  const html = typeof soup === "string"
    ? soup
    : String(soup?.html || soup?.outerHTML || soup || "");
  const headerHtml = options.headerHtml ?? extractHeader(html, diag).headerHtml;
  const result = {
    logo_url: null,
    logo_source: "none",
    logo_local_path: null,
    logo_width: 0,
    logo_height: 0,
  };

  // ---- Step A: employer logo from the job header ----
  diag.section("LOGO RESOLVER — STEP A: ETcareers job header");
  if (!headerHtml) {
    diag.add("primary logo", "no job header container found");
  } else {
    let sawLetterAvatar = false;
    for (const m of headerHtml.matchAll(IMG_RE)) {
      const attrs = parseAttributes(m[1]);
      const sources = imageSources(attrs)
        .map((s) => ({ ...s, value: absoluteUrl(s.value, page_url) }))
        .filter((s) => s.value);
      const label = `${collapse(attrs.alt || attrs.title || "(no alt)")} @ ${sources[0]?.value || "no source"}`;

      if (/board-logo|site-logo|etcareers/i.test(`${attrs.id || ""} ${attrs.class || ""} ${collapse(attrs.alt || "")}`)) {
        diag.candidate(label, false, "ETcareers navbar/board branding");
        continue;
      }
      if (!sources.length) {
        diag.candidate(label, false, "no src/srcset/data-src/background-image source");
        continue;
      }
      if (!isEmployerHeaderLogo(attrs, sources, org_name)) {
        diag.candidate(label, false, "not confidently associated with this employer");
        continue;
      }

      for (const source of sources) {
        const downloaded = await downloadImage(source.value, options, diag, "etcareers header");
        if (!downloaded?.ok) continue;
        const validation = validateImageBytes(downloaded.bytes, downloaded.contentType, downloaded.finalUrl || source.value);
        if (!validation.ok) {
          diag.candidate(`${label} [${source.from}]`, false, validation.reason);
          continue;
        }
        const localPath = saveLogoFile(downloaded, validation, org_name, options);
        diag.candidate(`${label} [${source.from}]`, true, `${validation.ext} ${validation.width}x${validation.height} -> ${localPath}`);
        return {
          logo_url: downloaded.finalUrl || source.value,
          logo_source: "etcareers",
          logo_local_path: localPath,
          logo_width: validation.width || 0,
          logo_height: validation.height || 0,
        };
      }
    }

    const avatar = /<div\b[^>]*>(?:\s*<span\b[^>]*>)?\s*([A-Z0-9]{1,4})\s*(?:<\/span>)?\s*<\/div>/i.exec(headerHtml);
    if (avatar && !/<img\b/i.test(headerHtml)) {
      sawLetterAvatar = true;
      diag.add("primary logo", `letter avatar only ("${avatar[1]}") — rejected as a CSS/initial badge`);
    }
    if (!sawLetterAvatar && !/<img\b/i.test(headerHtml)) diag.add("primary logo", "no <img> in job header");
  }

  if (options.allowGlobalSearch === false) {
    diag.add("logo source", "none (global fallback disabled)");
    return result;
  }

  // ---- Step B: global image search, then official-domain icons ----
  diag.section("LOGO RESOLVER — STEP B: global search fallback");
  const query = `${org_name} Ethiopia official logo png`;
  diag.add("image query", query);
  const limit = Number(options.maxSearchResults) || 5;
  let results = [];
  try {
    results = typeof options.searchImages === "function"
      ? await options.searchImages(query, { orgName: org_name, pageUrl: page_url, diag, limit })
      : await globalImageSearch(query, limit, diag);
  } catch (error) {
    diag.add("global image search", `failed: ${error.message}`);
  }

  const usable = results
    .map((item) => ({ ...item, reason: searchResultReason(item, org_name) }))
    .filter((item) => {
      if (item.reason) {
        diag.candidate(`${item.title || "search result"} @ ${item.imageUrl}`, false, item.reason);
        return false;
      }
      return true;
    })
    .sort((a, b) => searchResultScore(b, org_name) - searchResultScore(a, org_name));

  for (const candidate of usable) {
    const downloaded = await downloadImage(candidate.imageUrl, options, diag, "global search");
    if (!downloaded?.ok) continue;
    const validation = validateImageBytes(
      downloaded.bytes,
      downloaded.contentType,
      downloaded.finalUrl || candidate.imageUrl,
      { minSize: 96 }
    );
    if (!validation.ok) {
      diag.candidate(`${candidate.title} @ ${candidate.imageUrl}`, false, validation.reason);
      continue;
    }
    const localPath = saveLogoFile(downloaded, validation, org_name, options);
    diag.candidate(`${candidate.title} @ ${candidate.imageUrl}`, true, `global logo ${validation.ext} ${validation.width}x${validation.height} -> ${localPath}`);
    return {
      logo_url: downloaded.finalUrl || candidate.imageUrl,
      logo_source: "global_search",
      logo_local_path: localPath,
      logo_width: validation.width || 0,
      logo_height: validation.height || 0,
    };
  }

  diag.section("LOGO RESOLVER — STEP B2: official-domain icon fallback");
  const domains = options.domains || collectOfficialDomains(html, org_name, page_url, results);
  diag.add("official-domain candidates", domains.length ? domains.map((d) => `${d.host} (${d.reason})`).join(" | ") : "none");
  for (const domain of domains) {
    for (const iconUrl of officialIconUrls(domain.host)) {
      const downloaded = await downloadImage(iconUrl, options, diag, "official icon");
      if (!downloaded?.ok) continue;
      const validation = validateImageBytes(
        downloaded.bytes,
        downloaded.contentType,
        downloaded.finalUrl || iconUrl,
        { minSize: 32 }
      );
      if (!validation.ok) {
        diag.candidate(`icon ${iconUrl}`, false, validation.reason);
        continue;
      }
      const localPath = saveLogoFile(downloaded, validation, org_name, options);
      diag.candidate(`icon ${iconUrl}`, true, `${validation.ext} ${validation.width}x${validation.height} -> ${localPath}`);
      return {
        logo_url: downloaded.finalUrl || iconUrl,
        logo_source: "global_search",
        logo_local_path: localPath,
        logo_width: validation.width || 0,
        logo_height: validation.height || 0,
      };
    }
  }

  diag.section("LOGO RESOLVER — RESULT");
  diag.add("logo_source", "none");
  diag.add("logo_local_path", "null (no verified image; no logo invented)");
  return result;
}

export const resolveOrgLogo = resolve_org_logo;

// ---------------------------------------------------------------------------
 // Card extraction + preview
 // ---------------------------------------------------------------------------

export async function extractEtcareersCard(url, options = {}) {
  const diag = options.diag || new Diagnostics(options.quiet);
  let html;
  if (options.html != null) {
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
  const orgName = extractOrganization(headerHtml, diag);

  const logo = await resolve_org_logo(orgName || "", html, url, {
    ...options,
    diag,
    headerHtml,
  });

  const { descriptionHtml: rawDescriptionHtml } = extractDescription(html, diag);
  diag.section("CARD SANITISATION");
  const descriptionHtml = sanitizeCardDescription(rawDescriptionHtml, url, diag);
  const descriptionText = toLines(descriptionHtml);

  const { applyUrl: rawApplyUrl, source: applySource } = await extractApplication(
    html,
    descriptionHtml,
    descriptionText,
    url,
    diag,
    { allowMailto: true }
  );
  const directApplyUrl = cleanApplyUrl(rawApplyUrl, url);
  if (rawApplyUrl && !directApplyUrl) diag.add("apply URL", `rejected unusable destination ${rawApplyUrl}`);
  diag.add("direct_apply_url source", applySource || "none (no verified destination)");

  diag.section("EMBEDDABLE CARD RESULT");
  return {
    title,
    org_name: orgName,
    description_html: descriptionHtml,
    direct_apply_url: directApplyUrl,
    apply_button_html: directApplyUrl ? applyButtonHtml(directApplyUrl) : null,
    logo_url: logo.logo_url,
    logo_source: logo.logo_source,
    logo_local_path: logo.logo_local_path,
  };
}

export function buildPreviewHtml(record) {
  const org = escapeHtml(record.org_name || "Employer");
  const logo = record.logo_local_path
    ? `<img class="org-logo" src="${escapeHtml(record.logo_local_path)}" alt="${org} logo" width="64" height="64">`
    : "";
  const apply = record.apply_button_html || "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(record.title || "Job card")}</title>
<style>
  :root { color-scheme: light; --ink:#12212b; --muted:#5c6d78; --brand:#0f766e; --line:#dde7e6; --bg:#f4f7f7; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 16px; background:var(--bg); color:var(--ink); font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif; }
  .job-card { max-width:760px; margin:0 auto; background:#fff; border:1px solid var(--line); border-radius:18px; padding:28px; box-shadow:0 12px 34px rgba(15,52,50,.08); }
  .card-head { display:flex; gap:16px; align-items:flex-start; border-bottom:1px solid var(--line); padding-bottom:20px; margin-bottom:20px; }
  .org-logo { width:64px; height:64px; object-fit:contain; flex:0 0 auto; border:1px solid var(--line); border-radius:12px; background:#fff; padding:6px; }
  h1 { margin:0 0 6px; font-size:clamp(21px,3vw,28px); line-height:1.25; letter-spacing:-.02em; }
  .org { margin:0; color:var(--muted); font-weight:600; }
  .description h2,.description h3 { margin:24px 0 8px; line-height:1.3; }
  .description p { margin:0 0 14px; }
  .description ul,.description ol { margin:0 0 16px; padding-left:22px; }
  .description li { margin-bottom:7px; }
  .description a { color:var(--brand); text-decoration-thickness:1px; text-underline-offset:2px; }
  .apply-now-btn { display:inline-block; margin-top:22px; padding:12px 22px; border-radius:10px; background:var(--brand); color:#fff; font-weight:700; text-decoration:none; }
  .apply-now-btn:hover { background:#0b5f59; }
  @media (max-width:520px) { body { padding:16px 10px; } .job-card { padding:20px; border-radius:14px; } .card-head { gap:12px; } .org-logo { width:52px; height:52px; } }
</style>
</head>
<body>
  <article class="job-card">
    <header class="card-head">
      ${logo}
      <div>
        <h1>${escapeHtml(record.title || "")}</h1>
        <p class="org">${org}</p>
      </div>
    </header>
    <div class="description">${record.description_html || ""}</div>
    ${apply}
  </article>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
 // CLI
 // ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    url: DEFAULT_URL,
    out: path.resolve(REPO_ROOT, "job_output.json"),
    preview: path.resolve(REPO_ROOT, "preview.html"),
    assetsDir: path.resolve(REPO_ROOT, "assets/logos"),
    htmlFile: null,
    forceBrowser: false,
    allowGlobalSearch: true,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") opts.out = path.resolve(argv[++i]);
    else if (arg === "--preview") opts.preview = path.resolve(argv[++i]);
    else if (arg === "--assets-dir") opts.assetsDir = path.resolve(argv[++i]);
    else if (arg === "--html") opts.htmlFile = path.resolve(argv[++i]);
    else if (arg === "--force-browser") opts.forceBrowser = true;
    else if (arg === "--no-logo-search") opts.allowGlobalSearch = false;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg && !arg.startsWith("--")) opts.url = arg;
    else if (arg === "--help") {
      process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]}*/\n`);
      process.exit(0);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const diag = new Diagnostics(opts.quiet);
  try {
    const record = await extractEtcareersCard(opts.url, { ...opts, diag });
    const json = `${JSON.stringify(record, null, 2)}\n`;
    writeFileSync(opts.out, json, "utf8");
    writeFileSync(opts.preview, buildPreviewHtml(record), "utf8");
    diag.section("OUTPUT");
    diag.add("JSON", opts.out);
    diag.add("preview", opts.preview);
    diag.add("logo_local_path", record.logo_local_path || "null");
    process.stdout.write(json);
    diag.print();
  } catch (error) {
    console.error(`[etcareers-embed] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();

export default extractEtcareersCard;
