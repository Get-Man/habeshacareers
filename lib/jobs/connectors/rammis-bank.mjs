// Rammis Bank careers/vacancies (public, respectful).
// Public JSON feed used by https://rammisbank.et/jobs: https://rammisbank.et/api/vacancies
// No login/CAPTCHA/bypass. Employer's official vacancy page is the application destination.

import { cleanText, toDate } from "../utils.mjs";

export const slug = "rammis-bank";
const BASE = "https://rammisbank.et";
const JOBS_URL = `${BASE}/jobs`;
const API_URL = `${BASE}/api/vacancies`;
const UA = "HabeshaCareers/1.0 (+https://habeshacareers.vercel.app; public vacancy aggregation; respectful)";

function normalizeBullets(text = "") {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2022\u00B7\uF0A7\uF0B7\u25AA\u25CF\u25E6\uFFFD]/g, "•")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatLocation(raw = "") {
  const s = normalizeBullets(raw);
  if (!s) return null;
  const parts = s
    .split(/\n|•|\t|,|;/)
    .map((p) => cleanText(p, 120))
    .filter(Boolean);
  if (!parts.length) return cleanText(s, 200);
  const unique = [...new Set(parts)];
  if (unique.length <= 4) return unique.join(", ");
  return `${unique.slice(0, 4).join(", ")} (+${unique.length - 4} more)`;
}

function buildDescription(v) {
  const bits = [];
  const dept = cleanText(v?.department, 200);
  const vacNo = cleanText(v?.vacancy_number, 120);
  const loc = cleanText(normalizeBullets(v?.location || ""), 2000);
  const body = normalizeBullets(v?.description || "");
  if (dept) bits.push(`Department: ${dept}`);
  if (vacNo) bits.push(`Vacancy Number: ${vacNo}`);
  if (loc) bits.push(`Place of Work: ${loc}`);
  if (body) {
    if (bits.length) bits.push("");
    bits.push(body);
  }
  return bits.join("\n").trim();
}

export async function fetchJobs(source) {
  const cfg = source?.fetch_config || {};
  const limit = Math.max(1, Math.min(200, parseInt(cfg.limit || "200", 10) || 200));

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  let data;
  try {
    const res = await fetch(API_URL, {
      headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Rammis Bank API HTTP ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(t);
  }

  const items = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
  const selected = items
    .filter((v) => v && v.is_active !== false && v.is_open !== false)
    .slice(0, limit);

  const jobs = selected.map((v) => {
    const id = v.id != null ? String(v.id) : "";
    const title = cleanText(v.title, 300);
    const description = cleanText(buildDescription(v), 50000) || "Open the official Rammis Bank vacancy page for full details.";
    const location = formatLocation(v.location) || "Ethiopia";
    const deadline = toDate(v.closing_date);
    const posted = toDate(v.posted_at || v.updated_at);
    const jobType = cleanText(v.employment_type, 120);
    const applyInstruction = "Apply via the official Rammis Bank careers/vacancy page: " + JOBS_URL + " (follow the application instructions for this vacancy).";
    return {
      external_id: id || null,
      title,
      company: "Rammis Bank S.C.",
      logo: null,
      location,
      job_type: jobType || null,
      posted_date: posted,
      deadline,
      description,
      requirements: null,
      application_instructions: applyInstruction,
      contact_email: null,
      original_url: JOBS_URL,
      source_page: JOBS_URL,
      category: "Banking and Finance",
      raw_source: "rammisbank-api",
    };
  }).filter((j) => j.title);

  try {
    jobs.progress = { totalFound: items.length, fetched: selected.length, ok: jobs.length, done: true, listingMode: "api" };
  } catch {}
  return jobs;
}

export default { slug, fetchJobs };
