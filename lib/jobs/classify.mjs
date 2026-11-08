import { query } from "../db.mjs";

let cache = { at: 0, rows: [] };

export async function loadCategories() {
  if (Date.now() - cache.at < 5 * 60 * 1000 && cache.rows.length) return cache.rows;
  const rows = await query("select id, slug, name, keywords from job_categories order by name");
  cache = { at: Date.now(), rows };
  return rows;
}

export function classifyText(text, categories) {
  const hay = String(text || "").toLowerCase();
  const matched = [];
  for (const c of categories) {
    const kws = Array.isArray(c.keywords) ? c.keywords : [];
    if (kws.some((k) => k && hay.includes(String(k).toLowerCase()))) matched.push(c);
  }
  if (!matched.length) {
    const other = categories.find((c) => c.slug === "other");
    if (other) matched.push(other);
  }
  return matched;
}
