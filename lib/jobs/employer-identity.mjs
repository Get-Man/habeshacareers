// Employer identity inference.
//
// The hosting site is never the employer. A vacancy published on a job board
// may have been written by the employer itself (an "original" announcement)
// or copied from the employer's own careers page ("aggregated"). Either way
// the reader needs to know WHO is hiring and where to apply.
//
// This module answers two questions from the data we already hold:
//   1. Which organisation is the employer?  (name → canonical identity)
//   2. Which website belongs to that organisation?  (their own domain)
//
// The domain is inferred from, in order of trust:
//   a. the application URL, when it is hosted on the employer's own site
//   b. the application mailbox's domain
//   c. a link inside the announcement text
//   d. a curated map of well-known Ethiopian and international organisations
//
// A discovery source's domain is never accepted: the board that published the
// vacancy is not the employer.

import { baseDomain, hostOf, isKnownSourceDomain } from "./extract/hosts.mjs";
import { isGenericHost } from "./apply-destination.mjs";

// Organisations whose own website is known. The pattern is matched against
// the employer name; the first hit wins, so more specific patterns come
// first. These are the employers whose vacancies appear most often.
export const EMPLOYER_DOMAIN_HINTS = [
  // International organisations and agencies
  [/unicef/i, "unicef.org"],
  [/united nations development programme|\bundp\b/i, "undp.org"],
  [/united nations population fund|\bunfpa\b/i, "unfpa.org"],
  [/united nations children|\bunicef\b/i, "unicef.org"],
  [/united nations humanitarian affairs|\bocha\b|unocha/i, "unocha.org"],
  [/united nations office|\buno\b/i, "un.org"],
  [/united nations high commissioner for refugees|\bunhcr\b|refugees/i, "unhcr.org"],
  [/world health organization|\bwho\b/i, "who.int"],
  [/world food programme|\bwfp\b/i, "wfp.org"],
  [/international labour organization|\bilo\b/i, "ilo.org"],
  [/food and agriculture organization|\bfao\b/i, "fao.org"],
  [/world trade organization|\bwto\b/i, "wto.org"],
  [/world health organization.*\bafrica\b|\bafro\b/i, "who.int"],
  [/international organization for migration|\biom\b/i, "iom.int"],
  [/un women|united nations entity for gender/i, "unwomen.org"],
  [/united nations development program.*ethiopia/i, "undp.org"],
  [/united nations economic commission for africa|\beca\b/i, "uneca.org"],
  [/international monetary fund|\bimf\b/i, "imf.org"],
  [/world bank|\bifc\b/i, "worldbank.org"],
  [/usaid|united states agency for international development/i, "usaid.gov"],
  [/foreign service|embassy of the united states/i, "state.gov"],
  [/british embassy|embassy of the united kingdom/i, "gov.uk"],
  [/embassy of the canada/i, "canada.ca"],
  [/embassy of the germany|german embassy/i, "auswaertiges-amt.de"],
  [/embassy of the netherlands/i, "government.nl"],
  [/embassy of ireland/i, "ireland.ie"],
  [/embassy of japan/i, "mofa.go.jp"],
  [/embassy of the united states/i, "state.gov"],
  [/embassy of italy/i, "esteri.it"],
  [/embassy of france/i, "diplomatie.gouv.fr"],
  [/international rescue committee|\birc\b/i, "rescue.org"],
  [/mercy corps/i, "mercycorps.org"],
  [/save the children/i, "savethechildren.net"],
  [/world vision/i, "worldvision.org"],
  [/plan international/i, "plan-international.org"],
  [/care international|\bcare\b/i, "care.org"],
  [/oxfam/i, "oxfam.org"],
  [/amref/i, "amref.org"],
  [/path international|\bpath\b/i, "path.org"],
  [/jhpiego/i, "jhpiego.org"],
  [/fhi 360|\bfhi360\b/i, "fhi360.org"],
  [/population services international|\bps international\b/i, "psi.org"],
  [/giz|german international cooperation/i, "giz.de"],
  [/international labour organization/i, "ilo.org"],
  [/red cross|ethiopian red cross/i, "ifrc.org"],
  [/ifrc|international federation of red cross/i, "ifrc.org"],
  [/international medical corps|\bimc\b/i, "internationalmedicalcorps.org"],
  [/medecins sans frontieres|\bmsf\b/i, "msf.org"],
  [/habitat for humanity/i, "habitat.org"],
  [/water aid/i, "wateraid.org"],
  [/international rescue/i, "rescue.org"],
  [/helen keller international/i, "hki.org"],
  [/sight savers/i, "sightsavers.org"],
  [/cbm international/i, "cbm.org"],
  [/danish refugee council/i, "drc.dk"],
  [/netherlands development organisation|\snv\b/i, "snv-world.org"],
  [/norwegian refugee council/i, "nrc.no"],
  [/danish humanitarian council/i, "danishhumanitarian.org"],
  [/swiss agency for development/i, "eda.admin.ch"],
  [/welthungerhilfe/i, "welthungerhilfe.org"],

  // Ethiopian organisations
  [/ethiopian airlines/i, "ethiopianairlines.com"],
  [/ethio telecom|ethiopian telecom/i, "ethiotelecom.et"],
  [/commercial bank of ethiopia|\bcbe\b/i, "combanketh.et"],
  [/bank of ethiopia|central bank of ethiopia|\bbe\b/i, "birr.com"],
  [/development bank of ethiopia|\bdbe\b/i, "dbe.com.et"],
  [/agricultural development bank/i, "adbank.com.et"],
  [/dashen bank/i, "dashenbank.com.et"],
  [/bank of abyssinia/i, "bankofabyssinia.com"],
  [/awash insurance/i, "awashinsurance.com"],
  [/ethiopian insurance/i, "ethioinsurance.com"],
  [/ethio telecom\b/i, "ethiotelecom.et"],
  [/ethiopian electricity|eeep|ethiopian electric power/i, "eep.com.et"],
  [/ethiopian petroleum|\bethiopian petroleum\b|eep/i, "petroleum.gov.et"],
  [/ethiopian telecom\b/i, "ethiotelecom.et"],
  [/ethiopian airlines cargo/i, "ethiopianairlines.com"],
  [/ethiopian revenue/i, "ethiopianrevenue.gov.et"],
  [/ministry of health|\bmoh\b/i, "moh.gov.et"],
  [/ministry of education/i, "moe.gov.et"],
  [/ministry of agriculture/i, "moa.gov.et"],
  [/ethiopian food and drug/i, "efda.gov.et"],
  [/water and sewerage|utility/i, "wueco.et"],
  [/national bank|bank of ethiopia/i, "birr.com"],
  [/ethiopian investment|investment agency/i, "eia.et"],
  [/coffee and tea authority/i, "cta.gov.et"],
  [/ethiopian tourism/i, "ethiopia.travel"],
  [/ Ethiopian telecom/i, "ethiotelecom.et"],

  // Large private Ethiopian companies
  [/jiva school/i, "jivaschool.com"],
  [/kality foods/i, "kalityfoods.com.et"],
  [/hijra bank/i, "hijrabank.com"],
  [/beaeka|beaeka general business/i, "beaeka.com"],
  [/nib candy|nib international/i, "nibintl.com"],
  [/new paradigm/i, "newparadigmconsultancy.com"],
  [/abyssinia group/i, "abyssinia-group.com"],
  [/tana group/i, "tanagroup.com"],
  [/midroc/i, "midroc.com"],
  [/cargill/i, "cargill.com"],
  [/metropolitan real estate/i, "metropolitan.com.et"],
  [/shine registry/i, "shineregistry.com"],
  [/addis ababa university/i, "aau.edu.et"],
  [/addis ababa science and technology/i, "aast.edu.et"],
  [/st marys university/i, "smuc.edu.et"],
  [/bahir dar university/i, "bdu.edu.et"],
  [/hawassa university/i, "uun.edu.et"],
  [/mekelle university/i, "mu.edu.et"],
  [/jimma university/i, "ju.edu.et"],
  [/gondar university/i, "uog.edu.et"],
  [/arbabe koye college/i, "aau.edu.et"],
  [/tesfaye pharma/i, "tesfayepharma.com"],
  [/rida pharma/i, "ridapharma.com"],
  [/marathon/i, "marathon.et"],
  [/sos Ethiopia/i, "sosethiopia.org"],
  [/hlda/i, "hlda.edu.et"],
  [/stephans academy/i, "stephansacademy.edu.et"],
  [/international school of ethiopia/i, "ise.edu.et"],
  [/ethiopian airlines hotel/i, "ethiopianhotels.com"],
  [/ethio telecom\b/i, "ethiotelecom.et"],
];

// Paths an employer commonly uses for its own vacancies page. The backfill
// probes these and keeps the first one that really exists.
export const CAREERS_PATH_CANDIDATES = [
  "/careers",
  "/careers/",
  "/jobs",
  "/jobs/",
  "/vacancies",
  "/vacancies/",
  "/job-opportunities",
  "/opportunities",
  "/en/careers",
  "/en/jobs",
  "/about-us/careers",
  "/company/careers",
  "/work-with-us",
  "/join-us",
  "/join-our-team",
  "/current-vacancies",
  "/available-jobs",
  "/open-positions",
  "/recruitment",
];

/**
 * A domain is only useful when it is a real, organisation-specific web
 * domain. Generic services, social hosts, shared mailboxes and — above all —
 * discovery sources are rejected.
 */
export function usableEmployerDomain(domain) {
  const clean = String(domain || "").toLowerCase().replace(/^www\./, "");
  if (!clean || !clean.includes(".")) return null;
  if (clean.endsWith(".gov.et") || clean.endsWith(".edu.et")) return clean;
  if (isGenericHost(clean)) return null;
  if (isKnownSourceDomain(clean)) return null;
  if (isKnownSourceDomain(baseDomain(clean))) return null;
  // A bare two-label country domain is almost never the organisation's site.
  if (!clean.includes(".")) return null;
  return clean;
}

/**
 * Guess the organisation's website from its name.
 */
export function domainFromEmployerName(company) {
  const name = String(company || "");
  if (!name.trim()) return null;
  for (const [pattern, domain] of EMPLOYER_DOMAIN_HINTS) {
    if (pattern.test(name)) return domain;
  }
  return null;
}

/**
 * Infer the employer's own domain from the vacancy data.
 *
 * @param {object} input
 * @param {string} [input.company]       the employer name as published
 * @param {string} [input.applyUrl]      the application destination
 * @param {string} [input.email]         the application mailbox
 * @param {string} [input.description]   the announcement text
 * @returns {{domain: string|null, url: string|null, source: string, confidence: number}}
 */
export function inferEmployerDomain({ company = "", applyUrl = "", email = "", description = "" } = {}) {
  // a) The application URL, when it is hosted by the organisation itself.
  const applyHost = hostOf(applyUrl);
  if (applyHost) {
    const candidate = usableEmployerDomain(baseDomain(applyHost));
    if (candidate) {
      return { domain: candidate, url: `https://${candidate}/`, source: "apply_url", confidence: 80 };
    }
  }

  // b) The application mailbox's domain.
  const mailDomain = String(email || "").split("@")[1] || "";
  if (mailDomain) {
    const candidate = usableEmployerDomain(mailDomain);
    if (candidate) {
      return { domain: candidate, url: `https://${candidate}/`, source: "application_email", confidence: 70 };
    }
  }

  // c) A link inside the announcement text.
  const text = String(description || "");
  const urls = text.match(/https?:\/\/[^\s"'<>)\]]+/gi) || [];
  for (const raw of urls) {
    const host = hostOf(raw);
    const candidate = usableEmployerDomain(baseDomain(host));
    if (!candidate) continue;
    // A link that looks like a job board, a social profile or a document is
    // not the organisation's homepage.
    if (/(careers|jobs?|vacanc|recruit|apply|board)\b/i.test(host)) continue;
    if (/\/pdf|\/doc/i.test(raw)) continue;
    return { domain: candidate, url: `https://${candidate}/`, source: "announcement_link", confidence: 55 };
  }

  // d) A curated map of well-known organisations.
  const known = domainFromEmployerName(company);
  if (known) {
    return { domain: known, url: `https://${known}/`, source: "known_employer", confidence: 65 };
  }

  return { domain: null, url: null, source: "unknown", confidence: 0 };
}

/**
 * Build the candidate list of careers pages for a domain.
 */
export function careersUrlCandidates(domain, websiteUrl = null) {
  const base = websiteUrl || (domain ? `https://${domain}` : null);
  if (!base) return [];
  const trimmed = String(base).replace(/\/+$/, "");
  return CAREERS_PATH_CANDIDATES.map((path) => `${trimmed}${path}`);
}

export { isGenericHost };
