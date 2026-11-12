// URL normalisation and job/listing heuristics.

import { isImageUrl, safeParseUrl } from "./hosts.mjs";

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^msclkid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^ref$/i,
  /^referrer$/i,
  /^source$/i,
  /^src$/i,
  /^campaign$/i,
  /^_ga$/i,
  /^yclid$/i,
  /^igshid$/i,
];

const JOB_PATH_RE =
  /\/(job|jobs|vacancy|vacancies|career|careers|position|positions|opening|openings|opportunity|opportunities|announcement|announcements|job-detail|job-details|vacancy-detail|viewjob|apply)(?:[-/_.]|$)/i;

const LISTING_PATH_RE =
  /^\/?(?:jobs?|vacancies|careers?|search|job-search|find-jobs|all-jobs|opportunities|openings)\/?$/i;

const LISTING_QUERY_RE = /(?:^|&)(?:page|p|offset|start|q|query|search|keyword|location|category|sort)=/i;

export function stripTrackingParams(input) {
  const u = safeParseUrl(input);
  if (!u) return null;
  const keep = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (TRACKING_PARAMS.some((re) => re.test(k))) continue;
    keep.push([k, v]);
  }
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  return u;
}

export function normalizeUrl(input, base) {
  const u = stripTrackingParams(input);
  if (!u) {
    const abs = safeParseUrl(input, base);
    if (!abs) return null;
    return normalizeParsed(abs);
  }
  return normalizeParsed(u);
}

function normalizeParsed(u) {
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  u.protocol = "https:";
  if (u.port === "80" || u.port === "443") u.port = "";
  // Collapse duplicate slashes in the path, keep a single trailing slash off.
  u.pathname = u.pathname.replace(/\/{2,}/g, "/");
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  // Sort query parameters for stable dedupe keys.
  const entries = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of entries) u.searchParams.append(k, v);
  return u.toString();
}

export function canonicalUrl(input, base) {
  const n = normalizeUrl(input, base);
  if (!n) return null;
  try {
    const u = new URL(n);
    // Strip common pagination / session params that do not change the job.
    for (const k of [...u.searchParams.keys()]) {
      if (/^(sid|session|sessionid|phpsessid|print|amp|share)$/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return n;
  }
}

export function absolutize(href, base) {
  if (!href) return null;
  const raw = String(href).trim().replace(/^['"]|['"]$/g, "");
  if (!raw || /^(javascript|data|vbscript|file|blob):/i.test(raw)) return null;
  if (raw.startsWith("#")) return null;
  const u = safeParseUrl(raw, base);
  if (!u) return null;
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return u.toString();
}

export function decodeRedirectUrl(href, base) {
  const abs = absolutize(href, base);
  if (!abs) return null;
  let u;
  try {
    u = new URL(abs);
  } catch {
    return null;
  }
  const paramNames = [
    "url", "u", "target", "dest", "destination", "redirect", "redirect_url",
    "redirect_uri", "return", "returnurl", "link", "goto", "out", "to", "r",
  ];
  for (const name of paramNames) {
    const value = u.searchParams.get(name);
    if (!value) continue;
    const decoded = decodeURIComponentSafe(value);
    if (decoded && /^https?:\/\//i.test(decoded)) {
      const inner = safeParseUrl(decoded);
      if (inner) return inner.toString();
    }
    // Some redirectors base64url-encode the target.
    const b64 = decodeBase64Url(value);
    if (b64 && /^https?:\/\//i.test(b64)) {
      const inner = safeParseUrl(b64);
      if (inner) return inner.toString();
    }
  }
  // url.php?id=<base64url> style redirectors.
  const id = u.searchParams.get("id");
  if (id && /(?:url|redirect|link|away|out)\.php$/i.test(u.pathname)) {
    const decoded = decodeBase64Url(id);
    if (decoded && /^https?:\/\//i.test(decoded)) {
      const inner = safeParseUrl(decoded);
      if (inner) return inner.toString();
    }
  }
  return null;
}

export function decodeBase64Url(value) {
  try {
    let b64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
    const out = Buffer.from(b64, "base64").toString("utf8").trim();
    return /^https?:\/\//i.test(out) ? out : null;
  } catch {
    return null;
  }
}

function decodeURIComponentSafe(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function isLikelyJobUrl(input, base) {
  const u = safeParseUrl(input, base);
  if (!u) return false;
  if (isImageUrl(u.toString())) return false;
  if (JOB_PATH_RE.test(u.pathname)) return true;
  // Query-driven detail pages (e.g. vacancy-detail.php?id=123).
  if (/(?:^|[?&])(?:id|jobid|job_id|vacancyid|vacancy_id|postingid)=\d+/i.test(u.search)) return true;
  return false;
}

export function isListingUrl(input, base) {
  const u = safeParseUrl(input, base);
  if (!u) return false;
  if (LISTING_PATH_RE.test(u.pathname)) return true;
  if (LISTING_QUERY_RE.test(u.search) && !isLikelyJobUrl(u.toString())) return true;
  return false;
}

export function isRootUrl(input, base) {
  const u = safeParseUrl(input, base);
  if (!u) return false;
  return u.pathname === "/" && !u.search;
}

export function slugify(value, max = 80) {
  const s = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u1200-\u137f]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return s || "job";
}

export function jobPublicPath(id, title) {
  return `/job/${encodeURIComponent(String(id))}/${slugify(title)}`;
}

export function extractUrlsFromText(text, base) {
  const out = [];
  const re = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
  for (const m of String(text || "").matchAll(re)) {
    const u = absolutize(m[0].replace(/[.,;:]+$/, ""), base);
    if (u) out.push(u);
  }
  return [...new Set(out)];
}
