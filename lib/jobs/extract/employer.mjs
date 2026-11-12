// Employer / hiring-organisation identification.
// The employer is always the actual hiring organization — never the discovery
// source, job board or aggregator.

import { collapseWhitespace, decodeEntities, extractH1, extractTitleTag, htmlToText } from "./html.mjs";
import { baseDomain, hostOf, isKnownSourceDomain, isSourceHost, sameSite } from "./hosts.mjs";
import { orgLogoUrl } from "../utils.mjs";

export const UNVERIFIED_ORGANIZATION = "Organization not verified";

const SOURCE_BRAND_RE =
  /\b(geezjobs|geez jobs|ethiojobs|ethio jobs|ethio-jobs|etcareers|et careers|workethiopia|work ethiopia|alljobspo|jobsinethiopia|ethiopian reporter jobs|reporterjobs|reliefweb|un careers|unjobs|hahu jobs|dereja|ezega|jobwebethiopia|ngojobs|sirazone|srazone|jobs ethiopia)\b/i;

const GENERIC_RE =
  /^(?:jobs?|vacancies|vacancy|careers?|job board|job portal|job listing|job opportunity|opportunity|position|opening|employment|recruitment|unknown|n\/?a|none|not specified|not stated|confidential|various|multiple|see below|employer|company|organization)$/i;

const SOURCE_SUFFIX_RE =
  /\s*[|–—:-]\s*(?:geezjobs(?:\.com)?|ethiojobs(?:\.net)?|ethio-jobs(?:\.net\.et)?|et\s*careers(?:\.com)?|workethiopia(?:\.net)?|alljobspo(?:\.com)?|ethiopian\s*reporter\s*jobs|reliefweb|un\s*careers|unjobs|hahu\s*jobs|dereja|ezega|jobwebethiopia|ngojobs(?:\.et)?|sirazone|srazone)\s*$/i;

export function cleanOrgName(value) {
  let name = collapseWhitespace(decodeEntities(htmlToText(value)));
  if (!name) return "";
  name = name.replace(SOURCE_SUFFIX_RE, "").trim();
  name = name.replace(/^@\s*/, "");
  name = name.replace(/^(?:company|organization|organisation|employer|hiring organization)\s*[:\-]\s*/i, "");
  name = name.replace(/\s+(?:is\s+hiring|hiring|recruiting|vacancy|jobs?|careers?)\s*$/i, "").trim();
  name = name.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (name.length > 160) name = name.slice(0, 160).trim();
  return name;
}

export function isGenericOrganization(name) {
  const n = collapseWhitespace(name);
  if (!n) return true;
  if (GENERIC_RE.test(n)) return true;
  if (SOURCE_BRAND_RE.test(n) && n.split(/\s+/).length <= 5) return true;
  return false;
}

function isSourceName(name, source) {
  const n = collapseWhitespace(name).toLowerCase();
  if (!n) return true;
  if (SOURCE_BRAND_RE.test(n) && n.split(/\s+/).length <= 5) return true;
  const sourceName = collapseWhitespace(source?.name || "").toLowerCase();
  if (sourceName && (n === sourceName || n.includes(sourceName) || sourceName.includes(n))) return true;
  const sourceDomain = baseDomain(hostOf(source?.base_url || source?.listing_url || ""));
  if (sourceDomain && n.includes(sourceDomain)) return true;
  return false;
}

function scoreCandidate(name, confidence, evidence) {
  return { name, confidence, evidence };
}

function titleCandidates(title, h1) {
  const out = [];
  for (const text of [title, h1]) {
    if (!text) continue;
    let m;
    if ((m = /\bjob\s+at\s+(.+?)(?:\s*[|–—]|$)/i.exec(text))) out.push(scoreCandidate(cleanOrgName(m[1]), 74, "title_job_at"));
    if ((m = /\b(?:jobs?|vacancies|careers?)\s+(?:at|with)\s+(.+?)(?:\s*[|–—]|$)/i.exec(text))) out.push(scoreCandidate(cleanOrgName(m[1]), 72, "title_jobs_at"));
    if ((m = /^(.+?)\s+(?:vacancy|job|career|position|opening)\b/i.exec(text))) out.push(scoreCandidate(cleanOrgName(m[1]), 62, "title_prefix"));
    if ((m = /^(.+?)\s*[|–—]\s*(?:job|vacancy|career|position|opening)\b/i.exec(text))) out.push(scoreCandidate(cleanOrgName(m[1]), 64, "title_prefix_sep"));
    if ((m = /\bat\s+([A-Z][\w&.,'’() -]{2,90}?)(?:\s*[|–—]|$)/.exec(text))) out.push(scoreCandidate(cleanOrgName(m[1]), 58, "title_at"));
  }
  return out;
}

const LABEL_RE =
  /(?:^|\n)\s*(?:company|organization|organisation|employer|hiring organization|organization name|company name|posted by|advertiser)\s*[:\-]\s*([^\n]{2,140})/gi;

const AT_H2_RE = /<h2[^>]*>\s*@\s*([^<]{2,140})<\/h2>/i;

export function identifyEmployer({ jsonLd = null, meta = {}, html = "", text = "", pageUrl = "", source = null } = {}) {
  const candidates = [];
  const hiring = jsonLd?.hiringOrganization;
  if (hiring) {
    const name = cleanOrgName(typeof hiring === "string" ? hiring : hiring.name || hiring.legalName || "");
    if (name) candidates.push(scoreCandidate(name, 96, "jsonld_hiring_organization"));
  }

  const title = extractTitleTag(html) || meta["og:title"] || "";
  const h1 = extractH1(html) || meta["og:title"] || "";
  candidates.push(...titleCandidates(title, h1));

  const h2 = AT_H2_RE.exec(String(html || ""));
  if (h2) candidates.push(scoreCandidate(cleanOrgName(h2[1]), 82, "page_h2_at"));

  const bodyText = text || htmlToText(html);
  for (const m of String(bodyText).matchAll(LABEL_RE)) {
    candidates.push(scoreCandidate(cleanOrgName(m[1]), 86, "explicit_label"));
  }

  const orgNameMeta = meta["og:site_name"] || meta["application-name"] || "";
  if (orgNameMeta) candidates.push(scoreCandidate(cleanOrgName(orgNameMeta), 20, "site_name"));

  const usable = candidates.filter((c) => {
    if (!c.name || c.name.length < 2) return false;
    if (isGenericOrganization(c.name)) return false;
    if (isSourceName(c.name, source)) return false;
    return true;
  });
  usable.sort((a, b) => b.confidence - a.confidence);
  const best = usable[0] || null;

  if (!best) {
    return {
      name: UNVERIFIED_ORGANIZATION,
      verified: false,
      confidence: 0,
      evidence: "none",
      logo: null,
      website: null,
      domain: null,
    };
  }

  const verified = best.confidence >= 80;
  let website = null;
  let logo = null;
  if (hiring && typeof hiring === "object") {
    const rawUrl = typeof hiring.url === "string" ? hiring.url : hiring.sameAs;
    if (rawUrl && !isSourceHost(rawUrl) && !isKnownSourceDomain(hostOf(rawUrl))) website = String(rawUrl);
    const rawLogo = hiring.logo;
    const logoUrl = typeof rawLogo === "string" ? rawLogo : rawLogo?.url || rawLogo?.contentUrl || null;
    if (logoUrl && !isSourceHost(logoUrl, pageUrl) && !isKnownSourceDomain(hostOf(logoUrl))) {
      try {
        logo = new URL(String(logoUrl), pageUrl).toString();
      } catch {
        logo = null;
      }
    }
  }
  const domain = website ? baseDomain(hostOf(website)) : null;
  if (!website && best.confidence >= 70) {
    // Only trust the announcement's own host when it is not a discovery source.
    const candidateDomain = baseDomain(hostOf(pageUrl));
    if (candidateDomain && !isKnownSourceDomain(candidateDomain)) {
      website = `https://${candidateDomain}`;
    }
  }
  if (!logo && website && !isKnownSourceDomain(hostOf(website))) {
    logo = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(baseDomain(hostOf(website)))}&sz=128`;
  }
  if (!logo) logo = orgLogoUrl(best.name);

  return {
    name: best.name,
    verified,
    confidence: best.confidence,
    evidence: best.evidence,
    logo,
    website,
    domain: website ? baseDomain(hostOf(website)) : domain,
    alternatives: usable.slice(1, 4).map((c) => ({ name: c.name, confidence: c.confidence })),
  };
}

export function employerMatchesSource(employer, source) {
  if (!employer || !source) return false;
  if (isSourceName(employer.name, source)) return true;
  if (employer.website && sameSite(employer.website, source.base_url || source.listing_url || "")) return true;
  return false;
}
