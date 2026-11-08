// WorkEthiopia public job listings (best-effort, respectful).
// robots.txt allows all agents; listings link to official employer application pages.
// Fetches a small batch and resolves official application links from detail pages.

import { cleanText, fetchPublicJobDetails, fetchPublicLogo, logoFromUrl, toDate } from "../utils.mjs";

export const slug = "workethiopia";

function decode(s = "") {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|section|article|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function extractSection(text, labels) {
  if (!text) return null;
  const labelRe = labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?:^|\\n)\\s*(?:${labelRe})\\s*:?\\s*\\n?([\\s\\S]{20,}?)(?=\\n\\s*(?:How to apply|Application|Requirements|Qualifications|Responsibilities|Duties|About the role|Job description|Description|Location|Deadline|Contract|Salary|Benefits|Experience|Education|Skills|Company|Employer|Apply now|Share|Similar jobs|Back to jobs)\\s*:?\\s*\\n|$)`, "i");
  const m = text.match(re);
  return m ? cleanText(m[1], 20000) : null;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HabeshaCareers/1.0 (+https://habeshacareers-brown.vercel.app; job aggregation; public listings; contact site admin)",
      "Accept": "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`WorkEthiopia HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseDeadline(text) {
  if (!text) return null;
  // e.g. "Saturday, 14 November 2026, 07:59 EAT"
  const m = text.match(/(\d{1,2}\s+\w+\s+\d{4})/i);
  return m ? toDate(m[1]) : toDate(text);
}

function absUrl(href, base) {
  try { if (!href) return null; return new URL(href, base).toString(); } catch { return /^https?:/i.test(href) ? href : null; }
}

function extractLogo(html, baseUrl, company) {
  const companyNorm = cleanText(company || "", 80) || "";
  const imgs = [...html.matchAll(/<img\b([^>]+)>/gi)];
  let best = null, bestScore = -1;
  for (const m of imgs) {
    const attrs = m[1] || "";
    const src = (attrs.match(/\b(?:data-src|src)=["']([^"']+)["']/i) || [])[1];
    if (!src || /logo\.png$|placeholder|sprite|pixel|data:image\/svg\+xml;base64,PHN2Zy/i.test(src)) continue;
    const alt = ((attrs.match(/\balt=["']([^"']*)["']/i) || [])[1] || "").toLowerCase();
    const cls = ((attrs.match(/\bclass=["']([^"']*)["']/i) || [])[1] || "").toLowerCase();
    const id = ((attrs.match(/\bid=["']([^"']*)["']/i) || [])[1] || "").toLowerCase();
    let score = 0;
    const hay = `${alt} ${cls} ${id} ${src.toLowerCase()}`;
    if (/logo|brand|company|employer|organization|org-/.test(hay)) score += 5;
    if (/icon|avatar|favicon/.test(hay)) score += 1;
    if (/banner|hero|cover|background|photo|image|slide/.test(hay)) score -= 3;
    if (companyNorm && alt && companyNorm.toLowerCase().split(/\s+/).some(w => w.length > 2 && alt.includes(w))) score += 4;
    const abs = absUrl(src, baseUrl);
    if (!abs || !/^https?:/i.test(abs)) continue;
    if (score > bestScore) { bestScore = score; best = abs; }
  }
  if (best && bestScore >= 4) return best;
  const og = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1];
  if (og && !/workethiopia|default|placeholder/i.test(og)) return absUrl(og, baseUrl);
  return null;
}

function pickOfficialUrl(html, detailUrl) {
  const candidates = [...html.matchAll(/<a[^>]+href="(https?:\/\/(?!workethiopia\.net)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const c of candidates) {
    const href = c[1];
    const label = decode(c[2]).toLowerCase();
    if (/apply|official|careers|vacanc|job|view (role|job)|company site|employer site|recruit/i.test(label) && !/facebook|twitter|linkedin|whatsapp|telegram|mailto:|share/i.test(href)) {
      return href;
    }
  }
  for (const c of candidates) {
    const href = c[1];
    if (!/facebook\.com|twitter\.com|x\.com|linkedin\.com|wa\.me|t\.me|mailto:/i.test(href)) return href;
  }
  return detailUrl;
}

async function fetchDetail(detailUrl, company) {
  try {
    const html = await fetchText(detailUrl);
    const text = decode(html);
    const originalUrl = pickOfficialUrl(html, detailUrl);
    const description = extractSection(text, ["Job description","Description","About the role","Role overview","Position summary","Summary","About the position","The role"]) || cleanText(text, 15000);
    const requirements = extractSection(text, ["Requirements","Qualifications","Required qualifications","Minimum requirements","What you bring","Skills and experience","Profile"]);
    const application = extractSection(text, ["How to apply","Application instructions","Application process","To apply"]);
    const logo = extractLogo(html, detailUrl, company);
    return { originalUrl, description, requirements, application_instructions: application, logo };
  } catch {
    return { originalUrl: detailUrl, description: null, requirements: null, application_instructions: null, logo: null };
  }
}

export async function fetchJobs(source) {
  const base = "https://workethiopia.net";
  const html = await fetchText(source.listing_url || base + "/");
  const tiles = [...html.matchAll(/<a[^>]+class="[^"]*job-tile[^"]*"[^>]+href="([^"]+)"[\s\S]*?<span class="job-tile-meta">([\s\S]*?)<\/span>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?(?:<p class="job-tile-deadline">([\s\S]*?)<\/p>)?[\s\S]*?(?:<span class="job-tile-tags">([\s\S]*?)<\/span>)?/gi)];
  const jobs = [];
  for (const t of tiles.slice(0, 12)) {
    const detailPath = t[1];
    const meta = decode(t[2]);
    const title = decode(t[3]);
    const deadlineText = decode(t[4] || "");
    const tagsHtml = t[5] || "";
    if (!title || !detailPath) continue;
    const detailUrl = detailPath.startsWith("http") ? detailPath : base + detailPath;
    const [company, location] = meta.split(/\s+[·•]\s+/).map(s => s && s.trim());
    const tagMatches = [...tagsHtml.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map(m => decode(m[1])).filter(Boolean);
    const category = tagMatches.find(x => !/direct employer|employer/i.test(x)) || null;
    const detail = await fetchDetail(detailUrl, company);
    const originalUrl = detail.originalUrl || detailUrl;
    let full = null;
    const needsFull = !detail.description || detail.description.length < 180 || !detail.requirements;
    if (needsFull && originalUrl && !/workethiopia\.net/i.test(originalUrl)) full = await fetchPublicJobDetails(originalUrl, 6500).catch(() => null);
    let logo = detail.logo || null;
    if (!logo) logo = await fetchPublicLogo(originalUrl).catch(() => null);
    if (!logo && full && full.logo) logo = full.logo;
    if (!logo) logo = logoFromUrl(originalUrl);
    const description = (full && full.description && full.description.length > (detail.description || "").length) ? full.description : detail.description;
    const requirements = detail.requirements || (full && full.requirements) || null;
    jobs.push({
      external_id: detailPath,
      title,
      company: company || null,
      logo,
      location: (full && full.location) || location || "Ethiopia",
      region_city: (full && full.location) || location || "Ethiopia",
      original_url: originalUrl,
      posted_date: null,
      deadline: parseDeadline(deadlineText),
      description: description || `${title}${company ? ` — ${company}` : ""}. See the official organization application page for full vacancy details.`,
      requirements,
      application_instructions: detail.application_instructions || (full && full.application_instructions) || "Apply via the official organization application page.",
      job_type: (full && full.job_type) || null,
      category: category || null,
      raw_source: "workethiopia-html"
    });
  }
  const seen = new Set();
  return jobs.filter(j => j.title && j.original_url && !seen.has(j.original_url) && seen.add(j.original_url));
}