// HTML parsing + strict sanitisation. No external parser dependency: the sync
// pipeline only needs structured extraction and a safe, allowlisted HTML subset
// for job descriptions.

const ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(input) {
  return String(input == null ? "" : input).replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (full, body) => {
      const key = body.toLowerCase();
      if (key[0] === "#") {
        const code = key[1] === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return full;
          }
        }
        return full;
      }
      return Object.prototype.hasOwnProperty.call(ENTITY_MAP, key) ? ENTITY_MAP[key] : full;
    }
  );
}

function escapeBareAmpersands(s) {
  return String(s).replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

const REMOVE_BLOCK_RE =
  /<(script|style|noscript|template|iframe|object|embed|svg|math|canvas|video|audio|form|input|button|select|textarea|meta|link)\b[^>]*>[\s\S]*?<\/\1>/gi;

export function stripDangerousBlocks(html) {
  let s = String(html == null ? "" : html);
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ");
  s = s.replace(/<\?[\s\S]*?\?>/g, " ");
  // Remove the CONTENT of script/style blocks first, otherwise the opening
  // tag is stripped by the void-tag rule below and the body (for example a
  // JSON-LD document) leaks into the visible text.
  s = s.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Self-closing / void forms of the removed tags.
  s = s.replace(/<(?:script|style|iframe|object|embed|svg|math|canvas|video|audio|form|input|button|select|textarea|meta|link)\b[^>]*\/?>/gi, " ");
  s = s.replace(REMOVE_BLOCK_RE, " ");
  return s;
}

export function htmlToText(html, max = null) {
  const source = stripDangerousBlocks(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|section|article|tr|td|th|main|blockquote|dl|dt|dd|pre)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  let text = decodeEntities(source)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (max && text.length > max) text = `${text.slice(0, max - 1).trimEnd()}…`;
  return text;
}

export function textToParagraphHtml(text) {
  const clean = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return "";
  return clean
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

export function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || "").matchAll(re)) {
    let raw = match[1].trim().replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "");
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        parsed = JSON.parse(decodeEntities(raw));
      } catch {
        continue;
      }
    }
    const queue = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of queue) {
      if (!item || typeof item !== "object") continue;
      out.push(item);
      if (Array.isArray(item["@graph"])) {
        for (const nested of item["@graph"]) if (nested && typeof nested === "object") out.push(nested);
      }
    }
  }
  return out;
}

export function jsonLdTypes(item) {
  return [].concat(item?.["@type"] || []).map((t) => String(t).toLowerCase());
}

export function findJobPosting(htmlOrItems) {
  const items = Array.isArray(htmlOrItems) ? htmlOrItems : extractJsonLd(htmlOrItems);
  const postings = items.filter((item) => jsonLdTypes(item).includes("jobposting"));
  if (!postings.length) return null;
  // Prefer the posting with the most complete description/hiringOrganization.
  return postings.sort((a, b) => {
    const score = (x) =>
      (x?.description ? 2 : 0) +
      (x?.hiringOrganization?.name ? 2 : 0) +
      (x?.title ? 1 : 0) +
      (x?.datePosted || x?.validThrough ? 1 : 0);
    return score(b) - score(a);
  })[0];
}

// ---------------------------------------------------------------------------
// Tags / meta / links
// ---------------------------------------------------------------------------

export function parseAttributes(tag) {
  const attrs = {};
  const body = String(tag || "").replace(/^<\s*\/?\s*[a-zA-Z0-9:-]+/, "").replace(/\/?>$/, "");
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of body.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (name === "class" || name === "id" || name.startsWith("data-") || name === "style") {
      attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
      continue;
    }
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export function extractMeta(html) {
  const meta = {};
  for (const m of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(m[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (!key || attrs.content == null) continue;
    if (!(key in meta)) meta[key] = attrs.content;
  }
  return meta;
}

export function extractTitleTag(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ""));
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

export function extractH1(html) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(String(html || ""));
  return m ? htmlToText(m[1], 400) : "";
}

export function extractAnchors(html) {
  const anchors = [];
  for (const m of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttributes(`<a ${m[1]}>`);
    anchors.push({
      href: attrs.href || "",
      text: htmlToText(m[2], 300),
      title: attrs.title || "",
      ariaLabel: attrs["aria-label"] || "",
      className: attrs.class || "",
      id: attrs.id || "",
      rel: attrs.rel || "",
      rawAttrs: attrs,
    });
  }
  return anchors;
}

export function extractForms(html) {
  const forms = [];
  for (const m of String(html || "").matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = parseAttributes(`<form ${m[1]}>`);
    forms.push({ action: attrs.action || "", method: attrs.method || "get", className: attrs.class || "", id: attrs.id || "", inner: m[2] });
  }
  return forms;
}

export function extractInlineNavigation(html) {
  const urls = [];
  const source = String(html || "");
  const patterns = [
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
    /window\.open\(\s*["']([^"']+)["']/gi,
    /location\.assign\(\s*["']([^"']+)["']/gi,
    /location\.replace\(\s*["']([^"']+)["']/gi,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const v = m[1].trim();
      if (/^https?:\/\//i.test(v) || v.startsWith("/")) urls.push(v);
    }
  }
  return [...new Set(urls)];
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

const CHROME_CLASS_RE =
  /(?:^|[\s_-])(?:related|sidebar|share|social|breadcrumb|apply-form|application-form|cookie|newsletter|comment|advert|ad-|promo|navbar|navigation|footer|header|menu|modal|popup|banner)(?:$|[\s_-])/i;

export function extractMainContentHtml(html) {
  let source = String(html || "");
  // Remove obvious global chrome before scoring candidates.
  source = source
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<(script|style|noscript|template|svg|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const candidates = [];
  const push = (htmlChunk, weight) => {
    if (!htmlChunk) return;
    const text = htmlToText(htmlChunk);
    if (text.length < 80) return;
    candidates.push({ html: htmlChunk, weight, length: text.length });
  };

  for (const m of source.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)) push(m[1], 2);
  for (const m of source.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) push(m[1], 2);
  for (const m of source.matchAll(/<(?:div|section)\b([^>]*)>([\s\S]*?)<\/(?:div|section)>/gi)) {
    const attrs = m[1] || "";
    if (!/(?:id|class)\s*=\s*["'][^"']*(?:job|vacancy|description|content|detail|post|entry|single|role|position|opportunity)[^"']*["']/i.test(attrs)) continue;
    if (CHROME_CLASS_RE.test(attrs)) continue;
    push(m[2], 1.5);
  }

  if (!candidates.length) {
    const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(source);
    return body ? body[1] : source;
  }
  candidates.sort((a, b) => b.length * b.weight - a.length * a.weight);
  return candidates[0].html;
}

function stripChromeBlocks(html) {
  return String(html || "")
    .replace(/<(?:div|section|aside|nav|footer|header)\b([^>]*)>[\s\S]*?<\/(?:div|section|aside|nav|footer|header)>/gi, (full, attrs) => {
      if (CHROME_CLASS_RE.test(attrs || "")) return " ";
      return full;
    })
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, " ");
}

export function extractSectionHtml(html, labels, stopLabels = []) {
  const source = String(html || "");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelRe = labels.map(esc).join("|");
  const stopRe = stopLabels.map(esc).join("|");
  const headingRe = new RegExp(
    `<h([1-6])[^>]*>[\\s\\S]{0,120}?(?:${labelRe})[\\s\\S]{0,80}?<\\/h\\1>([\\s\\S]*?)(?=<h[1-6][^>]*>|$)`,
    "i"
  );
  const m = headingRe.exec(source);
  if (m) {
    let body = m[2];
    if (stopRe) {
      const stop = new RegExp(`<h[1-6][^>]*>[\\s\\S]{0,120}?(?:${stopRe})[\\s\\S]{0,80}?<\\/h[1-6]>`, "i").exec(body);
      if (stop) body = body.slice(0, stop.index);
    }
    return body.trim();
  }
  // Bold-label fallback: <p><strong>How to Apply</strong></p> ...
  const boldRe = new RegExp(
    `<p[^>]*>\\s*<(?:strong|b)[^>]*>\\s*(?:${labelRe})\\s*:?\\s*<\\/(?:strong|b)>\\s*<\\/p>([\\s\\S]*?)(?=<p[^>]*>\\s*<(?:strong|b)[^>]*>|$)`,
    "i"
  );
  const b = boldRe.exec(source);
  return b ? b[1].trim() : "";
}

export function extractSectionText(html, labels, stopLabels = []) {
  const chunk = extractSectionHtml(html, labels, stopLabels);
  return chunk ? htmlToText(chunk) : "";
}

// ---------------------------------------------------------------------------
// Sanitiser
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s",
  "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "a", "table", "thead",
  "tbody", "tfoot", "tr", "th", "td", "dl", "dt", "dd", "span", "div", "sup",
  "sub", "code", "pre",
]);

const VOID_TAGS = new Set(["br", "hr"]);

const ALLOWED_ATTRS = {
  a: new Set(["href", "title"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  ol: new Set(["start"]),
  span: new Set(["dir", "lang"]),
  p: new Set(["dir", "lang"]),
  div: new Set(["dir", "lang"]),
};

export function sanitizeHtml(input, { baseUrl = "" } = {}) {
  let source = stripDangerousBlocks(input);
  source = stripChromeBlocks(source);
  source = source.replace(/<\/?([a-zA-Z0-9:-]+)((?:\s+[^<>]*?)?)\s*\/?>/g, (full, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return " ";
    if (full.startsWith("</")) return `</${tag}>`;
    if (VOID_TAGS.has(tag)) return `<${tag}>`;

    const allowed = ALLOWED_ATTRS[tag];
    if (!allowed) return `<${tag}>`;
    const attrs = parseAttributes(`<${tag} ${rawAttrs || ""}>`);
    const parts = [];
    for (const [name, value] of Object.entries(attrs)) {
      if (!allowed.has(name)) continue;
      if (!value) continue;
      if (name === "href") {
        const href = normalizeHref(value, baseUrl);
        if (!href) continue;
        parts.push(`href="${escapeHtml(href)}"`);
        continue;
      }
      parts.push(`${name}="${escapeHtml(value)}"`);
    }
    if (tag === "a") {
      if (!parts.some((p) => p.startsWith("href="))) return "<span>";
      const href = attrs.href || "";
      if (!href.startsWith("mailto:")) parts.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
    }
    return `<${tag}${parts.length ? ` ${parts.join(" ")}` : ""}>`;
  });

  source = escapeBareAmpersands(source)
    .replace(/<(?![a-zA-Z/!])/g, "&lt;")
    .replace(/\s+>/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return source;
}

function normalizeHref(value, baseUrl) {
  const raw = String(value || "").trim();
  if (/^mailto:/i.test(raw)) {
    const email = raw.slice(7).split("?")[0].trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return null;
    return `mailto:${email}`;
  }
  if (/^(javascript|data|vbscript|file|blob):/i.test(raw)) return null;
  try {
    const u = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function findEmails(text, { sourceDomains = [] } = {}) {
  const found = [];
  for (const m of String(text || "").matchAll(EMAIL_RE)) {
    const email = m[0].replace(/[.,;:)\]]+$/, "").toLowerCase();
    if (/(?:sentry|wixpress|example\.com|\.png$|\.jpe?g$|\.gif$|\.webp$|email-protection|no-?reply|donotreply)/i.test(email)) continue;
    if (sourceDomains.some((d) => email.endsWith(`@${d}`) || email.endsWith(`.${d}`))) continue;
    if (!found.includes(email)) found.push(email);
  }
  return found;
}

export function collapseWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function truncate(text, max) {
  const s = String(text || "").trim();
  if (!max || s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}
