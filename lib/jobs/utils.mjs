import crypto from "node:crypto";

export function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9\u1200-\u137f ]/g, "").trim();
}

export function excerpt(text, max = 240) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function dedupHash({ title, company, location, deadline, original_url }) {
  const key = [norm(title), norm(company), norm(location), toDate(deadline) || "", (original_url || "").trim().toLowerCase()].join("|");
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function legacyKey(sourceSlug, externalId, url) {
  if (externalId) return `${sourceSlug}:${externalId}`;
  if (url) return `${sourceSlug}:url:${crypto.createHash("sha1").update(url).digest("hex")}`;
  return null;
}

export function isExpired(deadline) {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0,0,0,0);
  return d < today;
}

export function logoFromUrl(url) {
  try {
    if (!url) return null;
    const u = new URL(String(url));
    const host = u.hostname.replace(/^www\./i, "");
    if (!host || host === "localhost") return null;
    return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
  } catch { return null; }
}

export async function fetchPublicLogo(pageUrl, timeoutMs = 4500) {
  try {
    if (!pageUrl || !/^https?:/i.test(pageUrl)) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": "HabeshaCareers/1.0 (public vacancy aggregation; logo discovery)", "Accept": "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|xhtml/i.test(ct)) return null;
    const html = (await res.text()).slice(0, 180000);
    const abs = (href) => { try { return href ? new URL(href, pageUrl).toString() : null; } catch { return null; } };
    const metas = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/ig,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/ig,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/ig,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/ig,
    ];
    for (const re of metas) for (const m of html.matchAll(re)) { const u = abs(m[1]); if (u && /^https?:/i.test(u)) return u; }
    const icons = [...html.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/ig)];
    let best = null, bestSz = -1;
    for (const m of icons) {
      const tag = m[0];
      const href = (tag.match(/\bhref=["']([^"']+)["']/i) || [])[1];
      const sizes = (tag.match(/\bsizes=["']([^"']+)["']/i) || [])[1] || "";
      const sz = Math.max(0, ...sizes.split(/\s+/).map(s => parseInt(s,10)||0));
      const u = abs(href);
      if (u && /^https?:/i.test(u) && sz >= bestSz) { bestSz = sz; best = u; }
    }
    return best;
  } catch { return null; }
}

export function cleanText(s, max = null) {
  if (s == null) return null;
  let t = String(s).replace(/\r\n?/g, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return null;
  if (max && t.length > max) t = t.slice(0, max - 1) + "…";
  return t;
}

export function mapCategoryToFrontend(categories = [], fallback = null) {
  // Preserve existing frontend category labels where possible; default to broad mapping.
  if (fallback) return fallback;
  const names = categories.map((c) => c.name || c);
  const has = (n) => names.some((x) => x === n);
  if (has("Information Technology") || has("Data Science")) return "Information Technology";
  if (has("Medicine") || has("Nursing") || has("Pharmacy") || has("Public Health") || has("Epidemiology") || has("Nutrition") || has("Laboratory")) return "Healthcare and Medical";
  if (has("Finance")) return "Finance and Accounting";
  if (has("Education")) return "Education and Training";
  if (has("Engineering")) return "Engineering and Technical";
  if (has("Humanitarian") || has("Development") || has("Monitoring and Evaluation")) return "Business and Management";
  if (has("Logistics")) return "Transportation and Logistics";
  if (has("Agriculture") || has("Environmental Health")) return "Agriculture and Natural Resources";
  if (has("Research") || has("Biostatistics") || has("Statistics")) return "Science and Research";
  return "Business and Management";
}
