// Host classification for the two-stage extraction pipeline.
// Everything in this module is pure (no network) so it can be unit-tested.

// Third-party discovery sources. These hosts are internal-only: their name, logo,
// domain and URLs must never reach a public response, page or structured data.
export const SOURCE_DOMAINS = [
  "geezjobs.com",
  "ethiojobs.net",
  "ethiojobs.net.et",
  "ethio-jobs.net.et",
  "etcareers.com",
  "alljobspo.com",
  "jobsinethiopia.alljobspo.com",
  "workethiopia.net",
  "ethiopianreporterjobs.com",
  "www.ethiopianreporterjobs.com",
  "reliefweb.int",
  "api.reliefweb.int",
  "careers.un.org",
  "ethiopia.un.org",
  "unjobs.org",
  "hahu.jobs",
  "dereja.com",
  "ezega.com",
  "jobwebethiopia.com",
  "ngojobs.et",
  "srazone.et",
  "jobsethiopia.com",
  "ethiopianjobs.net",
  "prjobs.et",
];

// Social / share / video hosts are never a valid application destination.
export const SOCIAL_DOMAINS = [
  "facebook.com",
  "fb.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "telegram.me",
  "t.me",
  "whatsapp.com",
  "wa.me",
  "pinterest.com",
  "threads.net",
  "medium.com",
];

// Applicant tracking systems and hosted application forms. A link here is a strong
// signal that the destination is the real application flow.
export const ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "wd1.myworkdayjobs.com",
  "bamboohr.com",
  "smartrecruiters.com",
  "icims.com",
  "taleo.net",
  "oraclecloud.com",
  "successfactors.com",
  "sapsf.com",
  "jobvite.com",
  "recruitee.com",
  "personio.de",
  "personio.com",
  "zohorecruit.com",
  "breezy.hr",
  "ashbyhq.com",
  "rippling.com",
  "comeet.com",
  "teamtailor.com",
  "applytojob.com",
  "jazz.co",
  "workable.com",
  "jobscore.com",
  "hirebridge.com",
  "ultipro.com",
  "paylocity.com",
  "adp.com",
  "forms.office.com",
  "docs.google.com",
  "typeform.com",
  "jotform.com",
  "airtable.com",
  "formstack.com",
  "surveymonkey.com",
  "tally.so",
];

const SOURCE_RE = new RegExp(
  `(^|\\.)(${SOURCE_DOMAINS.map((d) => d.replace(/\./g, "\\.")).join("|")})$`,
  "i"
);
const SOCIAL_RE = new RegExp(
  `(^|\\.)(${SOCIAL_DOMAINS.map((d) => d.replace(/\./g, "\\.")).join("|")})$`,
  "i"
);
const ATS_RE = new RegExp(
  `(^|\\.)(${ATS_DOMAINS.map((d) => d.replace(/\./g, "\\.")).join("|")})$`,
  "i"
);

// Second-level public suffixes used in Ethiopia / common TLDs. Used only for a
// human-friendly "same site" comparison, never for security decisions.
const MULTI_LEVEL_SUFFIXES = new Set([
  "com.et", "org.et", "net.et", "gov.et", "edu.et", "info.et", "biz.et",
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.ke", "or.ke", "go.ke",
  "co.tz", "or.tz", "go.tz",
  "co.za", "org.za",
  "co.in", "org.in", "net.in",
  "com.ng", "org.ng",
]);

export function safeParseUrl(input, base) {
  try {
    const u = base ? new URL(String(input), base) : new URL(String(input));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

export function hostOf(input, base) {
  const u = input instanceof URL ? input : safeParseUrl(input, base);
  return u ? u.hostname.toLowerCase().replace(/^www\./, "") : "";
}

export function hostMatches(host, domain) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const d = String(domain || "").toLowerCase().replace(/^www\./, "");
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

export function isSourceHost(input, base) {
  const host = hostOf(input, base);
  return !!host && SOURCE_RE.test(host);
}

export function isSocialHost(input, base) {
  const host = hostOf(input, base);
  return !!host && SOCIAL_RE.test(host);
}

export function isAtsHost(input, base) {
  const host = hostOf(input, base);
  return !!host && ATS_RE.test(host);
}

export function isKnownSourceDomain(domain) {
  if (!domain) return false;
  const clean = String(domain).toLowerCase().replace(/^www\./, "");
  if (SOURCE_DOMAINS.some((d) => hostMatches(clean, d))) return true;
  // A source may be registered under a subdomain of a larger domain
  // (careers.un.org, ethiojobs.net.et). Compare on the registrable domain too
  // so those hosts are recognised.
  const base = baseDomain(clean);
  return !!base && SOURCE_DOMAINS.some((d) => {
    const sourceBase = baseDomain(d);
    return !!sourceBase && base === sourceBase;
  });
}

export function baseDomain(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!h) return "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h;
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_LEVEL_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

export function sameSite(a, b) {
  const da = baseDomain(hostOf(a));
  const db = baseDomain(hostOf(b));
  return !!da && da === db;
}

// Private / reserved address detection used by the SSRF guard.
export function isPrivateIp(ip) {
  const s = String(ip || "").trim().toLowerCase();
  if (!s) return true;
  if (s === "::1" || s === "::" || s === "0.0.0.0") return true;
  if (s.startsWith("::ffff:")) return isPrivateIp(s.slice(7));
  if (s.includes(":")) {
    // IPv6 unique-local, link-local, multicast and documentation ranges.
    if (/^f[cd][0-9a-f]{2}:/.test(s)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(s)) return true;
    if (/^ff[0-9a-f]{2}:/.test(s)) return true;
    if (/^2001:db8:/.test(s)) return true;
    return false;
  }
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return true;
  const [a, b, c, d] = m.slice(1).map((n) => parseInt(n, 10));
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export function isLocalHostname(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return true;
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".home.arpa") ||
    h === "metadata.google.internal"
  );
}

export function isSafePublicUrl(input, base) {
  const u = safeParseUrl(input, base);
  if (!u) return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLocalHostname(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateIp(host)) return false;
  // IPv6 literals (URL keeps the brackets; strip them before range checks).
  if (host.includes(":") && isPrivateIp(host)) return false;
  return true;
}

export function isDocumentUrl(input, base) {
  const u = safeParseUrl(input, base);
  if (!u) return false;
  return /\.(pdf|docx?|xlsx?|pptx?|rtf|odt)(?:$|[?#])/i.test(u.pathname + u.search);
}

export function isImageUrl(input, base) {
  const u = safeParseUrl(input, base);
  if (!u) return false;
  return /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)(?:$|[?#])/i.test(u.pathname + u.search);
}
