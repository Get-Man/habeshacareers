// ReliefWeb connector (RSS feed). Public RSS is exposed on ReliefWeb job pages.
// Disabled by default in DB; enable only after verifying terms/rate limits for your deployment.
// This connector fetches a small batch and maps basic fields.

import { toDate } from "../utils.mjs";

function decodeEntities(s='') {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}

function pick(tag, block) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')) || block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}
function pickAttr(tag, attr, block) {
  const m = block.match(new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']+)["']`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

export const slug = 'reliefweb-ethiopia';

export async function fetchJobs(source) {
  const feedUrl = source.listing_url?.includes('rss.xml') ? source.listing_url : 'https://reliefweb.int/jobs/rss.xml?search=country.name%3A%22Ethiopia%22';
  const res = await fetch(feedUrl, { headers: { 'User-Agent': 'HabeshaCareersBot/1.0 (+https://vercel.com/habeshacareers; contact via site admin)' , 'Accept': 'application/rss+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`ReliefWeb RSS HTTP ${res.status}`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]).slice(0, 50);
  return items.map((item) => {
    const title = pick('title', item);
    const link = pick('link', item) || pickAttr('guid', 'isPermaLink', item);
    const pub = pick('pubDate', item);
    const desc = pick('description', item);
    // Try to parse org from title patterns "Job Title - Org" not reliable; leave unknown.
    return {
      external_id: link ? link.replace(/.*\/job\/(\d+)\/.*/, '$1') : null,
      title,
      company: null, // not reliably present in RSS; do not invent
      location: 'Ethiopia',
      original_url: link,
      posted_date: toDate(pub),
      deadline: null,
      description: desc,
      requirements: null,
      application_instructions: 'Apply via the original ReliefWeb vacancy page.',
      job_type: null,
      category: null,
      raw_source: 'reliefweb-rss'
    };
  }).filter(j => j.title && j.original_url);
}
