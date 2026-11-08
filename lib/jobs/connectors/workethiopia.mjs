// WorkEthiopia public job listings (best-effort, respectful).
// robots.txt allows all agents; listings link to official employer application pages.
// Fetches a small batch and resolves official application links from detail pages.

import { toDate } from "../utils.mjs";

export const slug = "workethiopia";

function decode(s = "") {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
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

async function resolveOfficialUrl(detailUrl) {
  try {
    const html = await fetchText(detailUrl);
    // Prefer explicit external application links; avoid internal/share links.
    const candidates = [...html.matchAll(/<a[^>]+href="(https?:\/\/(?!workethiopia\.net)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    for (const c of candidates) {
      const href = c[1];
      const label = decode(c[2]).toLowerCase();
      if (/apply|official|careers|vacanc|job|view (role|job)|company site|employer site|recruit/i.test(label) && !/facebook|twitter|linkedin|whatsapp|telegram|mailto:|share/i.test(href)) {
        return href;
      }
    }
    // fallback: first plausible external non-social link
    for (const c of candidates) {
      const href = c[1];
      if (!/facebook\.com|twitter\.com|x\.com|linkedin\.com|wa\.me|t\.me|mailto:/i.test(href)) return href;
    }
  } catch {}
  return detailUrl;
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
    const originalUrl = await resolveOfficialUrl(detailUrl);
    jobs.push({
      external_id: detailPath,
      title,
      company: company || null,
      location: location || "Ethiopia",
      region_city: location || "Ethiopia",
      original_url: originalUrl || detailUrl,
      posted_date: null,
      deadline: parseDeadline(deadlineText),
      description: `${title}${company ? ` — ${company}` : ""}. Public listing discovered via WorkEthiopia; apply using the official employer/application link.`,
      requirements: null,
      application_instructions: "Apply via the official employer/application link (organization exact link).",
      job_type: null,
      category: category || null,
      raw_source: "workethiopia-html"
    });
  }
  const seen = new Set();
  return jobs.filter(j => j.title && j.original_url && !seen.has(j.original_url) && seen.add(j.original_url));
}