// Employer identity and official-logo resolution.
//
// The goal is the OFFICIAL logo of the actual hiring organisation — never the
// logo of the website that published the vacancy.
//
// Resolution order (highest confidence first):
//   1. employer_site   – the organisation's own website (fetched and parsed)
//   2. ats_site        – the employer's own recruitment portal (ATS)
//   3. favicon_service – the organisation's own favicon via a public favicon
//                        service, keyed on the organisation's own domain
//   4. jsonld          – a logo declared by the page for the hiring org
//   5. board_mirror    – a source-hosted copy of the employer's logo
//
// A logo is only accepted when it can be tied to the organisation:
//   * it is served from the organisation's own domain, or
//   * it is a favicon-service URL whose `domain` parameter is the
//     organisation's own domain, or
//   * it is served from an ATS that hosts the employer's own board, or
//   * the page explicitly declares it as the hiring organisation's logo.
//
// Logos that belong to the publishing site (the job board's own favicon,
// logo or social image) are rejected, and logos hosted on a discovery
// domain are never served to the public (they would leak the source).

import { baseDomain, hostMatches, hostOf, isAtsHost, isKnownSourceDomain, isSocialHost, safeParseUrl, sameSite } from "./hosts.mjs";
import { absolutize, canonicalUrl } from "./urls.mjs";
import { collapseWhitespace, decodeEntities, extractMeta } from "./html.mjs";

export const LOGO_KIND = {
  EMPLOYER_SITE: "employer_site",
  ATS_SITE: "ats_site",
  FAVICON_SERVICE: "favicon_service",
  JSONLD: "jsonld",
  BOARD_MIRROR: "board_mirror",
  UNKNOWN: "unknown",
};

export const LOGO_SOURCE = {
  EMPLOYER_SITE: "employer_site",
  ATS_SITE: "ats_site",
  FAVICON_SERVICE: "favicon_service",
  JSONLD: "jsonld",
  MANUAL: "manual",
  SEEDED: "seeded",
};

// Board/aggregator branding assets. These are the publishing site's own
// graphics and must never be used as an organisation logo.
const BOARD_BRAND_ASSET_RE =
  /(?:^|[/_-])(?:geezjobs?-logo|ethiojobs?-logo|etcareers?-logo|workethiopia-logo|alljobspo-logo|dereja-logo|hahu-logo|srazone-logo|ngojobs?-logo|jobwebethiopia-logo|site[-_]?logo|default[-_]?logo|placeholder|generic[-_]?logo)(?:[/_.-]|$)/i;

// A publisher's own social/preview image is not an organisation logo either.
const PUBLISHER_ASSET_RE = /(?:^|[/_-])(?:ogimage|og[-_]?image|social[-_]?share|preview[-_]?image)(?:[/_.-]|$)/i;

const GENERIC_ASSET_RE = /(?:default|placeholder|generic|no[-_]?logo|blank|dummy|sample|spacer|avatar|profile)[-_]?logo/i;

const LOGO_FILENAME_HINTS = /(?:logo|brand|identity)/i;

/**
 * Collect the publishing site's own chrome assets (its favicon, touch icon
 * and mask icon). These are the site's identity and are never an
 * organisation's logo.
 *
 * `og:image` is deliberately NOT collected: on job boards the social preview
 * image is usually the employer's own logo for that vacancy, which is exactly
 * the signal we want. Site-level preview images are still rejected by the
 * brand-asset patterns above.
 */
export function collectPublisherAssets(html = "", meta = null) {
  const out = new Set();
  for (const m of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (/\brel=["']([^"']+)["']/i.exec(tag) || [])[1] || "";
    if (!/(^|\s)(icon|apple-touch-icon|mask-icon|shortcut icon)(\s|$)/i.test(rel)) continue;
    const href = (/\bhref=["']([^"']+)["']/i.exec(tag) || [])[1] || "";
    const abs = absolutize(href, "");
    if (abs) out.add(abs);
  }
  return [...out];
}

function normalizeAssetUrl(url) {
  try {
    const u = new URL(String(url || ""));
    u.hash = "";
    u.protocol = "https:";
    return u.toString();
  } catch {
    return String(url || "").trim();
  }
}

/**
 * True when the asset belongs to the publishing site rather than the employer.
 */
export function isBoardBrandAsset(url, source = null, publisherAssets = []) {
  const value = String(url || "").toLowerCase();
  if (GENERIC_ASSET_RE.test(value)) return true;
  if (BOARD_BRAND_ASSET_RE.test(value)) return true;
  if (PUBLISHER_ASSET_RE.test(value)) return true;
  // Exact match against the publisher's own identity assets.
  const normalized = normalizeAssetUrl(url);
  if ((publisherAssets || []).some((a) => normalizeAssetUrl(a) === normalized)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Employer name normalisation
// ---------------------------------------------------------------------------

// Legal/descriptor suffixes that carry no identifying information. Words that
// are part of an organisation's actual name (bank, university, school,
// ministry, hospital...) are deliberately NOT stripped: "Amhara Bank" and
// "Dashen Bank" must never collapse to the same key.
const LEGAL_SUFFIX_RE =
  /\s+(?:the\s+)?(?:plc|plc\.|s\.c\.?|sc\b|ltd\.?|limited|llc|inc\.?|incorporated|corp\.?|corporation|co\.?|company|group|holdings?|enterprises?|international|ethiopia|ethiopian|organization|organisation|foundation|association|institute)(?=\s|$)/gi;

/**
 * Canonical key for an organisation. Used so the same employer found through
 * several job boards collapses into one directory entry.
 */
export function employerKey(name) {
  let value = collapseWhitespace(decodeEntities(String(name || "")));
  if (!value) return "";
  value = value
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[.,()[\]/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Punctuation-only suffixes such as "s.c." or "p.l.c." lose their dots
  // above; collapse the resulting letter groups before removing them.
  value = value.replace(/\b(s\s*c|l\s*t\s*d|i\s*n\s*c|c\s*o\s*r\s*p)\b/g, " ").replace(/\s+/g, " ").trim();
  value = value.replace(LEGAL_SUFFIX_RE, " ").replace(/\s+/g, " ").trim();
  return value;
}

/**
 * Display form of an organisation name (trimmed of trailing noise).
 */
export function canonicalEmployerName(name) {
  return collapseWhitespace(decodeEntities(String(name || "")))
    .replace(/\s*[|–—]\s*[^|–—]{1,40}$/, (m) => (/jobs?|vacanc|career|portal|board/i.test(m) ? "" : m))
    .trim();
}

// ---------------------------------------------------------------------------
// Domain inference
// ---------------------------------------------------------------------------

/**
 * Best guess at the organisation's own website, using the strongest evidence
 * available. Returns null when only the publishing site is known.
 */
export function inferEmployerDomain({ jsonLd = null, meta = {}, applyUrl = null, html = "", source = null, employerName = "" } = {}) {
  const candidates = [];
  const sourceDomain = baseDomain(hostOf(source?.base_url || source?.listing_url || ""));

  const hiring = jsonLd?.hiringOrganization;
  const hiringUrls = [];
  if (hiring) {
    // Only a genuine website counts. A logo URL is an asset, not a site.
    const raw = [hiring.url, hiring.sameAs, hiring.contactUrl];
    for (const item of (Array.isArray(raw) ? raw : [raw])) {
      if (typeof item === "string") hiringUrls.push(item);
      else if (item && typeof item === "object") hiringUrls.push(item.url, item.sameAs);
    }
  }
  // NOTE: og:url / twitter:url describe the ANNOUNCEMENT page, never the
  // employer's website, so they are deliberately not used here.

  for (const value of hiringUrls) {
    const u = safeParseUrl(value);
    if (!u) continue;
    // The employer's own website is never the publishing site's website.
    if (sourceDomain && hostMatches(baseDomain(u.hostname), sourceDomain)) continue;
    if (isKnownSourceDomain(baseDomain(u.hostname))) continue;
    candidates.push({ url: u.toString(), weight: 90 });
  }

  // An apply link that points at the employer's own careers page is strong
  // evidence of the organisation's domain.
  if (applyUrl) {
    const u = safeParseUrl(applyUrl);
    if (u && !isAtsHost(u.toString()) && !isSocialHost(u.toString()) && !isKnownSourceDomain(baseDomain(u.hostname))) {
      candidates.push({ url: u.toString(), weight: 70 });
    }
  }

  // Employer website often appears in the announcement body.
  const text = collapseWhitespace(String(html || "").replace(/<[^>]+>/g, " ")).slice(0, 40000);
  const re = /(?:website|web site|official website|visit our website|company website|for more information visit)\s*[:\-]?\s*((?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>)]*)?)/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    const u = safeParseUrl(raw.startsWith("http") ? raw : `https://${raw}`);
    if (!u) continue;
    if (isKnownSourceDomain(baseDomain(u.hostname))) continue;
    if (isSocialHost(u.toString())) continue;
    candidates.push({ url: u.toString(), weight: 60 });
  }

  // Links whose host contains a distinctive token of the employer name.
  const tokens = String(employerName || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 5 && !/^(the|group|company|ltd|plc|inc|ethiopia|ethiopian|organization|organisation)$/.test(t));
  for (const m of String(html || "").matchAll(/href=["']([^"']+)["']/gi)) {
    const abs = absolutize(m[1], "");
    if (!abs) continue;
    const host = baseDomain(hostOf(abs));
    if (!host || isKnownSourceDomain(host) || isSocialHost(abs)) continue;
    if (tokens.some((t) => host.includes(t))) candidates.push({ url: abs, weight: 50 });
  }

  // An organisation's own domain often appears inside the application URL
  // itself, for example "ats.example.com/company/jobs/recruiter@company.et".
  // The address domain is a first-party signal for the organisation.
  const scanForEmployerDomain = (value) => {
    for (const m of String(value || "").matchAll(/([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      const domain = baseDomain(m[2].toLowerCase());
      if (!domain || isKnownSourceDomain(domain)) continue;
      if (tokens.some((t) => domain.includes(t))) return `https://${domain}/`;
    }
    return null;
  };
  const fromApply = applyUrl ? scanForEmployerDomain(applyUrl) : null;
  if (fromApply) candidates.push({ url: fromApply, weight: 80 });
  for (const m of String(html || "").matchAll(/(?:mailto:|[?&](?:email|contact|apply_to)=)([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const found = scanForEmployerDomain(m[1]);
    if (found) candidates.push({ url: found, weight: 65 });
  }

  const best = candidates.sort((a, b) => b.weight - a.weight)[0];
  if (!best) return null;
  const u = safeParseUrl(best.url);
  if (!u) return null;
  return { url: u.toString(), domain: baseDomain(u.hostname), host: u.hostname.toLowerCase(), weight: best.weight };
}

// ---------------------------------------------------------------------------
// Logo candidate extraction
// ---------------------------------------------------------------------------

function faviconServiceDomain(url) {
  const value = String(url || "");
  let m = /[?&]domain=([^&]+)/i.exec(value);
  if (m) return decodeURIComponent(m[1]).toLowerCase();
  m = /duckduckgo\.com\/ip3\/([^./]+)\./i.exec(value);
  if (m) return m[1].toLowerCase();
  return null;
}

export function isFaviconServiceUrl(url) {
  return /google\.com\/s2\/favicons|icons\.duckduckgo\.com\/ip3\//i.test(String(url || ""));
}

/**
 * Extract logo candidates from the employer's own website HTML.
 */
export function extractSiteLogoCandidates(html, baseUrl = "", { publisherAssets = [] } = {}) {
  const out = [];
  const push = (raw, kind, weight, label) => {
    const abs = absolutize(raw, baseUrl);
    if (!abs) return;
    const u = safeParseUrl(abs);
    if (!u) return;
    const path = `${u.pathname}${u.search}`;
    if (!/\.(?:png|jpe?g|gif|webp|svg|avif|ico)(?:$|[?#])/i.test(path)) {
      // Some sites serve logos without an extension; keep only plausible paths.
      if (!LOGO_FILENAME_HINTS.test(path)) return;
    }
    if (isBoardBrandAsset(abs, null, publisherAssets)) return;
    out.push({ url: canonicalUrl(abs) || abs, kind, weight, label: label || null, host: u.hostname.toLowerCase() });
  };

  const metas = extractMeta(html);
  // Apple touch icons and site icons are the most reliable "official" marks.
  for (const m of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (/\brel=["']([^"']+)["']/i.exec(tag) || [])[1] || "";
    const href = (/\bhref=["']([^"']+)["']/i.exec(tag) || [])[1] || "";
    if (!href) continue;
    const sizes = (/\bsizes=["']([^"']+)["']/i.exec(tag) || [])[1] || "";
    const size = Math.max(0, ...sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
    if (/apple-touch-icon/i.test(rel)) push(href, LOGO_KIND.EMPLOYER_SITE, 92 + Math.min(size, 180) / 100, "apple-touch-icon");
    else if (/(^|\s)icon(\s|$)/i.test(rel)) push(href, LOGO_KIND.EMPLOYER_SITE, 80 + Math.min(size, 180) / 100, "icon");
    else if (/(^|\s)mask-icon(\s|$)/i.test(rel)) push(href, LOGO_KIND.EMPLOYER_SITE, 70, "mask-icon");
  }
  if (metas["og:image"]) push(metas["og:image"], LOGO_KIND.EMPLOYER_SITE, 60, "og:image");
  if (metas["twitter:image"]) push(metas["twitter:image"], LOGO_KIND.EMPLOYER_SITE, 52, "twitter:image");

  // Header / navbar images that look like a wordmark.
  for (const m of String(html || "").matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (/\bsrc=["']([^"']+)["']/i.exec(tag) || [])[1] || "";
    if (!src) continue;
    const attrs = `${(/\balt=["']([^"']*)["']/i.exec(tag) || [])[1] || ""} ${(/\bclass=["']([^"']*)["']/i.exec(tag) || [])[1] || ""} ${(/\bid=["']([^"']*)["']/i.exec(tag) || [])[1] || ""}`.toLowerCase();
    if (!/(logo|brand|wordmark)/.test(attrs)) continue;
    if (/(spacer|placeholder|loading|blank)/.test(attrs)) continue;
    push(src, LOGO_KIND.EMPLOYER_SITE, 58, "img");
  }
  return out;
}

/**
 * Logo declared by the page for the hiring organisation.
 */
export function extractJsonLdLogo(jsonLd, { source = null, publisherAssets = [] } = {}) {
  const hiring = jsonLd?.hiringOrganization;
  if (!hiring) return null;
  const raw = typeof hiring === "string" ? null : hiring.logo ?? hiring.image ?? hiring.logoUrl ?? null;
  const value = typeof raw === "string" ? raw : raw?.url || raw?.contentUrl || null;
  if (!value) return null;
  const abs = absolutize(value, "");
  if (!abs) return null;
  if (isBoardBrandAsset(abs, source, publisherAssets)) return null;
  return { url: canonicalUrl(abs) || abs, kind: LOGO_KIND.JSONLD, weight: 65, label: "jsonld", host: hostOf(abs) };
}

/**
 * Public favicon services keyed on the organisation's own domain.
 */
export function faviconServiceCandidates(domain) {
  if (!domain) return [];
  const d = String(domain).toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return [];
  return [
    {
      url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`,
      kind: LOGO_KIND.FAVICON_SERVICE,
      weight: 55,
      label: "favicon_service",
      host: "www.google.com",
      domain: d,
    },
    {
      url: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico`,
      kind: LOGO_KIND.FAVICON_SERVICE,
      weight: 50,
      label: "favicon_service",
      host: "icons.duckduckgo.com",
      domain: d,
    },
  ];
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Decide whether a candidate logo can be attributed to the organisation.
 *
 * @returns {{ ok: boolean, reason: string, kind: string, host: string, domain: string|null }}
 */
export function verifyLogoOwnership(candidate, { employerDomain = null, employerName = "", source = null, publisherAssets = [] } = {}) {
  const url = String(candidate?.url || "");
  if (!url) return { ok: false, reason: "empty", kind: LOGO_KIND.UNKNOWN, host: "", domain: null };
  const u = safeParseUrl(url);
  if (!u) return { ok: false, reason: "invalid_url", kind: LOGO_KIND.UNKNOWN, host: "", domain: null };
  const host = u.hostname.toLowerCase();
  const domain = baseDomain(host);
  const sourceDomain = baseDomain(hostOf(source?.base_url || source?.listing_url || ""));

  if (isSocialHost(url)) return { ok: false, reason: "social_host", kind: LOGO_KIND.UNKNOWN, host, domain };
  if (isBoardBrandAsset(url, source, publisherAssets)) return { ok: false, reason: "publisher_brand_asset", kind: LOGO_KIND.UNKNOWN, host, domain };

  // 1) Favicon service keyed on the organisation's own domain.
  if (isFaviconServiceUrl(url)) {
    const key = faviconServiceDomain(url);
    if (!key) return { ok: false, reason: "favicon_service_unknown_domain", kind: LOGO_KIND.UNKNOWN, host, domain };
    // A favicon of the publishing site is never the employer's logo.
    if (sourceDomain && hostMatches(key, sourceDomain)) {
      return { ok: false, reason: "favicon_service_points_at_source", kind: LOGO_KIND.UNKNOWN, host, domain };
    }
    if (employerDomain && !hostMatches(key, employerDomain)) {
      return { ok: false, reason: "favicon_service_domain_mismatch", kind: LOGO_KIND.UNKNOWN, host, domain };
    }
    return { ok: true, reason: "favicon_service_own_domain", kind: LOGO_KIND.FAVICON_SERVICE, host, domain: key };
  }

  // 2) Served from the organisation's own domain.
  if (employerDomain && hostMatches(host, employerDomain)) {
    return { ok: true, reason: "employer_domain", kind: LOGO_KIND.EMPLOYER_SITE, host, domain };
  }

  // 3) Served from an ATS that hosts the employer's own board.
  if (isAtsHost(url)) {
    return { ok: true, reason: "ats_hosted", kind: LOGO_KIND.ATS_SITE, host, domain };
  }

  // 4) Explicitly declared as the hiring organisation's logo by the page.
  //    When the board hosts the employer's uploaded logo on its own CDN the
  //    asset is still the employer's own logo, so it is accepted — but it is
  //    served through our proxy so the board's domain never reaches the
  //    browser.
  if (candidate.kind === LOGO_KIND.JSONLD) {
    if (sourceDomain && hostMatches(host, sourceDomain)) {
      return { ok: true, reason: "jsonld_declared_mirror", kind: LOGO_KIND.BOARD_MIRROR, host, domain };
    }
    return { ok: true, reason: "jsonld_declared", kind: LOGO_KIND.JSONLD, host, domain };
  }

  // 5) Unknown host with no employer domain to compare against.
  if (!employerDomain) {
    return { ok: false, reason: "no_employer_domain", kind: LOGO_KIND.UNKNOWN, host, domain };
  }

  return { ok: false, reason: "unrelated_host", kind: LOGO_KIND.UNKNOWN, host, domain };
}

/**
 * Rank verified candidates. Highest weight wins; ties break on kind priority.
 */
export function pickBestLogo(candidates, context = {}) {
  const verified = [];
  for (const candidate of candidates || []) {
    // A candidate that was already verified upstream keeps its verdict; the
    // verdict kind must not replace the candidate kind, because the verdict
    // is what re-classifies it (for example a JSON-LD declaration that turns
    // out to be hosted on the board's CDN).
    const verdict = candidate.verified
      ? { ok: true, reason: candidate.reason || "pre_verified", kind: candidate.kind, host: candidate.host, domain: candidate.domain }
      : verifyLogoOwnership(candidate, context);
    if (!verdict.ok) continue;
    verified.push({
      ...candidate,
      verdictKind: verdict.kind,
      reason: verdict.reason,
      host: verdict.host || candidate.host,
      domain: verdict.domain ?? candidate.domain ?? null,
      score: Number(candidate.weight || 0) + (verdict.kind === LOGO_KIND.EMPLOYER_SITE ? 15 : 0),
    });
  }
  verified.sort((a, b) => b.score - a.score);
  const best = verified[0] || null;
  if (best) best.kind = best.verdictKind;
  return best;
}

/**
 * Public-safe logo check.
 *
 * A logo hosted on a discovery source is never published directly, because
 * that would reveal the site the vacancy came from. Such a logo is served
 * through our own proxy instead, so it can still be shown.
 */
export function isPublishableLogo(url, { source = null } = {}) {
  const u = safeParseUrl(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  const domain = baseDomain(host);
  if (isKnownSourceDomain(domain)) return false;
  if (source) {
    const sourceDomain = baseDomain(hostOf(source.base_url || source.listing_url || ""));
    if (sourceDomain && hostMatches(host, sourceDomain)) return false;
  }
  return true;
}

/**
 * True when the asset is hosted on a discovery source and therefore has to be
 * proxied rather than linked directly.
 */
export function isSourceHostedLogo(url, { source = null } = {}) {
  const u = safeParseUrl(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  const domain = baseDomain(host);
  if (isKnownSourceDomain(domain)) return true;
  if (source) {
    const sourceDomain = baseDomain(hostOf(source.base_url || source.listing_url || ""));
    if (sourceDomain && hostMatches(host, sourceDomain)) return true;
  }
  return false;
}

export { isBoardBrandAsset as isPublisherBrandAsset };
