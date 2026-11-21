// Original-source detection.
//
// A discovery board often republishes a vacancy that was announced somewhere
// else first: the employer's own site, an ATS, a UN agency portal, a newspaper.
// When that happens the board's copy is a *secondary* source, and sending the
// reader there misattributes the vacancy.
//
// This module inspects an announcement and decides whether an authentic,
// original destination is available. It is deliberately conservative:
//
//   * a candidate is only returned when it is verifiably NOT the publishing
//     board and NOT social media,
//   * a same-site link is never treated as "the original",
//   * when nothing can be verified the existing link is kept unchanged.
//
// Everything here is pure (no network, no database) so it can be unit-tested.

import {
  isAtsHost,
  isDocumentUrl,
  isImageUrl,
  isKnownSourceDomain,
  isSocialHost,
  hostOf,
  safeParseUrl,
  baseDomain,
} from "./hosts.mjs";
import { absolutize, canonicalUrl, isListingUrl } from "./urls.mjs";
import { collapseWhitespace, decodeEntities } from "./html.mjs";

// Labels that introduce the authentic announcement.
const ORIGINAL_LABEL_RE =
  /\b(?:original\s+(?:job\s*)?(?:posting|announcement|advert(?:isement)?|vacancy|source|link|page|notice)|read\s+(?:the\s+)?original|view\s+(?:the\s+)?original|source\s*[:|]|originally\s+(?:posted|published|announced)|reposted?\s+from|taken\s+from|courtesy\s+of|via\s+(?:the\s+)?official)\b/i;

// Labels that describe the board's own copy. A link introduced by one of these
// is never the original.
const REPOST_LABEL_RE =
  /\b(?:share|print|save|bookmark|related|similar|back\s+to|home\s*page|subscribe|newsletter|advertise|log\s*in|sign\s*in|register|contact\s+us|about\s+us|privacy|terms)\b/i;

// Domains that host employer boards but are not the employer's own site. A
// link here is "closer to the employer" than a job board, but still not the
// employer, so it is reported with a lower confidence.
const CAREERS_PORTAL_HINTS = [
  "jobs.lever.co",
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "apply.workable.com",
  "jobs.smartrecruiters.com",
  "careers.smartrecruiters.com",
];

/**
 * True when a URL can be an authentic vacancy destination.
 *
 * Rejects the publishing board, other discovery boards, social media, images
 * and generic listing/index pages.
 */
export function isAuthenticDestination(url, { pageUrl = "", source = null } = {}) {
  const raw = String(url || "").trim();
  if (!raw || /^mailto:/i.test(raw)) return false;
  const u = safeParseUrl(raw, pageUrl);
  if (!u) return false;
  if (!/^https?:$/i.test(u.protocol)) return false;
  if (u.username || u.password) return false;
  if (isImageUrl(u.toString())) return false;
  if (isSocialHost(u.toString())) return false;

  const host = hostOf(u.toString());
  const base = baseDomain(host);

  // The publishing board itself is never the original.
  if (base && isKnownSourceDomain(base)) return false;
  if (source) {
    for (const rawBase of [source.base_url, source.listing_url]) {
      const srcBase = baseDomain(hostOf(rawBase));
      if (srcBase && srcBase === base) return false;
    }
  }

  // A same-site link is the board's own page, not an external original.
  if (pageUrl) {
    const pageBase = baseDomain(hostOf(pageUrl));
    if (pageBase && pageBase === base) return false;
  }

  // An index page is not a vacancy.
  if (isListingUrl(u.toString())) return false;
  if (isDocumentUrl(u.toString())) return true;

  return true;
}

/**
 * Confidence that a destination is the authentic vacancy page.
 *
 * The employer's own site and its ATS score highest; a UN/NGO portal or a
 * careers page scores a little lower; anything else is treated as a plain
 * external link.
 */
export function scoreAuthenticDestination(url, { employerDomain = null } = {}) {
  const raw = String(url || "").trim();
  const host = hostOf(raw);
  const base = baseDomain(host);
  if (!base) return 0;

  const employerBase = employerDomain ? baseDomain(String(employerDomain).toLowerCase().replace(/^www\./, "")) : null;

  // The employer's own domain is the strongest signal available.
  if (employerBase && base === employerBase) return 96;
  if (isAtsHost(raw)) return 92;
  if (CAREERS_PORTAL_HINTS.some((h) => host === h || host.endsWith(`.${h}`))) return 88;
  // Recruitment portals run by international organisations.
  if (/^(?:careers|jobs|vacancies|recruitment)\./i.test(host)) return 84;
  if (isDocumentUrl(raw)) return 80;
  return 70;
}

/**
 * Collect candidate original destinations from one announcement.
 *
 * @param {object} input
 * @param {string} input.html      raw announcement HTML
 * @param {string} input.pageUrl   URL the announcement was fetched from
 * @param {object} [input.source]  job_sources row (the publishing board)
 * @param {string} [input.employerDomain] the hiring organisation's own domain
 * @returns {Array<{url: string, confidence: number, origin: string, label: string|null}>}
 */
export function collectOriginalSourceCandidates({
  html = "",
  pageUrl = "",
  source = null,
  employerDomain = null,
} = {}) {
  const out = [];
  const seen = new Set();

  const add = (rawUrl, origin, label = null, context = "") => {
    const abs = absolutize(rawUrl, pageUrl);
    if (!abs) return;
    const key = canonicalUrl(abs) || abs;
    if (seen.has(key)) return;
    if (!isAuthenticDestination(abs, { pageUrl, source })) return;
    seen.add(key);
    const confidence = Math.max(
      0,
      Math.min(100, scoreAuthenticDestination(abs, { employerDomain }) + (ORIGINAL_LABEL_RE.test(context) ? 6 : 0))
    );
    out.push({ url: key, confidence, origin, label: label ? collapseWhitespace(label) : null });
  };

  // 1) Anchors whose own text, or the words immediately before them,
  //    introduce the original announcement ("Read the original here").
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const textBefore = (html, index) =>
    collapseWhitespace(
      decodeEntities(
        String(html.slice(Math.max(0, index - 240), index))
          .replace(/<[^>]+>/g, " ")
      )
    ).slice(-160);

  for (const m of String(html || "").matchAll(anchorRe)) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1] || "";
    if (!href) continue;
    const text = collapseWhitespace(decodeEntities(inner.replace(/<[^>]+>/g, " ")));
    const before = textBefore(html, m.index || 0);
    const context = `${before} ${text}`;
    if (!ORIGINAL_LABEL_RE.test(context)) continue;
    add(href, "original_label", (text || before).slice(0, 120), context);
  }

  // 2) The words that introduce an original, followed by a bare URL.
  const plain = collapseWhitespace(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
  const labelledUrlRe =
    /(?:original\s+(?:job\s*)?(?:posting|announcement|advert(?:isement)?|vacancy|source|link|page|notice)|read\s+(?:the\s+)?original|view\s+(?:the\s+)?original|source|courtesy\s+of)\s*[:|\-]?\s*((?:https?:\/\/|www\.)[^\s"'<>)]+)/gi;
  for (const m of plain.matchAll(labelledUrlRe)) {
    add(m[1], "original_label_text", null, m[0]);
  }

  // 3) An explicit "apply on the employer's site" style call to action.
  for (const m of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1] || "";
    if (!href) continue;
    const text = collapseWhitespace(decodeEntities(inner.replace(/<[^>]+>/g, " ")));
    if (!/\b(?:apply\s+(?:now|online|here|directly|on\s+(?:the\s+)?(?:employer|company|organisation|organization))|visit\s+(?:the\s+)?(?:official|employer|company)\s+(?:website|site|career)|official\s+(?:vacancy|career|recruitment)\s+(?:page|site|link))\b/i.test(text)) {
      continue;
    }
    add(href, "apply_on_employer", text.slice(0, 120), text);
  }

  // 4) A link to the employer's own domain found anywhere in the announcement.
  if (employerDomain) {
    const target = baseDomain(String(employerDomain).toLowerCase().replace(/^www\./, ""));
    for (const m of String(html || "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
      const abs = absolutize(m[1], pageUrl);
      if (!abs) continue;
      const base = baseDomain(hostOf(abs));
      if (base && target && base === target) add(abs, "employer_domain_link", null, "");
    }
  }

  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 8);
}

/**
 * Decide whether an original destination should replace the current one.
 *
 * The existing link is kept whenever:
 *   * no authentic candidate was found,
 *   * the candidate is not clearly better (it must beat the current one by a
 *     real margin, not a rounding difference),
 *   * verification is impossible — this function never fabricates a link.
 *
 * @returns {{ url: string, changed: boolean, origin: string|null, confidence: number, reason: string }}
 */
export function resolveOriginalSource({
  html = "",
  pageUrl = "",
  source = null,
  employerDomain = null,
  currentUrl = null,
  currentConfidence = 0,
  minConfidence = 70,
  margin = 8,
} = {}) {
  const candidates = collectOriginalSourceCandidates({ html, pageUrl, source, employerDomain });
  const best = candidates[0] || null;
  const current = String(currentUrl || "").trim();

  if (!best) {
    return { url: current, changed: false, origin: null, confidence: Number(currentConfidence) || 0, reason: "no_authentic_candidate" };
  }
  if (current && canonicalUrl(current) === canonicalUrl(best.url)) {
    return { url: current, changed: false, origin: best.origin, confidence: best.confidence, reason: "already_original" };
  }
  if (best.confidence < minConfidence) {
    return { url: current, changed: false, origin: best.origin, confidence: best.confidence, reason: "below_confidence_threshold" };
  }
  const currentScore = Number(currentConfidence) || 0;
  if (current && best.confidence <= currentScore + margin) {
    return { url: current, changed: false, origin: best.origin, confidence: best.confidence, reason: "not_clearly_better" };
  }

  return { url: best.url, changed: true, origin: best.origin, confidence: best.confidence, reason: "authentic_source_found" };
}

export { ORIGINAL_LABEL_RE, REPOST_LABEL_RE, CAREERS_PORTAL_HINTS };