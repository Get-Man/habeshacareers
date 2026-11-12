// Dereja (dereja.com) source support.
//
// Dereja renders its content client-side through the Next.js App Router, so
// the job records live in the RSC "flight" payload rather than in server
// HTML. Both the listing page and the individual announcement page are read
// through that payload.
//
// Every record carries the real hiring organisation (name, website, logo,
// e-mail) and the employer's own application destination, so Stage B can
// extract a complete vacancy and verify the application link.

import { collectFlightText, decodeFlightPayload, findJobRecords } from "../extract/flight.mjs";
import { canonicalUrl } from "../extract/urls.mjs";
import { collapseWhitespace } from "../extract/html.mjs";

const BASE = "https://www.dereja.com";

/**
 * Resolve a lazily referenced flight record ("$11") into its real value.
 */
export function resolveFlightRefs(payload, records) {
  const map = new Map();
  for (const [id, body] of records.entries()) {
    const value = parseRecord(body);
    if (value != null) map.set(id, value);
  }
  const resolve = (value, depth = 0) => {
    if (depth > 6) return value;
    if (typeof value === "string") {
      const m = /^\$([A-Za-z0-9_]+)$/.exec(value);
      if (!m) return value;
      const target = map.get(m[1]);
      if (target === undefined) return value;
      return resolve(target, depth + 1);
    }
    if (Array.isArray(value)) return value.map((v) => resolve(v, depth + 1));
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = resolve(v, depth + 1);
      return out;
    }
    return value;
  };
  return resolve;
}

function parseRecord(body) {
  const text = String(body || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* not a plain JSON value */
  }
  const rows = [];
  let rest = text;
  while (rest.length) {
    const m = /^(\w+):/.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
    const value = readJson(rest);
    if (!value) break;
    rows.push(value.parsed);
    rest = rest.slice(value.length);
  }
  return rows.length ? rows : null;
}

function readJson(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return { parsed: JSON.parse(text.slice(0, i + 1)), length: i + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Split a decoded flight payload into "<id>:<body>" records.
 */
function flightRecords(payload) {
  const text = String(payload || "");
  const records = new Map();
  const re = /(?:^|\n)(\w+):/g;
  const marks = [];
  for (const m of text.matchAll(re)) marks.push({ id: m[1], start: m.index + m[0].length - m[1].length - 1 });
  for (let i = 0; i < marks.length; i += 1) {
    const from = marks[i].start + marks[i].id.length + 1;
    const to = i + 1 < marks.length ? marks[i + 1].start : text.length;
    records.set(marks[i].id, text.slice(from, to).trim());
  }
  return records;
}

/**
 * Read the job records out of a dereja page (listing or announcement).
 */
export function extractDerejaRecords(payload) {
  const decoded = decodeFlightPayload(payload);
  if (!decoded) return [];
  const records = flightRecords(decoded);
  const resolve = resolveFlightRefs(decoded, records);
  const found = findJobRecords(decoded, { requiredKeys: ["slug"], limit: 400 });
  const out = [];
  const seen = new Set();
  for (const raw of found) {
    const job = resolve(raw);
    if (!job || !job.slug) continue;
    if (seen.has(job.slug)) continue;
    seen.add(job.slug);
    out.push(job);
  }
  return out;
}

/**
 * Convert a dereja job record into the shape the extraction pipeline expects.
 */
export function derejaJobToListing(job, { pageUrl = "" } = {}) {
  const company = job.company && typeof job.company === "object" ? job.company : {};
  const url = `${BASE}/jobs/${job.slug}`;
  const description = typeof job.description === "string" ? job.description : "";
  const requirement = typeof job.requirement === "string" ? job.requirement : "";
  const howToApply = typeof job.how_to_apply === "string" ? job.how_to_apply : "";
  const location = [job.city, job.country, job.state].filter(Boolean).join(", ");
  const deadline = job.date_expiry ? String(job.date_expiry).slice(0, 10) : null;

  // The employer uploaded its logo to the platform's asset store.
  const logoPath = typeof company.logo === "string" ? company.logo : null;

  return {
    url: canonicalUrl(url) || url,
    externalId: job.id || job.slug,
    title: collapseWhitespace(String(job.title || "")),
    company: collapseWhitespace(String(company.name || "")),
    companyWebsite: company.website ? String(company.website) : null,
    companyEmail: company.email || null,
    companyLogo: logoPath,
    description,
    requirements: requirement,
    howToApply,
    applyUrl: job.career_page_link || null,
    location,
    deadline,
    jobType: Array.isArray(job.type_name) ? job.type_name.join(", ") : job.type_name || null,
    category: Array.isArray(job.catalog_names) ? job.catalog_names.join(", ") : job.catalog_names || null,
    pageUrl: pageUrl || url,
    raw: job,
  };
}

/**
 * Stage A: discover individual announcement URLs from the listing page.
 */
export async function discoverDerejaJobs(ctx, source, { page = 1, limit = 12 } = {}) {
  const listingUrl = source?.fetch_config?.listingUrl || `${BASE}/jobs?type=job`;
  const target = new URL(listingUrl);
  target.searchParams.set("type", "job");
  if (page > 1) target.searchParams.set("page", String(page));

  const res = await ctx.fetchText(target.toString(), {
    timeoutMs: 20000,
    maxBytes: 4_000_000,
    respectRobots: true,
    retries: 1,
    headers: { RSC: "1", Accept: "text/x-component,*/*" },
  });
  if (!res?.ok) throw new Error(`dereja_discovery_failed:${res?.error || res?.status || "unknown"}`);

  const records = extractDerejaRecords(res.text);
  const urls = records.map((job) => ({
    url: canonicalUrl(`${BASE}/jobs/${job.slug}`) || `${BASE}/jobs/${job.slug}`,
    listingPageUrl: target.toString(),
    externalId: job.slug,
  }));

  // Page size is fixed by the site; the caller advances the cursor.
  const consumed = (page - 1) * Math.max(urls.length, 1) + urls.length;
  return {
    urls,
    totalFound: null,
    nextOffset: consumed,
    done: urls.length === 0,
    mode: "flight-rsc",
    fetched: urls.length,
    listingPageUrl: target.toString(),
  };
}
