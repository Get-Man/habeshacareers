// UN Careers (careers.un.org) connector (public, respectful).
// Uses the OFFICIAL public RSS feed published by the site itself: https://careers.un.org/jobfeed
// (RSS 2.0 with structured vacancy metadata: level, job id, network, department, duty station,
// posted date, deadline). Detail pages are an Angular SPA; no public HTML description exists.
// No login/CAPTCHA/bypass; feed-only access with small batched upserts.

import { cleanText, toDate } from "../utils.mjs";

export const slug = "careersun";
const BASE = "https://careers.un.org";
const UA = "HabeshaCareers/1.0 (+https://habeshacareers.vercel.app; authorized/public feed aggregation; respectful)";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`UNCareers HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function decodeXml(s = "") {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ");
}

function usDate(dStr) {
  const m = String(dStr || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return toDate(`${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
}

function parseItem(fragment, feedUrl) {
  const title = decodeXml((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(fragment) || [])[1]);
  const link = cleanText((/<link>\s*([^<\s]+)\s*<\/link>/i.exec(fragment) || [])[1], 600);
  if (!title || !link) return null;

  const rawDesc = decodeXml((/<description[^>]*>([\s\S]*?)<\/description>/i.exec(fragment) || [])[1]) || "";
  const fields = rawDesc
    .split(/\n|<br\s*\/?>(?:\s|$)/i)
    .map((l) => decodeXml(l.trim()))
    .filter(Boolean);

  const grab = (labelRe) => {
    for (const line of fields) {
      const m = line.match(new RegExp(`^\\s*${labelRe}\\s*:\\s*(.+)$`, "i"));
      if (m && m[1]) return cleanText(m[1], 200);
    }
    return null;
  };
  const level = grab("Level");
  const jobId = grab("Job\\ ?ID|Job\\s*ID");
  const network = grab("Job\\ ?Network|Job\\s*Network");
  const department = grab("Department\\/Office|Department");
  const station = grab("Duty Station");
  const postedRaw = grab("Posted Date");
  const deadlineRaw = grab("Deadline");

  const summaryLines = fields
    .filter((l) => !/^(Staffing Exercise)\s*:/i.test(l))
    .join("\n");

  const externalId = (link.match(/jobSearchDescription\/(\d+)/i) || [])[1] || link;
  const loc = station && !/^other$/i.test(station) ? station : null;

  return {
    external_id: externalId,
    title: cleanText(title, 300),
    company: department ? `United Nations — ${department}` : "United Nations",
    logo: null, // exact org logos handled by the org cascade; never platform favicons
    location: loc || "United Nations (global)",
    job_type: null,
    posted_date: usDate(postedRaw) || toDate((/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(fragment) || [])[1]),
    deadline: usDate(deadlineRaw),
    description: summaryLines || "Official UN Careers vacancy. Open the official page for the full job description.",
    requirements: null,
    application_instructions: `Apply via the official UN Careers page: ${link}`,
    contact_email: null,
    original_url: link,
    source_page: link,
    category: null,
    raw_source: "careersun-rss",
  };
}

export async function fetchJobs(source) {
  const cfg = source?.fetch_config || {};
  const limit = Math.max(1, Math.min(80, parseInt(cfg.limit || "40", 10) || 40));
  const offset = Math.max(0, parseInt(cfg.offset || "0", 10) || 0);
  const feedUrl = String(cfg.feedUrl || `${BASE}/jobfeed`);

  const xml = await fetchText(feedUrl, 15000);
  const fragments = [...String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const all = fragments.map((f) => parseItem(f, feedUrl)).filter(Boolean);
  const slice = all.slice(offset, offset + limit);
  const consumed = offset + slice.length;
  const done = consumed >= all.length || slice.length === 0;
  const nextOffset = done ? 0 : consumed;

  const jobs = slice.map((j) => ({
    ...j,
    original_url: j.original_url,
  }));
  if (!jobs.length && all.length && offset >= all.length) {
    try {
      jobs.progress = { offset, limit, totalFound: all.length, nextOffset: 0, done: true, listingMode: "rss", fetched: 0, ok: 0, errors: 0 };
    } catch {}
    return jobs;
  }
  try {
    jobs.progress = { offset, limit, totalFound: all.length, nextOffset, done, listingMode: "rss", fetched: slice.length, ok: jobs.length, errors: 0 };
  } catch {}
  return jobs;
}

export default { slug, fetchJobs };
