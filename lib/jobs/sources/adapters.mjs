// Stage A discovery adapters.
//
// A discovery adapter only finds individual vacancy URLs from listing pages,
// sitemaps, RSS feeds or public APIs. It never extracts job content and never
// treats a listing page as a vacancy.

import { isImageUrl, isKnownSourceDomain, safeParseUrl } from "../extract/hosts.mjs";
import { absolutize, canonicalUrl, isLikelyJobUrl, isListingUrl } from "../extract/urls.mjs";
import { decodeEntities } from "../extract/html.mjs";
import { discoverDerejaJobs } from "./dereja.mjs";

const RESERVED_SEGMENTS = new Set([
  "category", "categories", "location", "locations", "type", "types", "search",
  "page", "company", "companies", "tag", "tags", "author", "feed", "rss",
  "sitemap", "about", "contact", "login", "register", "employer", "employers",
]);

export function xmlDecode(value) {
  return decodeEntities(String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

export function parseSitemap(xml, baseUrl = "") {
  const urls = [];
  const sitemaps = [];
  for (const m of String(xml || "").matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const raw = xmlDecode(m[1]);
    const abs = absolutize(raw, baseUrl) || canonicalUrl(raw, baseUrl);
    if (!abs) continue;
    if (/\.xml(?:$|\?)/i.test(abs) || /sitemap/i.test(abs)) sitemaps.push(abs);
    else urls.push(abs);
  }
  return { urls: [...new Set(urls)], sitemaps: [...new Set(sitemaps)] };
}

export function parseRssItems(xml, baseUrl = "") {
  const items = [];
  for (const m of String(xml || "").matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const block = m[0];
    const atom = /<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*\/?>/i.exec(block);
    const plain = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(block);
    const link = xmlDecode((atom && atom[1]) || (plain && plain[1]) || "");
    const abs = absolutize(link, baseUrl);
    if (!abs) continue;
    const title = xmlDecode((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(block) || [])[1] || "");
    const guid = xmlDecode((/<guid\b[^>]*>([\s\S]*?)<\/guid>/i.exec(block) || [])[1] || "");
    items.push({ url: abs, title, externalId: guid || abs });
  }
  return items;
}

export function extractListingUrls(html, baseUrl, { pattern = null, allowAnySameSite = true } = {}) {
  const out = [];
  const seen = new Set();
  const baseHost = safeParseUrl(baseUrl)?.hostname || "";
  for (const m of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1];
    if (!href) continue;
    const abs = absolutize(href, baseUrl);
    if (!abs) continue;
    if (isImageUrl(abs) || isListingUrl(abs)) continue;
    const u = safeParseUrl(abs);
    if (!u) continue;
    if (baseHost && u.hostname !== baseHost && !pattern) continue;
    const looksJob = pattern ? pattern.test(abs) : isLikelyJobUrl(abs);
    if (!looksJob) {
      if (!allowAnySameSite) continue;
      // Same-site deep links with a numeric/slug id are likely detail pages.
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length < 2) continue;
      if (segments.some((s) => RESERVED_SEGMENTS.has(s.toLowerCase()))) continue;
      if (!/[a-z]{2,}/i.test(segments[segments.length - 1])) continue;
    }
    const key = canonicalUrl(abs) || abs;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function findNextPage(html, baseUrl, currentPage) {
  const candidates = [];
  for (const m of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1];
    if (!href) continue;
    const abs = absolutize(href, baseUrl);
    if (!abs) continue;
    if (!/(?:[?&](?:page|p|pg)=\d+|\/page\/\d+\/?)/i.test(abs)) continue;
    const label = String(m[2] || "").replace(/<[^>]+>/g, " ").trim();
    if (/next|›|»|→/i.test(label) || /\bnext\b/i.test(m[1])) candidates.push({ abs, next: true });
  }
  const explicit = candidates.find((c) => c.next);
  if (explicit) {
    const m = /(?:[?&](?:page|p|pg)=|\/page\/)(\d+)/i.exec(explicit.abs);
    return m ? { url: explicit.abs, page: parseInt(m[1], 10) } : null;
  }
  const expected = currentPage + 1;
  const hasNext = new RegExp(`(?:[?&](?:page|p|pg)=|\\/page\\/)${expected}(?:[&#/]|$)`, "i").test(String(html || ""));
  if (!hasNext) return null;
  try {
    const u = new URL(baseUrl);
    u.searchParams.set("page", String(expected));
    return { url: u.toString(), page: expected };
  } catch {
    return null;
  }
}

function normalizeBatch(limit, offset) {
  const n = Math.max(1, Math.min(50, parseInt(limit || "12", 10) || 12));
  const off = Math.max(0, parseInt(offset || "0", 10) || 0);
  return { limit: n, offset: off };
}

async function fetchOk(ctx, url, opts = {}) {
  const res = await ctx.fetchText(url, opts);
  if (!res || !res.ok) {
    const error = res?.error || `http_${res?.status || 0}`;
    const err = new Error(`discovery_fetch_failed:${error}`);
    err.code = "DISCOVERY_FETCH";
    err.status = res?.status;
    throw err;
  }
  return res;
}

// ---------------------------------------------------------------------------
// Generic sitemap discovery (supports sitemap indexes)
// ---------------------------------------------------------------------------

async function discoverSitemap(ctx, source, { sitemapUrl, pattern, maxChildSitemaps = 6 }) {
  const { limit, offset } = normalizeBatch(ctx.limit, ctx.offset);
  const first = await fetchOk(ctx, sitemapUrl, { timeoutMs: 15000, maxBytes: 4_000_000 });
  const parsed = parseSitemap(first.text, first.url || sitemapUrl);

  let urls = parsed.urls;
  let childCount = 0;
  if (parsed.sitemaps.length && urls.length < 3) {
    const children = parsed.sitemaps
      .filter((u) => !/sitemap[_-]?(?:index|main)\.xml/i.test(u) || parsed.sitemaps.length === 1)
      .slice(0, maxChildSitemaps);
    childCount = children.length;
    for (const child of children) {
      try {
        const res = await fetchOk(ctx, child, { timeoutMs: 15000, maxBytes: 4_000_000 });
        const sub = parseSitemap(res.text, res.url || child);
        urls.push(...sub.urls);
      } catch {
        /* one broken child sitemap must not abort the batch */
      }
    }
  }

  urls = [...new Set(urls)].filter((u) => (pattern ? pattern.test(u) : true));
  const batch = urls.slice(offset, offset + limit).map((url) => ({
    url,
    listingPageUrl: sitemapUrl,
    externalId: url,
  }));
  const consumed = offset + batch.length;
  const done = consumed >= urls.length || batch.length === 0;
  return {
    urls: batch,
    totalFound: urls.length,
    nextOffset: done ? 0 : consumed,
    done,
    mode: parsed.sitemaps.length ? "sitemap-index" : "sitemap",
    fetched: batch.length,
    childSitemaps: childCount,
  };
}

// ---------------------------------------------------------------------------
// RSS / Atom discovery
// ---------------------------------------------------------------------------

async function discoverRss(ctx, source, { feedUrl, pattern }) {
  const { limit } = normalizeBatch(ctx.limit, 0);
  const res = await fetchOk(ctx, feedUrl, { timeoutMs: 15000, maxBytes: 3_000_000 });
  const items = parseRssItems(res.text, res.url || feedUrl);
  const filtered = pattern ? items.filter((i) => pattern.test(i.url)) : items;
  const batch = filtered.slice(0, limit).map((i) => ({
    url: i.url,
    listingPageUrl: feedUrl,
    externalId: i.externalId || i.url,
  }));
  return {
    urls: batch,
    totalFound: filtered.length,
    nextOffset: 0,
    done: true,
    mode: "rss",
    fetched: batch.length,
  };
}

// ---------------------------------------------------------------------------
// Listing-page pagination discovery
// ---------------------------------------------------------------------------

async function discoverListing(ctx, source, { listingUrl, pattern, pageParam = "page" }) {
  const { limit, offset } = normalizeBatch(ctx.limit, ctx.offset);
  const page = Math.max(1, offset || 1);
  const base = listingUrl || source?.listing_url || source?.base_url;
  if (!base) throw new Error("discovery_missing_listing_url");
  let pageUrl = base;
  try {
    const u = new URL(base);
    if (page > 1) u.searchParams.set(pageParam, String(page));
    pageUrl = u.toString();
  } catch {
    /* keep base */
  }
  const res = await fetchOk(ctx, pageUrl, { timeoutMs: 15000, maxBytes: 3_000_000 });
  let urls = extractListingUrls(res.text, res.url || pageUrl, { pattern });
  // Some listing pages put detail links in scripts / JSON.
  if (!urls.length && pattern) {
    for (const m of String(res.text).matchAll(/"(\/[^"']+?)"/g)) {
      const abs = absolutize(m[1], res.url || pageUrl);
      if (abs && pattern.test(abs)) urls.push(canonicalUrl(abs) || abs);
    }
    urls = [...new Set(urls)];
  }
  const next = findNextPage(res.text, res.url || pageUrl, page);
  const batch = urls.slice(0, limit).map((url) => ({
    url,
    listingPageUrl: res.url || pageUrl,
    externalId: url,
  }));
  return {
    urls: batch,
    totalFound: null,
    nextOffset: next ? next.page : 1,
    done: !next,
    mode: "listing",
    fetched: batch.length,
    listingPageUrl: res.url || pageUrl,
  };
}

// ---------------------------------------------------------------------------
// Public API discovery
// ---------------------------------------------------------------------------

async function discoverReliefWeb(ctx, source) {
  const { limit, offset } = normalizeBatch(ctx.limit, ctx.offset);
  const appname = "habeshacareers";
  const params = new URLSearchParams({
    appname,
    limit: String(limit),
    offset: String(offset),
    "fields[include][]": "url",
    "filter[field]": "country",
    "filter[value]": "Ethiopia",
  });
  // v2 is the current public API. A v1 attempt would return 410, so it is not used.
  const url = `https://api.reliefweb.int/v2/jobs?${params.toString()}`;
  const res = await ctx.fetchJson(url, { timeoutMs: 15000, maxBytes: 2_000_000 });
  if (!res?.ok || !res.data) throw new Error(`reliefweb_api_failed:${res?.error || res?.status || "unknown"}`);
  const items = Array.isArray(res.data.data) ? res.data.data : [];
  const urls = items
    .map((item) => item?.fields?.url || item?.fields?.url_alias || item?.href || "")
    .map((u) => (String(u).startsWith("http") ? u : u ? `https://reliefweb.int${u}` : ""))
    .filter(Boolean);
  const batch = urls.map((u) => ({ url: canonicalUrl(u) || u, listingPageUrl: url, externalId: u }));
  const total = Number(res.data.totalCount ?? res.data.count ?? batch.length);
  const consumed = offset + batch.length;
  const done = batch.length === 0 || (Number.isFinite(total) && consumed >= total);
  return { urls: batch, totalFound: total, nextOffset: done ? 0 : consumed, done, mode: "api", fetched: batch.length };
}

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const JOB_DETAIL_PATTERNS = {
  ethiojobs: /\/job\/[^/?#]+/i,
  workethiopia: /\/jobs\/(?!category|location|type|search|page|company|tag)[a-z0-9][a-z0-9-]{6,}/i,
  geezjobs: /\/job-detail\//i,
  "ethiojobs-net-et": /(?:vacancy-detail\.php\?id=\d+|\/vacancy\/[^/?#]+)/i,
  etcareers: /\/jobs\/[a-z0-9][a-z0-9-]*-[0-9a-f]{6,}\/?$/i,
  alljobspo: /\/job-details\/\d+/i,
  "ethiopian-reporter": /\/jobs\/\d+\/?$/i,
  careersun: /\/jobdetail\/|\/jobs?\//i,
  "un-ethiopia": /\/en\/jobs\/[^/?#]+/i,
  ngojobs: /\/jobs\/[a-z0-9][a-z0-9-]*-mwc[a-z0-9]+/i,
  srazone: /\/[a-z]{2}\/jobs\/[a-z0-9][a-z0-9-]*-[0-9a-f]{8}/i,
  "ethiopianjobs-net": /\/job\/[a-z0-9][a-z0-9-]*\/$/i,
  jobwebethiopia: /\/jobs\/[a-z0-9][a-z0-9-]*\/$/i,
};

const ADAPTERS = {
  ethiojobs: {
    key: "ethiojobs",
    discover: (ctx, source) =>
      discoverSitemap(ctx, source, {
        sitemapUrl: source?.fetch_config?.sitemapUrl || "https://ethiojobs.net/sitemap-jobs.xml",
        pattern: JOB_DETAIL_PATTERNS.ethiojobs,
      }),
  },
  workethiopia: {
    key: "workethiopia",
    discover: (ctx, source) =>
      discoverSitemap(ctx, source, {
        sitemapUrl: source?.fetch_config?.sitemapUrl || "https://workethiopia.net/sitemap.xml",
        pattern: JOB_DETAIL_PATTERNS.workethiopia,
      }),
  },
  geezjobs: {
    key: "geezjobs",
    discover: async (ctx, source) => {
      const sitemapUrl = source?.fetch_config?.sitemapUrl || "https://geezjobs.com/sitemap-detail";
      try {
        return await discoverSitemap(ctx, source, { sitemapUrl, pattern: JOB_DETAIL_PATTERNS.geezjobs });
      } catch {
        return discoverRss(ctx, source, {
          feedUrl: source?.fetch_config?.feedUrl || "https://geezjobs.com/rss",
          pattern: JOB_DETAIL_PATTERNS.geezjobs,
        });
      }
    },
  },
  "ethiojobs-net-et": {
    key: "ethiojobs-net-et",
    discover: (ctx, source) =>
      discoverSitemap(ctx, source, {
        sitemapUrl: source?.fetch_config?.sitemapUrl || "https://ethio-jobs.net.et/sitemap-jobs.xml",
        pattern: JOB_DETAIL_PATTERNS["ethiojobs-net-et"],
      }),
  },
  etcareers: {
    key: "etcareers",
    discover: (ctx, source) =>
      discoverSitemap(ctx, source, {
        sitemapUrl: source?.fetch_config?.sitemapUrl || "https://etcareers.com/sitemap.xml",
        pattern: JOB_DETAIL_PATTERNS.etcareers,
      }),
  },
  alljobspo: {
    key: "alljobspo",
    discover: (ctx, source) =>
      discoverListing(ctx, source, {
        listingUrl: source?.fetch_config?.listingUrl || "https://jobsinethiopia.alljobspo.com/",
        pattern: JOB_DETAIL_PATTERNS.alljobspo,
      }),
  },
  "ethiopian-reporter": {
    key: "ethiopian-reporter",
    discover: (ctx, source) =>
      discoverSitemap(ctx, source, {
        sitemapUrl: source?.fetch_config?.sitemapUrl || "https://www.ethiopianreporterjobs.com/sitemap_index.xml",
        pattern: JOB_DETAIL_PATTERNS["ethiopian-reporter"],
        maxChildSitemaps: 8,
      }),
  },
  careersun: {
    key: "careersun",
    discover: (ctx, source) =>
      discoverRss(ctx, source, {
        feedUrl: source?.fetch_config?.feedUrl || "https://careers.un.org/jobfeed",
        pattern: JOB_DETAIL_PATTERNS.careersun,
      }),
  },
  "reliefweb-ethiopia": {
    key: "reliefweb-ethiopia",
    discover: discoverReliefWeb,
  },
  "un-ethiopia": {
    key: "un-ethiopia",
    discover: (ctx, source) =>
      discoverListing(ctx, source, {
        listingUrl: source?.fetch_config?.listingUrl || "https://ethiopia.un.org/en/jobs",
        pattern: JOB_DETAIL_PATTERNS["un-ethiopia"],
      }),
  },
  // NGO Jobs (ngojobs.et) — public sitemap of individual vacancy pages.
  ngojobs: {
    key: "ngojobs",
    discover: (ctx, source) =>
      discoverSitemap(ctx, source, {
        sitemapUrl: source?.fetch_config?.sitemapUrl || "https://ngojobs.et/sitemap-jobs.xml",
        pattern: JOB_DETAIL_PATTERNS.ngojobs,
      }),
  },
  // SraZone (srazone.et) — public sitemap, one entry per vacancy.
  srazone: {
    key: "srazone",
    discover: (ctx, source) =>
      discoverSitemap(ctx, source, {
        sitemapUrl: source?.fetch_config?.sitemapUrl || "https://srazone.et/sitemap.xml",
        pattern: JOB_DETAIL_PATTERNS.srazone,
      }),
  },
  // Ethiopian Jobs (ethiopianjobs.net) — WordPress sitemap of job_listing posts.
  "ethiopianjobs-net": {
    key: "ethiopianjobs-net",
    discover: (ctx, source) =>
      discoverSitemap(ctx, source, {
        sitemapUrl: source?.fetch_config?.sitemapUrl || "https://ethiopianjobs.net/job_listing-sitemap.xml",
        pattern: JOB_DETAIL_PATTERNS["ethiopianjobs-net"],
      }),
  },
  // Jobweb Ethiopia — public paginated listing of individual vacancy pages.
  jobwebethiopia: {
    key: "jobwebethiopia",
    discover: (ctx, source) =>
      discoverListing(ctx, source, {
        listingUrl: source?.fetch_config?.listingUrl || "https://jobwebethiopia.com/jobs/",
        pattern: JOB_DETAIL_PATTERNS.jobwebethiopia,
        pageParam: "page",
      }),
  },
  // Dereja — Next.js app; job records live in the RSC flight payload.
  dereja: {
    key: "dereja",
    discover: (ctx, source) => discoverDerejaJobs(ctx, source, { page: ctx.offset ? Math.ceil(ctx.offset / 12) : 1 }),
  },
};

// Historical slugs / adapter keys that should still resolve to an adapter.
const ALIASES = {
  etcaeers: "etcareers",
  "ethiojobs-net": "ethiojobs-net-et",
  "ethio-jobs-net-et": "ethiojobs-net-et",
  "ethiopianreporterjobs": "ethiopian-reporter",
  "un-ethiopia-jobs": "un-ethiopia",
};

export function getAdapter(source) {
  if (!source) return null;
  const keys = [source.adapter_key, source.slug, ALIASES[source.slug]]
    .map((k) => (k ? String(k).trim().toLowerCase() : ""))
    .filter(Boolean);
  for (const key of keys) if (ADAPTERS[key]) return ADAPTERS[key];
  return null;
}

export function listAdapterKeys() {
  return Object.keys(ADAPTERS);
}

/**
 * Discover individual vacancy URLs for a source. Returns a batch plus the
 * cursor to persist for the next run.
 */
export async function discoverSource(source, ctx = {}) {
  const adapter = getAdapter(source);
  if (!adapter) return null;
  const config = source?.fetch_config && typeof source.fetch_config === "object" ? source.fetch_config : {};
  const limit = ctx.limit ?? config.limit ?? 12;
  const offset = ctx.offset ?? config.offset ?? 0;
  const result = await adapter.discover({ ...ctx, limit, offset }, source);
  return { ...result, adapter: adapter.key };
}
