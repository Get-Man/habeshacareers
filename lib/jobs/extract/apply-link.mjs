// Application-destination detection and ranking.
//
// A vacancy page is only a discovery/extraction surface. The application
// destination must be the real employer flow (ATS, employer site, official
// form, or a verified application email) — never the discovery source, an
// aggregator listing page or a social share URL.

import {
  isAtsHost,
  isDocumentUrl,
  isImageUrl,
  isKnownSourceDomain,
  isSocialHost,
  isSourceHost,
  hostOf,
  sameSite,
  safeParseUrl,
} from "./hosts.mjs";
import {
  absolutize,
  canonicalUrl,
  decodeRedirectUrl,
  extractUrlsFromText,
  isListingUrl,
  isLikelyJobUrl,
} from "./urls.mjs";
import {
  collapseWhitespace,
  extractAnchors,
  extractForms,
  extractInlineNavigation,
  extractSectionText,
  findEmails,
  htmlToText,
} from "./html.mjs";

const APPLY_LABEL_RE =
  /\b(apply(?:\s+(?:now|online|here|today|for this (?:job|role|position)))?|how\s+to\s+apply|submit\s+(?:your\s+)?(?:application|cv|resume)|send\s+(?:your\s+)?(?:cv|resume|application)|application\s+(?:form|link|process|instructions|procedure)|start\s+(?:your\s+)?application|register\s+(?:to\s+apply|here)|view\s+advert\s*&\s*apply|click\s+here\s+to\s+apply|go\s+to\s+application|apply\s+via|official\s+(?:application|vacancy)\s+(?:page|link)|visit\s+(?:the\s+)?(?:official\s+)?(?:career|application)\s+(?:site|page))\b/i;

const NEGATIVE_LABEL_RE =
  /\b(share|tweet|facebook|linkedin|whatsapp|telegram|pinterest|print|save|bookmark|related|similar|back to|home|sign\s*in|log\s*in|login|create (?:an )?account|subscribe|newsletter|advertise|cookie|privacy|terms|contact us|about us)\b/i;

const APPLY_HREF_RE =
  /(?:^|[/_.?&=-])(apply|application|applicant|careers?|vacanc(?:y|ies)|recruit(?:ment)?|jobs?|greenhouse|lever|workday|smartrecruiters|bamboohr|workable|taleo|icims|jobvite|recruitee|personio|zoho|breezy|ashby|rippling|comeet|teamtailor|forms?|typeform|jotform|airtable|formstack|tally)(?:$|[/_.?&=-])/i;

export const APPLY_URL_TYPES = {
  ATS: "ats",
  EMPLOYER_WEBSITE: "employer_website",
  EMAIL: "email_application",
  GOOGLE_FORM: "google_form",
  DOCUMENT: "document",
  EXTERNAL: "external_application",
  SOURCE_APPLICATION: "source_application",
  SOURCE: "source_page",
  LISTING: "listing_page",
  SOCIAL: "social",
  IMAGE: "image",
  UNKNOWN: "unknown",
};

const INVALID_TYPES = new Set([
  APPLY_URL_TYPES.SOURCE,
  APPLY_URL_TYPES.LISTING,
  APPLY_URL_TYPES.SOCIAL,
  APPLY_URL_TYPES.IMAGE,
  APPLY_URL_TYPES.UNKNOWN,
]);

// Per-vacancy application endpoints that happen to live on the board's own
// domain (an employer applies through the board's hosted form). These are
// genuine application destinations, not listing pages, so they are accepted —
// but they are published through our redirect so the board's domain is never
// exposed, and they carry a reduced confidence.
const SOURCE_APPLICATION_PATH_RE =
  /\/(?:job-application|jobs?\/apply|apply|application|vacancy\/apply|submit-application|recruit\/apply|careers?\/apply|company\/jobs|companies?\/[a-z0-9@._-]+\/jobs)(?:[\/?#]|$)/i;

const SOURCE_APPLICATION_LISTING_RE =
  /\/(?:jobs?|vacancies|careers?|search|job-location|job-category|categories|locations?|companies|employers|post-job|submit-job|login|register)(?:\/|\?|#|$)/i;

/**
 * True when a URL on the board's own domain is a per-vacancy application
 * destination rather than a listing, index or category page.
 *
 * Both the vacancy slug and the employer's identity are accepted as proof
 * that the URL belongs to this specific vacancy.
 */
export function isSourceApplicationPath(url, { pageUrl = "", employerName = "" } = {}) {
  const u = safeParseUrl(url);
  if (!u) return false;
  const path = `${u.pathname}${u.search}`;
  if (!SOURCE_APPLICATION_PATH_RE.test(path)) return false;
  // A listing or category path is never an application destination.
  if (SOURCE_APPLICATION_LISTING_RE.test(u.pathname) && !SOURCE_APPLICATION_PATH_RE.test(u.pathname)) return false;

  const lower = path.toLowerCase();
  // The path must reference this specific vacancy...
  const slug = String(pageUrl || "").split("/").filter(Boolean).pop() || "";
  if (slug && lower.includes(slug.toLowerCase())) return true;
  // ...or the hiring organisation (ATS company boards are addressed by
  // company rather than by vacancy).
  const tokens = String(employerName || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 6 && !/^(ethiopia|ethiopian|organization|organisation|company|group|limited|company)$/.test(t));
  if (tokens.some((t) => lower.includes(t))) return true;
  if (slug) {
    const stem = slug.replace(/[-_]?\d+$/, "");
    if (stem.length >= 6 && lower.includes(stem.toLowerCase())) return true;
  }
  return false;
}

export function classifyDestination(input, { source = null, pageUrl = "", employerName = "" } = {}) {
  const raw = String(input || "").trim();
  if (!raw) return { type: APPLY_URL_TYPES.UNKNOWN, valid: false, reason: "empty" };
  if (/^mailto:/i.test(raw)) {
    const email = raw.slice(7).split("?")[0].trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
      return { type: APPLY_URL_TYPES.UNKNOWN, valid: false, reason: "invalid_email" };
    }
    if (isSourceHost(`https://${email.split("@")[1]}`)) {
      return { type: APPLY_URL_TYPES.SOURCE, valid: false, reason: "source_email" };
    }
    return { type: APPLY_URL_TYPES.EMAIL, valid: true, reason: null };
  }

  const url = safeParseUrl(raw, pageUrl);
  if (!url) return { type: APPLY_URL_TYPES.UNKNOWN, valid: false, reason: "invalid_url" };
  if (url.username || url.password) return { type: APPLY_URL_TYPES.UNKNOWN, valid: false, reason: "credentials_in_url" };
  if (isImageUrl(url.toString())) return { type: APPLY_URL_TYPES.IMAGE, valid: false, reason: "image" };
  if (isSocialHost(url.toString())) return { type: APPLY_URL_TYPES.SOCIAL, valid: false, reason: "social" };

  const sourceHost = isSourceHost(url.toString());
  if (sourceHost && !isSourceApplicationPath(url.toString(), { pageUrl, employerName })) {
    return { type: APPLY_URL_TYPES.SOURCE, valid: false, reason: "source_host" };
  }
  if (isKnownSourceDomain(hostOf(url))) {
    if (!isSourceApplicationPath(url.toString(), { pageUrl, employerName })) {
      return { type: APPLY_URL_TYPES.SOURCE, valid: false, reason: "source_host" };
    }
  }
  if (isDocumentUrl(url.toString())) return { type: APPLY_URL_TYPES.DOCUMENT, valid: true, reason: null };
  if (isAtsHost(url.toString())) return { type: APPLY_URL_TYPES.ATS, valid: true, reason: null };
  const host = hostOf(url);
  if (/^(docs|drive)\.google\.com$/i.test(host) || /^forms\.gle$/i.test(host) || /^forms\.office\.com$/i.test(host)) {
    return { type: APPLY_URL_TYPES.GOOGLE_FORM, valid: true, reason: null };
  }
  if (isListingUrl(url.toString()) || (pageUrl && sameSite(url.toString(), pageUrl) && isListingUrl(url.toString()))) {
    return { type: APPLY_URL_TYPES.LISTING, valid: false, reason: "listing_page" };
  }
  if (pageUrl && sameSite(url.toString(), pageUrl)) {
    // Same-site links are only useful when they are a real employer career page.
    if (source && isSourceHost(pageUrl)) {
      // A per-vacancy application form hosted by the board itself.
      if (isSourceApplicationPath(url.toString(), { pageUrl, employerName })) {
        return { type: APPLY_URL_TYPES.SOURCE_APPLICATION, valid: true, reason: null };
      }
      return { type: APPLY_URL_TYPES.SOURCE, valid: false, reason: "same_as_source" };
    }
    if (isLikelyJobUrl(url.toString())) {
      return { type: APPLY_URL_TYPES.UNKNOWN, valid: false, reason: "same_site_job_page" };
    }
    return { type: APPLY_URL_TYPES.EMPLOYER_WEBSITE, valid: true, reason: null };
  }
  if (sourceHost) {
    return { type: APPLY_URL_TYPES.SOURCE_APPLICATION, valid: true, reason: null };
  }
  return { type: APPLY_URL_TYPES.EXTERNAL, valid: true, reason: null };
}

function hostKey(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function addCandidate(list, candidate) {
  if (!candidate?.url) return;
  const key = candidate.url.startsWith("mailto:")
    ? candidate.url.toLowerCase()
    : canonicalUrl(candidate.url) || candidate.url;
  const existing = list.find((c) => (c.url.startsWith("mailto:") ? c.url.toLowerCase() : canonicalUrl(c.url) || c.url) === key);
  if (existing) {
    if (candidate.confidence > existing.confidence) {
      existing.confidence = candidate.confidence;
      existing.source = candidate.source;
      existing.label = candidate.label || existing.label;
      existing.context = candidate.context || existing.context;
    }
    existing.sources = [...new Set([...(existing.sources || []), candidate.source])];
    return;
  }
  list.push({ ...candidate, url: key, sources: [candidate.source] });
}

function labelFromAnchor(a) {
  return collapseWhitespace([a.text, a.title, a.ariaLabel, a.className, a.id].filter(Boolean).join(" "));
}

function confidenceFor({ type, origin, label, section = "" }) {
  let score = 30;
  if (type === APPLY_URL_TYPES.ATS) score = 96;
  else if (type === APPLY_URL_TYPES.GOOGLE_FORM) score = 90;
  else if (type === APPLY_URL_TYPES.DOCUMENT) score = 78;
  else if (type === APPLY_URL_TYPES.EMAIL) score = origin === "how_to_apply" ? 92 : 68;
  else if (type === APPLY_URL_TYPES.EMPLOYER_WEBSITE) score = 74;
  else if (type === APPLY_URL_TYPES.EXTERNAL) score = 66;
  // A board-hosted application form is a real destination, but it is the
  // board's own page, so it is scored lower than a first-party employer flow.
  else if (type === APPLY_URL_TYPES.SOURCE_APPLICATION) score = 62;

  if (APPLY_LABEL_RE.test(label || "")) score += 12;
  if (origin === "how_to_apply") score += 8;
  if (origin === "jsonld_direct_apply") score = Math.max(score, 92);
  if (origin === "form") score = Math.max(score, 82);
  if (origin === "description") score = Math.min(score, 60);
  if (origin === "inline_js") score = Math.min(score, 70);
  if (section && /how to apply|application/i.test(section)) score += 4;
  if (type === APPLY_URL_TYPES.SOURCE_APPLICATION) score = Math.min(score, 70);
  return Math.max(0, Math.min(100, score));
}

function makeCandidate({ url, origin, label = "", context = "", source = null, pageUrl = "", section = "", employerName = "" }) {
  const dest = classifyDestination(url, { source, pageUrl, employerName });
  const type = dest.type;
  const confidence = dest.valid ? confidenceFor({ type, origin, label, section }) : 0;
  return {
    url: type === APPLY_URL_TYPES.EMAIL ? String(url).replace(/^mailto:/i, "").toLowerCase() : url,
    urlType: type,
    confidence,
    source: origin,
    label: label || null,
    context: context ? String(context).slice(0, 500) : null,
    valid: dest.valid,
    reason: dest.reason || null,
    status: dest.valid ? "candidate" : "rejected",
  };
}

/**
 * Detect every plausible application destination and rank them.
 *
 * @returns {{
 *   selected: object|null,
 *   candidates: object[],
 *   ambiguous: boolean,
 *   needsReview: boolean,
 *   applicationEmail: string|null,
 *   reason: string|null
 * }}
 */
export function detectApplicationLinks({
  html = "",
  text = "",
  pageUrl = "",
  source = null,
  jsonLd = null,
  meta = {},
  applicationInstructions = "",
  employerName = "",
} = {}) {
  const candidates = [];
  const bodyText = text || htmlToText(html);
  const howToApply = applicationInstructions || extractSectionText(html, [
    "How to Apply",
    "How To Apply",
    "How to apply",
    "Application Instructions",
    "Application Process",
    "Application Procedure",
    "To Apply",
    "Apply",
  ], ["About", "Requirements", "Qualifications", "Description", "Benefits", "Related", "Similar"]);

  const sourceDomains = [];
  if (source) {
    for (const u of [source.base_url, source.listing_url]) {
      const h = hostOf(u);
      if (h) sourceDomains.push(h);
    }
  }

  // 1) JSON-LD direct-apply metadata.
  if (jsonLd && typeof jsonLd === "object") {
    const direct = jsonLd.directApply === true || jsonLd.directApply === "true";
    const ldUrl = jsonLd.url || jsonLd.applicationUrl || jsonLd.sameAs;
    if (direct && ldUrl) {
      addCandidate(candidates, makeCandidate({
        url: absolutize(ldUrl, pageUrl),
        origin: "jsonld_direct_apply",
        label: "JSON-LD directApply",
        source,
        pageUrl,
        employerName,
      }));
    }
    const contact = jsonLd.applicationContact;
    if (contact) {
      const value = typeof contact === "string" ? contact : contact.url || contact.email || contact.value;
      if (value) {
        const url = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value) ? `mailto:${value}` : absolutize(value, pageUrl);
        addCandidate(candidates, makeCandidate({
          url,
          origin: "jsonld_application_contact",
          label: "JSON-LD applicationContact",
          source,
          pageUrl,
          employerName,
        }));
      }
    }
  }

  // 2) Anchors (buttons are often <a>).
  for (const a of extractAnchors(html)) {
    const href = a.href || "";
    if (!href || href.startsWith("#")) continue;
    const label = labelFromAnchor(a);
    const resolved = absolutize(decodeRedirectUrl(href, pageUrl) || href, pageUrl);
    if (!resolved) continue;
    const looksApply = APPLY_LABEL_RE.test(label) || APPLY_LABEL_RE.test(a.rawAttrs?.["data-action"] || "");
    const looksApplyHref = APPLY_HREF_RE.test(href);
    if (!looksApply && !looksApplyHref) continue;
    if (NEGATIVE_LABEL_RE.test(label) && !looksApply) continue;
    addCandidate(candidates, makeCandidate({
      url: resolved,
      origin: "anchor",
      label,
      context: a.className || a.id,
      source,
      pageUrl,
      employerName,
    }));
  }

  // 3) Forms — an application form action is a strong signal.
  for (const form of extractForms(html)) {
    if (!form.action || /^(#|javascript:)/i.test(form.action)) continue;
    const resolved = absolutize(form.action, pageUrl);
    if (!resolved) continue;
    const label = collapseWhitespace(`${form.className} ${form.id} ${htmlToText(form.inner).slice(0, 120)}`);
    if (!/apply|application|applicant|career|recruit|submit/i.test(label) && !APPLY_HREF_RE.test(form.action)) continue;
    addCandidate(candidates, makeCandidate({
      url: resolved,
      origin: "form",
      label: `Application form${label ? `: ${label.slice(0, 80)}` : ""}`,
      source,
      pageUrl,
      employerName,
    }));
  }

  // 4) "How to Apply" section: emails and URLs are the most reliable evidence.
  if (howToApply) {
    for (const email of findEmails(howToApply, { sourceDomains })) {
      addCandidate(candidates, makeCandidate({
        url: `mailto:${email}`,
        origin: "how_to_apply",
        label: `Email in How to Apply: ${email}`,
        context: howToApply.slice(0, 400),
        source,
        pageUrl,
        employerName,
      }));
    }
    for (const u of extractUrlsFromText(howToApply, pageUrl)) {
      addCandidate(candidates, makeCandidate({
        url: u,
        origin: "how_to_apply",
        label: "Link in How to Apply",
        context: howToApply.slice(0, 400),
        source,
        pageUrl,
        employerName,
        section: howToApply,
      }));
    }
  }

  // 5) Description body: weaker evidence, still useful.
  for (const email of findEmails(bodyText, { sourceDomains })) {
    addCandidate(candidates, makeCandidate({
      url: `mailto:${email}`,
      origin: "description",
      label: `Email in description: ${email}`,
      source,
      pageUrl,
      employerName,
    }));
  }
  for (const u of extractUrlsFromText(bodyText, pageUrl)) {
    addCandidate(candidates, makeCandidate({
      url: u,
      origin: "description",
      label: "Link in description",
      source,
      pageUrl,
      employerName,
    }));
  }

  // 6) Inline JavaScript navigation (some sources redirect on button click).
  for (const raw of extractInlineNavigation(html)) {
    const resolved = absolutize(raw, pageUrl);
    if (!resolved) continue;
    addCandidate(candidates, makeCandidate({
      url: resolved,
      origin: "inline_js",
      label: "JavaScript navigation",
      source,
      pageUrl,
      employerName,
    }));
  }

  // 7) Meta refresh redirect.
  const refresh = String(meta["refresh"] || meta["http-equiv"] || "");
  if (refresh) {
    const m = /url\s*=\s*([^;]+)/i.exec(refresh);
    if (m) {
      const resolved = absolutize(m[1].trim(), pageUrl);
      if (resolved) {
        addCandidate(candidates, makeCandidate({ url: resolved, origin: "meta_refresh", label: "Meta refresh", source, pageUrl }));
      }
    }
  }

  const valid = candidates
    .filter((c) => c.valid && !INVALID_TYPES.has(c.urlType))
    .sort((a, b) => b.confidence - a.confidence);

  const pageHost = hostKey(pageUrl);
  const isIntermediate = (c) => {
    if (!c) return false;
    if (c.urlType === APPLY_URL_TYPES.SOURCE_APPLICATION) return true;
    const h = hostKey(c.url);
    // Prefer direct external destinations over the discovery/source listing page itself.
    if (pageHost && h && h === pageHost) return true;
    if (isKnownSourceDomain(h) || isKnownSourceDomain(c.url || "")) return true;
    return false;
  };

  const direct = valid.filter((c) => !isIntermediate(c));
  let selected = direct[0] || valid[0] || null;
  // If the top-ranked candidate is intermediate but a plausible direct destination exists, prefer it.
  if (selected && isIntermediate(selected) && direct.length) {
    selected = direct[0];
  }

  const top = selected;
  const runner = valid.find((c) => c !== top) || null;
  const ambiguous = !!(
    top && runner &&
    hostKey(top.url) !== hostKey(runner.url) &&
    !isIntermediate(top) && !isIntermediate(runner) &&
    (top.confidence - runner.confidence <= 8)
  );

  const applicationEmail = (direct.find((c) => c.urlType === APPLY_URL_TYPES.EMAIL) || valid.find((c) => c.urlType === APPLY_URL_TYPES.EMAIL))?.url || null;
  const needsReview = !selected || ambiguous || selected.confidence < 60;

  return {
    selected,
    candidates: candidates.sort((a, b) => b.confidence - a.confidence),
    ambiguous,
    needsReview,
    applicationEmail,
    reason: !selected
      ? "no_valid_destination"
      : ambiguous
        ? "ambiguous_candidates"
        : selected.confidence < 60
          ? "low_confidence"
          : null,
  };
}

export function isPubliclySafeApplyUrl(url, { source = null } = {}) {
  const dest = classifyDestination(url, { source });
  return dest.valid && !INVALID_TYPES.has(dest.type);
}
