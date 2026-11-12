// Async employer identity + official logo resolution.
//
// Runs server-side only. It:
//   1. infers the hiring organisation's own website from the announcement,
//   2. fetches that website (robots-respecting, SSRF-guarded) and reads its
//      official logo,
//   3. falls back to the organisation's own favicon via public favicon
//      services, keyed on the organisation's domain,
//   4. verifies every candidate against the organisation before accepting it.
//
// The publishing job board's own logo is never a candidate.

import { baseDomain, hostOf, isKnownSourceDomain, safeParseUrl, sameSite } from "./hosts.mjs";
import { extractJsonLd, extractMeta, findJobPosting } from "./html.mjs";
import {
  LOGO_KIND,
  LOGO_SOURCE,
  canonicalEmployerName,
  collectPublisherAssets,
  employerKey,
  extractJsonLdLogo,
  extractSiteLogoCandidates,
  faviconServiceCandidates,
  inferEmployerDomain,
  isPublishableLogo,
  pickBestLogo,
  verifyLogoOwnership,
} from "./employer-logo.mjs";
import { UNVERIFIED_ORGANIZATION } from "./employer.mjs";

const DEFAULT_OPTIONS = {
  employerTimeoutMs: 9000,
  employerMaxBytes: 900_000,
  verifyEmployerLogo: true,
  allowFaviconFallback: true,
  respectRobots: true,
};

function mergeOptions(options = {}) {
  return { ...DEFAULT_OPTIONS, ...options };
}

function normalizeDomain(value) {
  if (!value) return null;
  const host = String(value).toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  return host;
}

/**
 * Resolve the official logo for the hiring organisation of one announcement.
 *
 * @returns {{
 *   name: string,
 *   key: string,
 *   websiteUrl: string|null,
 *   websiteDomain: string|null,
 *   logoUrl: string|null,
 *   logoKind: string,
 *   logoSource: string,
 *   logoConfidence: number,
 *   logoVerified: boolean,
 *   logoPublishable: boolean,
 *   logoReason: string,
 *   candidates: object[]
 * }}
 */
export async function resolveEmployerIdentity({
  html = "",
  pageUrl = "",
  source = null,
  jsonLd = null,
  meta = null,
  applyUrl = null,
  employerName = null,
  knownEmployer = null,
  fetchText = null,
  options = {},
} = {}) {
  const opts = mergeOptions(options);
  const pageMeta = meta || extractMeta(html);
  const pageJsonLd = jsonLd || findJobPosting(extractJsonLd(html));

  const name = canonicalEmployerName(employerName || "") || UNVERIFIED_ORGANIZATION;
  const key = employerKey(name);

  const result = {
    name,
    key,
    websiteUrl: null,
    websiteDomain: null,
    logoUrl: null,
    logoKind: LOGO_KIND.UNKNOWN,
    logoSource: LOGO_SOURCE.SEEDED,
    logoConfidence: 0,
    logoVerified: false,
    logoPublishable: false,
    logoReason: "not_resolved",
    candidates: [],
  };

  if (!name || name === UNVERIFIED_ORGANIZATION) {
    result.logoReason = "no_employer_identity";
    return result;
  }

  // A known directory entry already carries the verified identity and logo.
  if (knownEmployer && knownEmployer.logoUrl && knownEmployer.logoVerified) {
    const publishable = isPublishableLogo(knownEmployer.logoUrl, { source });
    if (publishable) {
      result.websiteUrl = knownEmployer.websiteUrl || null;
      result.websiteDomain = knownEmployer.websiteDomain || null;
      result.logoUrl = knownEmployer.logoUrl;
      result.logoKind = knownEmployer.logoKind || LOGO_KIND.EMPLOYER_SITE;
      result.logoSource = knownEmployer.logoSource || LOGO_SOURCE.EMPLOYER_SITE;
      result.logoConfidence = knownEmployer.logoConfidence ?? 90;
      result.logoVerified = true;
      result.logoPublishable = true;
      result.logoReason = "directory_reuse";
      return result;
    }
  }

  const inferred = inferEmployerDomain({
    jsonLd: pageJsonLd,
    meta: pageMeta,
    applyUrl,
    html,
    source,
    employerName: name,
  });
  if (inferred) {
    result.websiteUrl = inferred.url;
    result.websiteDomain = normalizeDomain(inferred.domain);
  }

  const candidates = [];
  // The publishing site's own identity assets. A candidate that matches one of
  // these is the job board's logo, never the employer's.
  const publisherAssets = collectPublisherAssets(html || "", pageMeta);

  // 1) The organisation's own website.
  if (opts.verifyEmployerLogo && result.websiteUrl && typeof fetchText === "function") {
    try {
      const page = await fetchText(result.websiteUrl, {
        timeoutMs: opts.employerTimeoutMs,
        maxBytes: opts.employerMaxBytes,
        respectRobots: opts.respectRobots,
        retries: 0,
      });
      if (page?.ok && page.text) {
        for (const candidate of extractSiteLogoCandidates(page.text, page.url || result.websiteUrl, {
          publisherAssets,
        })) {
          candidates.push({ ...candidate, origin: "employer_site" });
        }
      }
    } catch {
      /* the employer's site may block us; fall through to other candidates */
    }
  }

  // 2) A logo the announcement itself declares for the hiring organisation.
  const declared = extractJsonLdLogo(pageJsonLd, { source, publisherAssets });
  if (declared) candidates.push({ ...declared, origin: "jsonld" });

  // 3) The organisation's own favicon, keyed on the organisation's domain.
  const domains = new Set();
  if (result.websiteDomain) domains.add(result.websiteDomain);
  const applyHost = safeParseUrl(applyUrl || "");
  if (applyHost) {
    const d = normalizeDomain(baseDomain(applyHost.hostname));
    if (d && !isKnownSourceDomain(d)) domains.add(d);
  }
  if (knownEmployer?.websiteDomain) {
    const d = normalizeDomain(knownEmployer.websiteDomain);
    if (d) domains.add(d);
  }
  if (opts.allowFaviconFallback) {
    for (const domain of domains) {
      for (const candidate of faviconServiceCandidates(domain)) {
        candidates.push({ ...candidate, origin: "favicon_service" });
      }
    }
  }

  const context = {
    employerDomain: result.websiteDomain || [...domains][0] || null,
    employerName: name,
    source,
    publisherAssets,
  };

  // Verify every candidate before it can be chosen.
  const verified = [];
  for (const candidate of candidates) {
    const verdict = verifyLogoOwnership(candidate, context);
    verified.push({ ...candidate, verified: verdict.ok, reason: verdict.reason, verdictKind: verdict.kind });
  }
  result.candidates = verified
    .map((c) => ({
      url: c.url,
      kind: c.verdictKind || c.kind,
      origin: c.origin || null,
      ok: !!c.verified,
      reason: c.reason || null,
      host: c.host || null,
      weight: c.weight ?? null,
    }))
    .slice(0, 15);

  const best = pickBestLogo(verified, context);
  if (!best) {
    result.logoReason = "no_verified_logo";
    return result;
  }

  const publishable = isPublishableLogo(best.url, { source });
  result.logoUrl = best.url;
  result.logoKind = best.kind;
  result.logoSource =
    best.origin === "employer_site"
      ? LOGO_SOURCE.EMPLOYER_SITE
      : best.origin === "favicon_service"
        ? LOGO_SOURCE.FAVICON_SERVICE
        : best.kind === LOGO_KIND.ATS_SITE
          ? LOGO_SOURCE.ATS_SITE
          : LOGO_SOURCE.JSONLD;
  result.logoConfidence = Math.max(0, Math.min(100, Math.round(best.score ?? 50)));
  result.logoVerified = true;
  result.logoPublishable = publishable;
  result.logoReason = best.reason || "verified";

  return result;
}

export { LOGO_KIND, LOGO_SOURCE, employerKey, canonicalEmployerName, isPublishableLogo };
