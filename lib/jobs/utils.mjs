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
