// Application-destination intelligence.
//
// Every vacancy must end up with ONE visible "Apply Now" button that goes to
// the most likely place a candidate can actually apply. This module decides
// which destination that is and how it should be described to the reader.
//
// The distinction that matters to a reader:
//   * OFFICIAL_EMPLOYER — the employer's own website (their careers page, their
//     own hosted application form).
//   * OFFICIAL_ATS      — the employer's own recruitment portal on an ATS
//     (Greenhouse, Workday, SuccessFactors…). Still the employer's own flow,
//     even though the ATS vendor hosts it.
//   * THIRD_PARTY       — a destination hosted by somebody else (a job board,
//     a form service, a short-link service). Usable, but the reader should
//     know it is not the employer's own site.
//   * EMAIL             — the employer's application mailbox.
//   * EMPLOYER_CAREERS  — no exact application link was published; the
//     employer's own careers page is the best available destination.
//
// This module is pure: no network, no database. It is shared by the API
// mapper, the server-rendered job page and the client renderer so the same
// wording is used everywhere.

import { baseDomain, hostOf, isAtsHost, isKnownSourceDomain, isSocialHost, safeParseUrl } from "./extract/hosts.mjs";

export const APPLY_KINDS = {
  OFFICIAL_EMPLOYER: "official_employer",
  OFFICIAL_ATS: "official_ats",
  THIRD_PARTY: "third_party",
  EMAIL: "email",
  EMPLOYER_CAREERS: "employer_careers",
  NONE: "none",
};

// Hosts that are a form service, a link shortener or a shared mailbox. They
// are never the employer's own website, so they never yield an official
// destination.
const FORM_SERVICE_DOMAINS = [
  "forms.gle",
  "docs.google.com",
  "drive.google.com",
  "typeform.com",
  "jotform.com",
  "formstack.com",
  "surveymonkey.com",
  "tally.so",
  "airtable.com",
  "shorturl.at",
  "tinyurl.com",
  "bit.ly",
  "rb.gy",
  "is.gd",
  "cutt.ly",
  "rebrand.ly",
  "linktr.ee",
  "t.me",
  "wa.me",
  "mailto",
];

// Free mailboxes: the domain says nothing about the employer's website.
const FREEMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "icloud.com",
  "mail.com",
  "zoho.com",
  "gmx.com",
];

function matchesAny(host, list) {
  const clean = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!clean) return false;
  return list.some((d) => clean === d || clean.endsWith(`.${d}`));
}

/**
 * True when a host is a generic service rather than an organisation's own
 * website (form builders, link shorteners, shared mailboxes, social hosts).
 */
export function isGenericHost(host) {
  const clean = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!clean) return true;
  if (matchesAny(clean, FORM_SERVICE_DOMAINS)) return true;
  if (matchesAny(clean, FREEMAIL_DOMAINS)) return true;
  if (isSocialHost(`https://${clean}`)) return true;
  return false;
}

/**
 * True when `host` belongs to the organisation identified by `domain`.
 */
export function belongsToEmployer(host, domain) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const d = String(domain || "").toLowerCase().replace(/^www\./, "");
  if (!h || !d) return false;
  if (h === d) return true;
  if (h.endsWith(`.${d}`)) return true;
  const hb = baseDomain(h);
  const db = baseDomain(d);
  return !!hb && !!db && hb === db;
}

const DESCRIPTIONS = {
  [APPLY_KINDS.OFFICIAL_EMPLOYER]: {
    label: "Apply Now",
    buttonLabel: "Apply Now",
    badge: "Official employer link",
    badgeClass: "badge-official",
    note: "Opens the employer's own application page.",
    official: true,
  },
  [APPLY_KINDS.OFFICIAL_ATS]: {
    label: "Apply Now",
    buttonLabel: "Apply Now",
    badge: "Official employer link",
    badgeClass: "badge-official",
    note: "Opens the employer's own recruitment portal.",
    official: true,
  },
  [APPLY_KINDS.THIRD_PARTY]: {
    label: "Apply Now",
    buttonLabel: "Apply Now",
    badge: "Third-party application",
    badgeClass: "badge-third-party",
    note: "This vacancy was published on another platform. The link opens that application form.",
    official: false,
  },
  [APPLY_KINDS.EMAIL]: {
    label: "Apply by email",
    buttonLabel: "Apply Now",
    badge: "Application email",
    badgeClass: "badge-neutral",
    note: "Sends your application directly to the employer.",
    official: true,
  },
  [APPLY_KINDS.EMPLOYER_CAREERS]: {
    label: "View careers page",
    buttonLabel: "Apply Now",
    badge: "Official careers page",
    badgeClass: "badge-official",
    note: "No direct application link was published for this vacancy, so this opens the employer's own careers page.",
    official: true,
  },
  [APPLY_KINDS.NONE]: {
    label: "Apply",
    buttonLabel: "Apply Now",
    badge: "Application details below",
    badgeClass: "badge-neutral",
    note: "This vacancy does not publish an application link. The employer's application details are listed in the vacancy.",
    official: false,
  },
};

/**
 * Decide where "Apply Now" should send the reader.
 *
 * @param {object} input
 * @param {string} [input.applyUrl]        the validated application URL
 * @param {string} [input.applicationEmail] the employer's application mailbox
 * @param {string} [input.employerDomain]   the employer's own domain
 * @param {string} [input.employerWebsite]  the employer's own website
 * @param {string} [input.careersUrl]       the employer's own careers page
 * @param {boolean} [input.applyVerified]  the destination was independently verified
 * @returns {{
 *   kind: string, url: string|null, label: string, buttonLabel: string,
 *   badge: string|null, badgeClass: string, note: string, official: boolean,
 *   verified: boolean, source: string
 * }}
 */
export function classifyApplyDestination({
  applyUrl = null,
  applicationEmail = null,
  employerDomain = null,
  employerWebsite = null,
  careersUrl = null,
  applyVerified = false,
} = {}) {
  const url = String(applyUrl || "").trim();
  const email = String(applicationEmail || "").trim();
  const domain = String(employerDomain || "").trim().toLowerCase();

  const build = (kind, target, extra = {}) => {
    const meta = DESCRIPTIONS[kind];
    let note = meta.note;
    let verified = !!applyVerified;
    // Before displaying an external application URL we must not imply it is
    // reliable unless it has been verified. Unverified destinations are still
    // usable when they look plausible, but the reader is told clearly.
    if (target && /^https?:/i.test(target) && !verified && kind !== APPLY_KINDS.EMPLOYER_CAREERS) {
      note = "This application link could not be independently verified. Confirm the vacancy on the employer’s official page before applying.";
    }
    if (!target) {
      note = "No reliable application link could be verified for this vacancy. Use the employer’s official contact or application details below.";
      verified = false;
    }
    return {
      kind,
      url: target || null,
      label: meta.label,
      buttonLabel: meta.buttonLabel,
      badge: meta.badge,
      badgeClass: meta.badgeClass,
      note,
      official: meta.official,
      verified,
      source: extra.source || kind,
    };
  };

  if (url) {
    if (/^mailto:/i.test(url)) {
      return build(APPLY_KINDS.EMAIL, url, { source: "email" });
    }
    const parsed = safeParseUrl(url);
    if (!parsed || !/^https?:$/i.test(parsed.protocol)) {
      // A broken or non-navigable link must not become the Apply destination.
    } else {
      const host = hostOf(url);
      if (domain && belongsToEmployer(host, domain)) {
        return build(APPLY_KINDS.OFFICIAL_EMPLOYER, url, { source: "employer_site" });
      }
      if (isGenericHost(host)) {
        // A form builder, a shared mailbox or a short link: it works, but it
        // is not the employer's own site, so it is described honestly.
        return build(APPLY_KINDS.THIRD_PARTY, url, { source: "third_party" });
      }
      if (isAtsHost(url)) {
        // The ATS hosts the employer's own board: still an official flow.
        return build(APPLY_KINDS.OFFICIAL_ATS, url, { source: "ats" });
      }
      if (employerWebsite && belongsToEmployer(host, hostOf(employerWebsite))) {
        return build(APPLY_KINDS.OFFICIAL_EMPLOYER, url, { source: "employer_site" });
      }
      if (isKnownSourceDomain(host) || isKnownSourceDomain(baseDomain(host))) {
        // A discovery source's own page is never a real application flow.
        return build(APPLY_KINDS.THIRD_PARTY, url, { source: "third_party" });
      }
      return build(APPLY_KINDS.THIRD_PARTY, url, { source: "third_party" });
    }
  }

  if (email && /@/.test(email)) {
    return build(APPLY_KINDS.EMAIL, `mailto:${email}`, { source: "email" });
  }

  if (careersUrl) {
    return build(APPLY_KINDS.EMPLOYER_CAREERS, careersUrl, { source: "employer_careers" });
  }

  // The employer's own website/careers page is the last reliable resort.
  if (careersUrl) {
    return build(APPLY_KINDS.EMPLOYER_CAREERS, careersUrl, { source: "employer_careers" });
  }
  if (employerWebsite && /^https?:\/\//i.test(employerWebsite)) {
    return build(APPLY_KINDS.EMPLOYER_CAREERS, employerWebsite, { source: "employer_site" });
  }

  return build(APPLY_KINDS.NONE, null, { source: "none" });
}

/**
 * A ready-to-use mailto link with a subject line that names the vacancy.
 */
export function applyMailtoLink(email, title) {
  const subject = encodeURIComponent(`Application for ${String(title || "this position")}`);
  return `mailto:${String(email || "").trim()}?subject=${subject}`;
}

export { DESCRIPTIONS as APPLY_DESTINATION_DESCRIPTIONS };
