// Intelligent ETcareers vacancy reconstruction.
//
// This module is deliberately pure: it receives one already-fetched HTML page
// and returns the employer's vacancy, not the ETcareers webpage. It never
// guesses URLs, logos, salaries or deadlines. The HTTP redirect step is
// supplied by the engine through `applyResolution` so this file stays testable.

import {
  collapseWhitespace,
  decodeEntities,
  extractJsonLd,
  extractMainContentHtml,
  extractMeta,
  findEmails,
  findJobPosting,
  htmlToText,
  parseAttributes,
} from "./html.mjs";
import { absolutize, canonicalUrl, decodeRedirectUrl } from "./urls.mjs";
import { APPLY_URL_TYPES, classifyDestination } from "./apply-link.mjs";
import { collectPublisherAssets, employerKey, isBoardBrandAsset } from "./employer-logo.mjs";
import { hostOf, isSocialHost, safeParseUrl } from "./hosts.mjs";
import { locateApplyLink } from "../connectors/etcareers.mjs";

const SOURCE_NAME = "ETcareers";
const ETCAREERS_HOST_RE = /(?:^|\.)etcareers\.com$/i;

const ANCHOR_RE = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi;
const MEDIA_RE = /<(?:img|source|meta)\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/gi;
const BLOCK_TAG_RE = /<\/?(?:div|section|article|main|header|footer|aside|nav)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const VOID_TAGS = new Set(["img", "source", "meta", "br", "hr", "input"]);

const APPLY_LABEL_RE =
  /\b(?:apply(?:\s+(?:now|online|here|today|for this (?:job|role|position)))?|submit\s+(?:your\s+)?(?:application|cv|resume)|start\s+(?:your\s+)?application|application\s+(?:form|link|portal)|how\s+to\s+apply)\b/i;
const NON_APPLY_LABEL_RE =
  /\b(?:share|tweet|facebook|linkedin|whatsapp|telegram|pinterest|print|save|bookmark|subscribe|newsletter|sign\s*in|log\s*in|login)\b/i;

const NOISE_BLOCK_RE =
  /(?:advert|ads?\b|sponsor|promo|telegram|newsletter|subscribe|social|share|related|similar|more[-_ ]?jobs|footer|navigation|breadcrumb|sidebar|cookie|modal|popup|job[-_ ]?alert|buy[-_ ]?maps|career[-_ ]?coaching|job[-_ ]?search|recommended)/i;
const SOCIAL_HREF_RE =
  /(?:^|[/.@])(?:t\.me|telegram\.me|telegram|facebook\.com|fb\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|whatsapp\.com|wa\.me)(?:$|[/_.-])/i;

const NOISE_PHRASE_RE =
  /\b(?:job\s+search\s+subscription|ethiopian\s+job\s+market|buy\s+maps|career\s+coaching|join\s+etcareers(?:\s+on\s+telegram|\s+@?etcareersjobs?)?(?:\s+for\s+daily\s+job\s+updates)?|share\s+with\s+friends|etcareers\s+job\s+alerts?|daily\s+job\s+updates|job\s+search\s+alerts?|subscribe\s+to\s+(?:our\s+)?(?:newsletter|job\s+alerts?)|advertisement|sponsored\s+content)\b/gi;
const NOISE_LINE_RE =
  /^(?:job\s+search\s+subscription|ethiopian\s+job\s+market|buy\s+maps|career\s+coaching|join\s+etcareers(?:\s+on\s+telegram|\s+@?etcareersjobs?)?(?:\s+for\s+daily\s+job\s+updates)?|share\s+with\s+friends|etcareers\s+job\s+alerts?|daily\s+job\s+updates|subscribe|advertisement|advert|sponsored(?:\s+content)?|sponsor|share\s+this|follow\s+us|print\s+this|all\s+jobs|terms\s+of\s+service|privacy\s+policy|contact(?:\s+us)?|facebook|x|instagram|linkedin|tiktok|youtube|footer|more\s+jobs|©\s*\d{4}\s*etcareers(?:\.com)?)|https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i;
// Promotional social lines often start with an emoji and lose the linked
// handle when the Telegram anchor is stripped. Drop the whole line.
const SOCIAL_PROMO_LINE_RE =
  /^(?:join|follow|like|share)\b[\s\S]{0,200}?(?:share\s+with\s+friends|daily\s+job\s+updates|job\s+alerts?|etcareersjobs?|telegram|t\.me)/i;

const ROLE_WORD_RE =
  /\b(?:officer|manager|engineer|accountant|auditor|specialist|assistant|coordinator|supervisor|analyst|nurse|doctor|teacher|driver|guard|clerk|cashier|teller|branch|consultant|director|expert|researcher|technician|attendant|secretary|intern|trainee|leader|head|executive|administrator|programme|program|project|officer|professor|lecturer|architect|surveyor|pharmacist|librarian|designer|developer|support|sales|marketing|human\s+resource|finance|account|it)\b/i;

const SECTION_DEFS = [
  { key: "job_overview", re: /^(?:job\s+overview|position\s+overview|role\s+overview|job\s+summary|about\s+the\s+(?:role|position|job)|overview)\b/i },
  { key: "responsibilities", re: /^(?:key\s+)?(?:responsibilities|duties|essential\s+duties|what\s+you\s+will\s+do|main\s+tasks|job\s+description)\b/i },
  { key: "qualifications", re: /^(?:required\s+|minimum\s+|educational\s+|academic\s+)?(?:qualifications|requirements|job\s+requirements|required\s+qualifications|skills\s+and\s+experience|education(?:al\s+qualification)?)\b/i },
  { key: "experience_requirements", re: /^(?:work\s+|required\s+|minimum\s+|relevant\s+)?experience(?:\s+requirements)?\b/i },
  { key: "skills", re: /^(?:required\s+|key\s+|technical\s+|core\s+)?(?:skills|competencies|technical\s+skills|professional\s+skills)\b/i },
  { key: "salary", re: /^(?:salary|remuneration|compensation|pay\s+scale)\b/i },
  { key: "benefits", re: /^(?:benefits|what\s+we\s+offer|perks|allowances|fringe\s+benefits)\b/i },
  { key: "positions", re: /^(?:available\s+job\s+positions?|open\s+positions?|vacant\s+positions?|position\s+details?|job\s+positions?)\b/i },
  { key: "application", re: /^(?:how\s+to\s+apply|application(?:\s+(?:instructions|process|procedure|method|details))?|to\s+apply|submission\s+of\s+application)\b/i },
  { key: "deadline", re: /^(?:application\s+deadline|deadline|closing\s+date|apply\s+before|last\s+date|submission\s+deadline)\b/i },
];

const STOP_SECTION_RE =
  /^(?:how\s+to\s+apply|application(?:\s+(?:instructions|process|procedure|method|details))?|to\s+apply|deadline|application\s+deadline|closing\s+date|benefits|salary|duty\s+station|place\s+of\s+work|work\s+location|more\s+jobs|footer|terms\s+of\s+service|privacy\s+policy)/i;

function asText(value) {
  return collapseWhitespace(decodeEntities(String(value == null ? "" : value)));
}

// htmlToText's tag stripper is not quote-aware. ETcareers' CTA contains a `>`
// inside data-action="click->job#onApply", so normalise anchors first.
function safeHtmlToText(html, max = null) {
  const normalized = String(html || "").replace(
    ANCHOR_RE,
    (_full, _attrs, inner) => `<a>${inner}</a>`
  );
  return htmlToText(normalized, max);
}

function normalizeLines(value) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const v = asText(value);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function stripBoardBrand(value) {
  let text = asText(value);
  text = text.replace(/\s+(?:via|at|on|from|through)\s+ET\s* careers?\.?\s*$/i, "");
  text = text.replace(/\s*[|–—:-]\s*ET\s* careers?.*$/i, "");
  text = text.replace(/\bET\s*careers\.com\b/gi, "");
  text = text.replace(/\bET\s*careers\b/gi, "");
  return asText(text);
}

function cleanNoiseText(value) {
  let text = normalizeLines(value);
  // Remove whole promotional lines BEFORE phrase scrubbing, while handles and
  // "share with friends" are still present in the text.
  text = text
    .split(/\n+/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      // Ignore leading emoji/symbols when classifying a promo line.
      const probe = trimmed.replace(/^[^A-Za-z0-9]+/, "");
      if (NOISE_LINE_RE.test(probe)) return false;
      if (SOCIAL_PROMO_LINE_RE.test(probe)) return false;
      // An emoji-led "Join for & ." remains after Telegram anchors are
      // stripped; it has no employer content and must not survive.
      if (/^(?:join|follow|like|share)\b/i.test(probe) && probe.replace(/[^A-Za-z]/g, "").length <= 12) return false;
      if (/^•?\s*https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i.test(trimmed)) return false;
      if (/^\s*(?:follow|like|share)\s+us\b/i.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .replace(NOISE_PHRASE_RE, " ");
  const more = /\bmore\s+jobs\b/i.exec(text);
  if (more && more.index > 0) text = text.slice(0, more.index);
  const footer = /\bfooter\b/i.exec(text);
  if (footer && footer.index > 0) text = text.slice(0, footer.index);
  return normalizeLines(text.replace(NOISE_PHRASE_RE, " ")).replace(/•\s*•+/g, "• ");
}

function sourceHosts(source, pageUrl) {
  const out = new Set();
  for (const value of [source?.base_url, source?.listing_url, source?.name, pageUrl]) {
    const host = hostOf(value);
    if (host) out.add(host);
  }
  out.add("etcareers.com");
  return [...out].filter(Boolean);
}

function isSourceUrl(url, source, pageUrl) {
  const host = hostOf(url);
  if (!host) return true;
  if (ETCAREERS_HOST_RE.test(host)) return true;
  return sourceHosts(source, pageUrl).some((h) => h === host || host.endsWith(`.${h}`));
}

function absoluteUrl(value, pageUrl) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  if (/^mailto:/i.test(raw)) {
    const email = raw.slice(7).split("?")[0].trim();
    return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) ? `mailto:${email.toLowerCase()}` : null;
  }
  if (/^(?:tel|sms):/i.test(raw)) return raw;
  if (/^(?:javascript|data|vbscript|file|blob):/i.test(raw)) return null;
  try {
    const u = new URL(raw, pageUrl || "https://etcareers.com");
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function parseAnchors(html) {
  const anchors = [];
  for (const match of String(html || "").matchAll(ANCHOR_RE)) {
    const attrs = parseAttributes(`<a${match[1]}>`);
    anchors.push({
      href: attrs.href || "",
      text: safeHtmlToText(match[2], 300),
      title: attrs.title || "",
      ariaLabel: attrs["aria-label"] || "",
      className: attrs.class || "",
      id: attrs.id || "",
      attrs,
    });
  }
  return anchors;
}

function cutAtTermination(html) {
  const source = String(html || "");
  const patterns = [
    /<[^>]*\bid\s*=\s*["'][^"']*(?:similar|related)[-_]?jobs?[^"']*["'][^>]*>/i,
    /<h[1-6]\b[^>]*>[\s\S]{0,160}?\bmore\s+jobs\b[\s\S]{0,80}?<\/h[1-6]>/i,
    /\bmore\s+jobs\b/i,
    /<footer\b/i,
  ];
  let cut = source.length;
  for (const re of patterns) {
    const m = re.exec(source);
    if (m && m.index > 0 && m.index < cut) cut = m.index;
  }
  return cut >= source.length ? source : source.slice(0, cut);
}

function stripNoiseBlocks(html) {
  let source = String(html || "");
  source = source.replace(
    /<(script|style|noscript|template|svg|form|button|iframe|object|embed|canvas)\b((?:[^>"']|"[^"]*"|'[^']*')*)>[\s\S]*?<\/\1>/gi,
    " "
  );
  source = source.replace(
    /<(div|section|aside|nav|footer|p|li|article|span)\b((?:[^>"']|"[^"]*"|'[^']*')*)>[\s\S]*?<\/\1>/gi,
    (full, _tag, attrs) => (NOISE_BLOCK_RE.test(attrs || "") ? " " : full)
  );
  source = source.replace(ANCHOR_RE, (full, attrsRaw, inner) => {
    const attrs = parseAttributes(`<a${attrsRaw}>`);
    const label = safeHtmlToText(inner, 200);
    if (SOCIAL_HREF_RE.test(attrs.href || "") && !APPLY_LABEL_RE.test(label)) return " ";
    if (/\btelegram\b/i.test(label) && !APPLY_LABEL_RE.test(label)) return " ";
    return full;
  });
  return source;
}

function balancedElement(html, start) {
  const source = String(html || "");
  const m = /^<([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(source.slice(start));
  if (!m) return "";
  const tag = m[1].toLowerCase();
  if (VOID_TAGS.has(tag)) return m[0];
  const re = new RegExp(`<\\/?${tag}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, "gi");
  // The opening tag has already been consumed above.
  let depth = 1;
  const rest = source.slice(start + m[0].length);
  for (const match of rest.matchAll(re)) {
    if (/^<\//.test(match[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      return source.slice(start, start + m[0].length + match.index + match[0].length);
    }
  }
  return source.slice(start);
}

function enclosingBlocks(html, index) {
  const stack = [];
  const re = /<\/?(div|section|article|main|header)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const match of String(html || "").matchAll(re)) {
    if (match.index + match[0].length > index) break;
    const tag = match[1].toLowerCase();
    if (/^<\//.test(match[0])) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      stack.push({ tag, start: match.index });
    }
  }
  return stack;
}

function extractHeaderHtml(html) {
  const source = String(html || "");
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(source);
  if (!h1 || h1.index == null) return "";
  const stack = enclosingBlocks(source, h1.index);
  let best = "";
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const chunk = balancedElement(source, stack[i].start);
    if (!chunk) continue;
    const text = safeHtmlToText(chunk);
    if (!text || text.length > 4000) continue;
    // The job body is a sibling of the header, never part of it. ETcareers
    // renders the logo as a sibling of the title too, so keep the widest
    // ancestor that still contains only header content (title, employer,
    // metadata and logo).
    if (/\b(?:rich[-_ ]?text|job[-_ ]?(?:description|content|body|posting)|vacancy[-_ ]?detail)\b/i.test(chunk)) continue;
    if (/<h[2-6]\b/i.test(chunk)) continue;
    best = chunk;
    if (text.length >= 320) break;
  }
  return best;
}

function extractMainHtml(html, headerHtml) {
  const trimmed = stripNoiseBlocks(cutAtTermination(html));
  const candidates = [];
  for (const match of trimmed.matchAll(/<(?:div|section|article|main)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const openTag = match[0];
    if (!/(?:class|id)\s*=\s*["'][^"']*(?:rich[-_ ]?text|job[-_ ]?(?:description|detail|content|body|posting)|vacancy[-_ ]?detail|entry[-_ ]?content|description|job-content)[^"']*["']/i.test(openTag)) continue;
    const chunk = balancedElement(trimmed, match.index);
    const text = safeHtmlToText(chunk);
    if (text.length < 80 || text.length > 120000) continue;
    candidates.push({ chunk, score: text.length + (headerHtml && chunk.includes(asText(safeHtmlToText(headerHtml)).slice(0, 60)) ? 0 : 200) });
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].chunk;
  }
  const fallback = stripNoiseBlocks(extractMainContentHtml(trimmed));
  return safeHtmlToText(fallback).length >= 80 ? fallback : trimmed;
}

function labeledValue(text, labels, { max = 120 } = {}) {
  const source = String(text || "");
  const names = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?:^|[\\n|•\\s])(?:${names})(?![a-z])\\s*[:\\-]?\\s*([^\\n|•]{2,${max}})`, "i");
  const m = re.exec(source);
  if (!m) return "";
  return asText(m[1])
    .split(/\s{2,}|\s+\|\s+/)[0]
    .replace(/\s+(?:Full|Part)[- ]?time\b.*$/i, "")
    .replace(/\s+(?:On[- ]?site|Remote|Hybrid)\b.*$/i, "")
    .trim();
}

function relativeTime(text) {
  const m = /\b(\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago|just\s+now|today|yesterday)\b/i.exec(String(text || ""));
  return m ? asText(m[1]) : "";
}

function employmentType(text, jsonLd) {
  const fromLd = [].concat(jsonLd?.employmentType || []).map(asText).find(Boolean);
  const value = labeledValue(text, ["Employment type", "Job type", "Contract type", "Employment"]) || fromLd || "";
  const m = /\b(full[- ]?time|part[- ]?time|contract|temporary|internship|freelance|permanent)\b/i.exec(value);
  if (!m) return asText(value);
  const lower = m[1].toLowerCase().replace("-", " ");
  if (lower.startsWith("full")) return "Full-time";
  if (lower.startsWith("part")) return "Part-time";
  return asText(m[1]);
}

function workplaceType(text, jsonLd) {
  const fromLd = asText(jsonLd?.jobLocationType);
  const value = labeledValue(text, ["Workplace type", "Work arrangement", "Work mode", "Workplace"]) || fromLd || "";
  const m = /\b(on[- ]?site|remote|hybrid|field[- ]?based)\b/i.exec(value);
  return m ? asText(m[1]) : asText(value);
}

function locationFromJsonLd(jsonLd) {
  const locations = [].concat(jsonLd?.jobLocation || []).filter(Boolean);
  const parts = [];
  for (const loc of locations) {
    const address = loc?.address || loc;
    const value = [address?.addressLocality, address?.addressRegion, address?.addressCountry?.name || address?.addressCountry]
      .filter(Boolean)
      .map(asText)
      .join(", ");
    if (value) parts.push(value);
  }
  return unique(parts).join(" | ");
}

function categoriesFromHeader(headerHtml, headerAnchors, jsonLd) {
  const values = [];
  for (const anchor of headerAnchors) {
    const text = asText(anchor.text || anchor.title);
    const href = String(anchor.href || "");
    if (!text || /\b(?:all jobs|apply|home|login|sign in)\b/i.test(text)) continue;
    if (/\bjobs?\s+in\s+ethiopia\b/i.test(text) || /\/(?:job-)?categor(?:y|ies)\b/i.test(href) || /[?&]category=/i.test(href)) {
      values.push(text);
    }
  }
  for (const value of [].concat(jsonLd?.occupationalCategory || jsonLd?.industry || jsonLd?.category || [])) {
    const text = typeof value === "string" ? value : value?.name;
    if (text) values.push(asText(text));
  }
  return unique(values).slice(0, 20);
}

function companyFromJsonLd(jsonLd) {
  const org = jsonLd?.hiringOrganization;
  const value = typeof org === "string" ? org : org?.name || org?.legalName;
  const name = stripBoardBrand(value);
  return name && !/not verified|unknown/i.test(name) ? name : "";
}

function companyFromHeader(headerText, headerAnchors, headerHtml) {
  const labeled = labeledValue(headerText, ["Employer", "Company", "Organization", "Organisation", "Hiring organization"]);
  if (labeled && !/\bjobs?\b/i.test(labeled)) return labeled;
  for (const anchor of headerAnchors) {
    const text = asText(anchor.text || anchor.title || anchor.ariaLabel);
    if (!text || text.length < 3 || text.length > 160) continue;
    if (APPLY_LABEL_RE.test(text) || NON_APPLY_LABEL_RE.test(text)) continue;
    if (/\bjobs?\s+in\s+ethiopia\b|\bmore jobs\b|\bjob vacanc/i.test(text)) continue;
    if (isSourceUrl(anchor.href, null, "") && !anchor.href.startsWith("mailto:")) continue;
    if (/\d+\s+(?:hours?|days?)\s+ago/i.test(text)) continue;
    return text;
  }
  const logoAlt = /<img\b[^>]*\balt\s*=\s*["']([^"']+)["'][^>]*>/i.exec(headerHtml || "");
  if (logoAlt) {
    const alt = stripBoardBrand(logoAlt[1]).replace(/\s+logo$/i, "").trim();
    if (alt && !/\betcareers\b/i.test(alt)) return alt;
  }
  return "";
}

function collectImages(html, meta, pageUrl) {
  const images = [];
  for (const match of String(html || "").matchAll(MEDIA_RE)) {
    const attrs = parseAttributes(`<${/^<meta/i.test(match[0]) ? "meta" : "img"} ${match[1]}>`);
    const raw =
      attrs.src ||
      attrs["data-src"] ||
      attrs["data-lazy-src"] ||
      attrs["data-original"] ||
      (attrs.srcset || "").split(/\s*,/)[0].trim().split(/\s+/)[0] ||
      (/background-image\s*:\s*url\(([^)]+)\)/i.exec(attrs.style || "") || [])[1] ||
      (attrs.property === "og:image" || attrs.name === "og:image" ? attrs.content : "") ||
      "";
    if (!raw) continue;
    const url = absoluteUrl(raw.replace(/^['"]|['"]$/g, ""), pageUrl);
    if (!url || /^mailto:|^tel:/i.test(url)) continue;
    images.push({
      url,
      alt: asText(attrs.alt || attrs.title || attrs["aria-label"] || ""),
      width: parseInt(attrs.width || "0", 10) || 0,
      height: parseInt(attrs.height || "0", 10) || 0,
    });
  }
  if (meta["og:image"]) {
    const url = absoluteUrl(meta["og:image"], pageUrl);
    if (url) images.push({ url, alt: asText(meta["og:image:alt"] || ""), width: 0, height: 0, og: true });
  }
  return images;
}

function imageScore(image, { company, source, pageUrl, publisherAssets, origin }) {
  const url = String(image.url || "");
  if (!url) return -1000;
  // A board-hosted copy of the employer's logo is legitimate; only the board's
  // own branding and site-level preview graphics are rejected.
  if (isBoardBrandAsset(url, source, publisherAssets)) return -1000;
  if (/(?:^|[/_.-])(?:site[-_]?preview|og[-_]?image|social[-_]?share|preview[-_]?image)(?:[/_.-]|$)/i.test(url)) return -1000;
  if (isSocialHost(url)) return -1000;
  if (/(?:^|[/_.-])(?:icon|favicon|avatar|social|share|telegram|banner|ad|ads|advert|sponsor|placeholder|default)(?:[/_.-]|$)/i.test(url)) return -1000;
  if (image.width > 0 && image.width <= 48 && image.height > 0 && image.height <= 48) return -500;

  const key = employerKey(company);
  const tokens = key.split(/\s+/).filter((t) => t.length >= 4);
  const alt = String(image.alt || "").toLowerCase();
  const haystack = `${alt} ${decodeURIComponentSafe(url).toLowerCase()}`;
  let score = origin === "job_header" ? 60 : origin === "jsonld" ? 55 : origin === "job_detail" ? 35 : 15;
  if (/\blogo\b/i.test(alt)) score += 18;
  if (tokens.some((t) => alt.includes(t))) score += 26;
  if (tokens.some((t) => decodeURIComponentSafe(url).toLowerCase().includes(t.replace(/\s+/g, "[-_ ]?")))) score += 20;
  if (hostOf(url) && company && hostOf(url).includes(tokens[0] || "\0")) score += 18;
  if (image.og) score -= 12;
  return score;
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function selectLogo({ headerHtml, mainHtml, meta, jsonLd, company, source, pageUrl }) {
  if (!company) return null;
  const publisherAssets = collectPublisherAssets("", meta);
  const groups = [
    { origin: "job_header", html: headerHtml },
    { origin: "job_detail", html: mainHtml },
  ];
  const candidates = [];
  for (const group of groups) {
    for (const image of collectImages(group.html, {}, pageUrl)) {
      candidates.push({ ...image, origin: group.origin, score: imageScore(image, { company, source, pageUrl, publisherAssets, origin: group.origin }) });
    }
  }
  const orgLogo = jsonLd?.hiringOrganization?.logo;
  const logoRaw = typeof orgLogo === "string" ? orgLogo : orgLogo?.url || orgLogo?.contentUrl;
  if (logoRaw) {
    const url = absoluteUrl(logoRaw, pageUrl);
    if (url) {
      const image = { url, alt: asText(jsonLd?.hiringOrganization?.name || ""), width: 0, height: 0, origin: "jsonld" };
      candidates.push({ ...image, score: imageScore(image, { company, source, pageUrl, publisherAssets, origin: "jsonld" }) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates.find((c) => c.score >= 45);
  if (!best) return null;
  return {
    url: best.url,
    alt: best.alt || `${company} logo`,
    source: best.origin === "job_header" ? "job_header" : best.origin === "jsonld" ? "jsonld" : "job_detail",
  };
}

function companyWebsiteFromEvidence({ headerAnchors, mainAnchors, jsonLd, company, source, pageUrl }) {
  const org = jsonLd?.hiringOrganization;
  const raw = [org?.url, org?.sameAs, org?.contactUrl].flat().filter(Boolean);
  const urls = [];
  for (const value of raw) {
    const url = absoluteUrl(typeof value === "string" ? value : value?.url, pageUrl);
    if (url && !isSourceUrl(url, source, pageUrl) && !isSocialHost(url) && !/^mailto:/i.test(url)) urls.push(url);
  }
  const key = employerKey(company);
  const token = key.split(/\s+/).find((t) => t.length >= 5) || "";
  for (const anchor of [...headerAnchors, ...mainAnchors]) {
    const url = absoluteUrl(anchor.href, pageUrl);
    if (!url || /^mailto:|^tel:/i.test(url)) continue;
    if (isSourceUrl(url, source, pageUrl) || isSocialHost(url)) continue;
    const text = asText(anchor.text || anchor.title || anchor.ariaLabel);
    const anchorMatches = text && key && (text.toLowerCase().includes(token) || token.includes(text.toLowerCase()));
    if (anchorMatches && !APPLY_LABEL_RE.test(text) && !/\bjobs?\b/i.test(text)) urls.push(url);
  }
  return unique(urls)[0] || null;
}

function sectionizeText(text) {
  const lines = normalizeLines(text).split("\n");
  const buckets = Object.create(null);
  let current = "";
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line) continue;
    const heading = line.replace(/^•\s*/, "").replace(/[:.]$/, "");
    const def = SECTION_DEFS.find((d) => d.re.test(heading));
    // Inside a multi-position list, "Educational Qualification: ..." and
    // "Work Experience: ..." belong to the current position, not to a new
    // top-level section.
    const inlineValue = /^[^:\n]{1,80}:\s*\S/.test(heading);
    if (def && !(current === "positions" && inlineValue)) {
      current = def.key;
      buckets[current] ||= [];
      continue;
    }
    if (STOP_SECTION_RE.test(heading)) current = "";
    if (current) buckets[current].push(line);
  }
  return buckets;
}

function bulletLines(lines, { max = 40 } = {}) {
  return unique(
    (Array.isArray(lines) ? lines : [])
      .map((line) => asText(line).replace(/^[•\-*–]\s*/, ""))
      .filter((line) => line && line.length >= 3 && !NOISE_LINE_RE.test(line))
  ).slice(0, max);
}

function inlineList(value, { max = 40 } = {}) {
  return unique(
    String(value || "")
      .split(/[,;•\n]|(?:\s+and\s+)/i)
      .map((part) => asText(part).replace(/^[•\-*–]\s*/, ""))
      .filter((part) => part.length >= 2 && part.length <= 160)
  ).slice(0, max);
}

function firstMeaningfulDate(value) {
  const text = asText(value);
  if (!text) return "";
  const m = /\b(?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/i.exec(text);
  return m ? asText(m[0]) : text.slice(0, 160);
}

function findPhones(text) {
  const found = [];
  for (const m of String(text || "").matchAll(/(?:\+251[\s-]?)?(?:\b0?9\d{2}[\s-]?\d{3}[\s-]?\d{3}\b)/g)) {
    const phone = asText(m[0]);
    if (phone.replace(/\D/g, "").length >= 9 && !found.includes(phone)) found.push(phone);
  }
  return found.slice(0, 10);
}

function applicationEmails({ instructions, description, chosen, sourceDomains }) {
  const emails = [];
  const chosenUrl = String(chosen?.url || "");
  const mail = /^mailto:(.+)$/i.exec(chosenUrl);
  if (mail) {
    const email = mail[1].split("?")[0].trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) emails.push(email);
  }
  for (const email of findEmails(instructions, { sourceDomains })) emails.push(email);
  if (!emails.length) {
    for (const line of String(description || "").split("\n")) {
      if (!/\b(?:apply|application|email|send|submit|cv|resume)\b/i.test(line)) continue;
      for (const email of findEmails(line, { sourceDomains })) emails.push(email);
    }
  }
  return unique(emails).slice(0, 10);
}

function physicalAddress(instructions) {
  const lines = normalizeLines(instructions).split("\n").map((l) => asText(l)).filter(Boolean);
  const idx = lines.findIndex((line) => /^(?:physical\s+address|submission\s+address|application\s+address|address|drop\s*off|hand\s+deliver)\b/i.test(line.replace(/^[•\-*–]\s*/, "")));
  if (idx < 0) return "";
  const out = [];
  const labelLine = lines[idx].replace(/^[•\-*–]\s*/, "");
  const inline = labelLine.replace(/^[^:]+:\s*/, "").trim();
  if (inline && !/@|https?:\/\//.test(inline)) out.push(inline);
  for (const line of lines.slice(idx + 1, idx + 8)) {
    if (/^(?:email|phone|deadline|how to apply|application|required documents|documents)\b/i.test(line.replace(/^[•\-*–]\s*/, ""))) break;
    if (/@|https?:\/\//.test(line)) break;
    out.push(line);
  }
  return out.join("\n");
}

// A company homepage, office address or social profile is context, not an
// application destination. Only an explicit online-application instruction
// may supply application_url.
const NON_APPLICATION_LABEL_RE =
  /^(?:company\s+website|website|homepage|office\s+address|physical\s+address|mailing\s+address|address|location|linkedin|facebook|twitter|instagram|youtube|telegram|follow\s+us)\b/i;
const ONLINE_APPLICATION_CONTEXT_RE =
  /\b(?:apply\s+online|online\s+application|application\s+(?:form|link|portal|page)|submit\s+(?:your\s+)?application\s+(?:via|through|using)\s+(?:the\s+)?(?:link|form|portal|website)|click\s+(?:here|the\s+link)\s+to\s+apply|complete\s+(?:the\s+)?(?:online\s+)?application)\b/i;

function externalApplicationUrl(text, { source, pageUrl }) {
  const lines = normalizeLines(text).split("\n");
  for (const match of String(text || "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const url = asText(match[0]).replace(/[.,;]+$/, "");
    if (isSourceUrl(url, source, pageUrl) || isSocialHost(url)) continue;
    let lineIndex = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(match[0])) {
        lineIndex = i;
        break;
      }
    }
    const bare = (lines[lineIndex] || "").replace(/^[•\-*–]\s*/, "").trim();
    if (NON_APPLICATION_LABEL_RE.test(bare)) continue;
    const context = `${lines[lineIndex - 1] || ""}\n${bare}`;
    if (!ONLINE_APPLICATION_CONTEXT_RE.test(context)) continue;
    if (!classifyDestination(url, { source, pageUrl }).valid) continue;
    return url;
  }
  return "";
}

function findButtonApply(html) {
  for (const match of String(html || "").matchAll(/<button\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/button>/gi)) {
    const label = safeHtmlToText(match[2], 200);
    if (!APPLY_LABEL_RE.test(label) || NON_APPLY_LABEL_RE.test(label)) continue;
    const attrs = parseAttributes(`<button ${match[1]}>`);
    const raw = attrs["data-href"] || attrs["data-url"] || attrs["data-target"] || "";
    const js = /(?:window\.open|location(?:\.href)?\s*=|location\.assign)\s*\(\s*["']([^"']+)["']/i.exec(attrs.onclick || "")?.[1] || "";
    return { label, href: raw || js, js, primary: true };
  }
  return null;
}

function parsePositions(text, count) {
  const lines = normalizeLines(text).split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = asText(lines[i]).replace(/^[•\-*–]\s*/, "");
    const m = /^(?:(\d{1,2})[.)]\s+|(?:position|post|vacancy)\s*(\d{1,2})\s*[:\-.)]\s*)(.+)$/i.exec(line);
    if (!m) continue;
    const title = asText(m[3]);
    if (title.length < 4 || title.length > 140 || !ROLE_WORD_RE.test(title)) continue;
    if (starts.length && i - starts[starts.length - 1].index < 2) continue;
    starts.push({ index: i, title });
  }
  if (starts.length < 2 && !count) return [];
  const positions = starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].index : lines.length;
    const chunk = lines.slice(start.index + 1, end).join("\n");
    const education = labeledValue(chunk, ["Education", "Educational qualification", "Qualification", "Academic qualification"], { max: 400 });
    const experience = labeledValue(chunk, ["Experience", "Work experience", "Required experience"], { max: 400 });
    return { title: start.title, education: education || null, experience: experience || null };
  });
  return positions.slice(0, 30);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

/**
 * Reconstruct one ETcareers job page into the employer's clean vacancy record.
 *
 * @param {object} input
 * @param {string} input.html raw individual-page HTML
 * @param {string} input.pageUrl canonical ETcareers detail URL
 * @param {object} [input.source] job_sources row
 * @param {object} [input.applyResolution] engine result of redirect verification
 */
export function extractEtcareersRecord({ html = "", pageUrl = "", source = null, applyResolution = null } = {}) {
  const meta = extractMeta(html);
  const jsonLdItems = extractJsonLd(html);
  const jsonLd = findJobPosting(jsonLdItems);
  const headerHtml = extractHeaderHtml(html);
  const mainHtml = extractMainHtml(html, headerHtml);
  const headerText = cleanNoiseText(safeHtmlToText(headerHtml));
  const headerAnchors = parseAnchors(headerHtml);
  const mainAnchors = parseAnchors(mainHtml);
  const bodyText = cleanNoiseText(safeHtmlToText(mainHtml));
  const descriptionText = bodyText.slice(0, 50000);

  const titleFromHeader = asText((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1]);
  const title = stripBoardBrand(titleFromHeader || jsonLd?.title || meta["og:title"] || "").slice(0, 300);
  const company = companyFromHeader(headerText, headerAnchors, headerHtml) || companyFromJsonLd(jsonLd) || "";
  const logo = selectLogo({ headerHtml, mainHtml, meta, jsonLd, company, source, pageUrl });
  const companyWebsite = companyWebsiteFromEvidence({ headerAnchors, mainAnchors, jsonLd, company, source, pageUrl });

  const postedTime =
    relativeTime(headerText) ||
    relativeTime(bodyText.slice(0, 1200)) ||
    asText(jsonLd?.datePosted || meta["article:published_time"] || meta.date || "");
  const type = employmentType(headerText || bodyText.slice(0, 2000), jsonLd);
  const workplace = workplaceType(headerText || bodyText.slice(0, 2000), jsonLd);
  const location = labeledValue(headerText, ["Location", "Job location", "Duty station", "Place of work"]) || locationFromJsonLd(jsonLd) || "";
  const categories = categoriesFromHeader(headerHtml, headerAnchors, jsonLd);

  const positionsCountMatch =
    /\b(\d{1,3})\s+(?:job\s+)?(?:positions?|vacanc(?:ies|y)|openings?)\b/i.exec(`${title}\n${headerText}\n${descriptionText.slice(0, 4000)}`) ||
    /(?:number\s+of\s+positions|vacancies|openings|positions)\s*[:=]\s*(\d{1,3})/i.exec(`${headerText}\n${descriptionText.slice(0, 4000)}`);
  const number_of_positions = positionsCountMatch ? clamp(parseInt(positionsCountMatch[1], 10), 1, 99) || null : null;

  const sections = sectionizeText(descriptionText);
  const description = cleanNoiseText(descriptionText);
  const job_overview = cleanNoiseText((sections.job_overview || []).join("\n")).slice(0, 8000);
  const responsibilities = bulletLines(sections.responsibilities, { max: 60 });
  const qualifications = bulletLines(sections.qualifications, { max: 60 });
  const experience = bulletLines(sections.experience_requirements, { max: 40 });
  const skills = bulletLines(sections.skills, { max: 40 });
  const benefits = bulletLines(sections.benefits, { max: 40 });
  const salaryLine = labeledValue(descriptionText, ["Salary", "Remuneration", "Compensation", "Pay scale"], { max: 200 }) || (sections.salary || []).join(" ");
  const salary = asText(salaryLine).slice(0, 200) || null;
  const deadline = firstMeaningfulDate(
    jsonLd?.validThrough ||
      labeledValue(descriptionText, ["Application deadline", "Deadline", "Closing date", "Apply before", "Last date", "Submission deadline"], { max: 160 }) ||
      (sections.deadline || []).join(" ")
  );

  const positions = parsePositions((sections.positions || []).join("\n") || descriptionText, number_of_positions);
  const instructions = cleanNoiseText((sections.application || []).join("\n")).slice(0, 12000);
  const sourceDomains = sourceHosts(source, pageUrl);
  const sourceDomainsForEmails = sourceDomains.filter((d) => d.includes("."));

  // ETcareers renders the real CTA in a sticky sidebar OUTSIDE .rich-text.
  // Search the full terminated page region (before related jobs/footer) so the
  // legitimate id="apply-btn" anchor is found. locateApplyLink prefers that
  // primary CTA over any incidental apply-labelled link in the body.
  const ctaHtml = cutAtTermination(html);
  const located = locateApplyLink(ctaHtml, pageUrl, source);
  const button = located.chosen || findButtonApply(ctaHtml);
  const apply_button_text = asText(button?.label || "").slice(0, 120);
  const rawButtonHref = asText(button?.href || "");
  const apply_button_url = absoluteUrl(rawButtonHref, pageUrl) || "";
  const buttonDecoded = rawButtonHref && !/^mailto:/i.test(rawButtonHref) ? decodeRedirectUrl(rawButtonHref, pageUrl) : null;
  const buttonJsUrl = button?.js ? absoluteUrl(button.js, pageUrl) : null;

  const emails = applicationEmails({ instructions, description, chosen: button, sourceDomains: sourceDomainsForEmails });
  const phone_numbers = findPhones(instructions);
  const physical = physicalAddress(instructions);
  const instructionApplicationUrl = externalApplicationUrl(instructions, { source, pageUrl });

  const validDestination = (url) => {
    if (!url) return false;
    if (/^mailto:/i.test(url)) return false;
    if (isSourceUrl(url, source, pageUrl) || isSocialHost(url)) return false;
    return classifyDestination(url, { source, pageUrl }).valid;
  };
  const resolutionUrl = absoluteUrl(applyResolution?.finalUrl || applyResolution?.url || "", pageUrl) || "";
  const decodedUrl = buttonDecoded ? absoluteUrl(buttonDecoded, pageUrl) : "";
  const directUrl = /^mailto:/i.test(apply_button_url) ? "" : apply_button_url;

  let application_url = null;
  // A wrapped/redirecting href is unwrapped before publication: the raw href
  // is kept in apply_button_url, while application_url is the real destination.
  if (validDestination(decodedUrl)) application_url = decodedUrl;
  else if (validDestination(directUrl)) application_url = directUrl;
  else if (validDestination(buttonJsUrl)) application_url = buttonJsUrl;
  else if (validDestination(resolutionUrl)) application_url = resolutionUrl;
  else if (validDestination(instructionApplicationUrl)) application_url = instructionApplicationUrl;

  const finalUrlCandidate = absoluteUrl(applyResolution?.finalUrl || "", pageUrl) || "";
  const final_application_url = application_url && validDestination(finalUrlCandidate) ? finalUrlCandidate : "";
  const verified =
    !!application_url &&
    (typeof applyResolution?.verified === "boolean"
      ? applyResolution.verified
      : typeof applyResolution?.ok === "boolean"
        ? applyResolution.ok
        : !!button?.valid || validDestination(decodedUrl));

  const methods = [];
  if (application_url) methods.push("online");
  if (emails.length || /^mailto:/i.test(apply_button_url)) methods.push("email");
  if (physical) methods.push("physical");
  if (!methods.length) methods.push("unknown");

  const application = {
    method: unique(methods),
    emails,
    phone_numbers,
    physical_address: physical,
    instructions: instructions || (emails.length ? `Apply by email: ${emails.join(", ")}` : ""),
    apply_button_text,
    apply_button_url,
    final_application_url,
    application_url,
    application_url_verified: !!verified,
  };

  const jobContentVerified = !!title && !!company && description.length >= 180;
  const extraction_quality = {
    job_content_verified: jobContentVerified,
    advertisements_removed: true,
    footer_removed: true,
    related_jobs_removed: true,
    logo_verified: !!logo,
    application_url_verified: !!verified,
  };

  const jobConfidence = clamp(
    0.48 +
      (titleFromHeader ? 0.13 : 0) +
      (company ? 0.1 : 0) +
      (description.length >= 500 ? 0.16 : description.length >= 200 ? 0.08 : 0) +
      (jsonLd ? 0.06 : 0) +
      (!jobContentVerified ? -0.15 : 0),
    0,
    1
  );
  const logoConfidence = logo ? (logo.source === "job_header" ? 0.96 : logo.source === "jsonld" ? 0.9 : 0.78) : 0;
  const applicationConfidence = !application_url
    ? 0
    : verified && final_application_url
      ? 0.99
      : decodedUrl && validDestination(decodedUrl)
        ? 0.92
        : validDestination(application_url)
          ? 0.82
          : 0.65;

  return {
    source: SOURCE_NAME,
    source_url: canonicalUrl(pageUrl) || pageUrl,
    title,
    company,
    logo,
    posted_time: postedTime.slice(0, 160),
    employment_type: type.slice(0, 80),
    workplace_type: workplace.slice(0, 80),
    location: asText(location).slice(0, 200),
    categories,
    number_of_positions,
    positions,
    description,
    job_overview,
    responsibilities,
    qualifications,
    experience_requirements: experience,
    skills,
    salary,
    benefits,
    deadline,
    application,
    company_website: companyWebsite,
    extraction_quality,
    confidence: {
      job: Math.round(jobConfidence * 100) / 100,
      logo: Math.round(clamp(logoConfidence, 0, 1) * 100) / 100,
      application_url: Math.round(clamp(applicationConfidence, 0, 1) * 100) / 100,
    },
  };
}

/**
 * Merge the engine's live redirect-verification result into an already
 * extracted record. Used after Stage B verification so raw_payload auditing
 * records the final application destination without changing public behaviour.
 */
export function applyEtcareersResolution(job, resolution) {
  if (!job?.etcareersRecord || !resolution) return job;
  const record = job.etcareersRecord;
  const rawFinal = String(resolution.finalUrl || resolution.url || "").trim();
  // A mailto CTA is an email application, not an online application URL.
  const finalUrl = rawFinal && !/^mailto:/i.test(rawFinal)
    ? absoluteUrl(rawFinal, record.source_url) || ""
    : "";
  const verified = !!finalUrl && (typeof resolution.verified === "boolean"
    ? resolution.verified
    : typeof resolution.ok === "boolean"
      ? resolution.ok
      : true);
  const application = {
    ...record.application,
    final_application_url: finalUrl || record.application.final_application_url || "",
    application_url: finalUrl || record.application.application_url || null,
    application_url_verified: verified || !!record.application.application_url_verified,
  };
  return {
    ...job,
    etcareersRecord: {
      ...record,
      application,
      extraction_quality: {
        ...record.extraction_quality,
        application_url_verified: !!application.application_url_verified,
      },
      confidence: {
        ...record.confidence,
        application_url: application.application_url_verified ? Math.max(0.82, Number(record.confidence?.application_url) || 0) : 0,
      },
    },
  };
}

export default extractEtcareersRecord;
