// Generic RSS/Atom connector for authorized/public job feeds.
// Usage: set job_sources.source_type='rss' or 'atom' and fetch_config.feedUrl (or listing_url) to a valid feed.
// Only use with feeds you are permitted to access; respect terms/robots/rate limits.

import { toDate } from "../utils.mjs";

function decodeEntities(s = "") {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function pick(tag, block) {
  const re1 = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  const re2 = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re1) || block.match(re2);
  return m ? decodeEntities(m[1]) : null;
}
function pickLink(block) {
  const atom = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  if (atom) return decodeEntities(atom[1]);
  return pick("link", block);
}

export async function fetchJobs(source) {
  const feedUrl = source?.fetch_config?.feedUrl || source?.listing_url || source?.base_url;
  if (!feedUrl) throw new Error("Generic RSS connector requires fetch_config.feedUrl or listing_url");
  const res = await fetch(feedUrl, {
    headers: {
      "User-Agent": "HabeshaCareers/1.0 (+https://habeshacareers-brown.vercel.app; authorized feed aggregation; contact site admin)",
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
    },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
  const xml = await res.text();
  const entries = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m => m[0]);
  const atom = entries.length ? [] : [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map(m => m[0]);
  const items = (entries.length ? entries : atom).slice(0, Math.max(1, Math.min(100, Number(source?.fetch_config?.limit) || 50)));

  return items.map((item) => {
    const title = pick("title", item);
    const link = pickLink(item);
    const pub = pick("pubDate", item) || pick("published", item) || pick("updated", item) || pick("dc:date", item);
    const desc = pick("description", item) || pick("summary", item) || pick("content:encoded", item) || pick("content", item) || "";
    const author = pick("author", item) || pick("dc:creator", item) || pick("source", item);
    return {
      external_id: link || null,
      title,
      company: author || source.name || null,
      location: source?.fetch_config?.defaultLocation || "Ethiopia",
      original_url: link,
      posted_date: toDate(pub),
      deadline: null,
      description: desc || `${title || "Vacancy"} from ${source.name}. See original page for full details.`,
      requirements: null,
      application_instructions: "Apply via the original/official vacancy page (organization exact link).",
      job_type: null,
      category: null,
      raw_source: "generic-feed"
    };
  }).filter(j => j.title && j.original_url);
}