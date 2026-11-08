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
  const attempts = [
    { 'User-Agent': 'HabeshaCareers/1.0 (+https://habeshacareers-brown.vercel.app; contact site admin)', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
    { 'User-Agent': 'HabeshaCareers/1.0 (+https://habeshacareers-brown.vercel.app; contact site admin)' },
    { 'Accept': 'application/xml' },
  ];
  let xml = '';
  let lastStatus = 0;
  for (const headers of attempts) {
    const res = await fetch(feedUrl, { headers, redirect: 'follow' });
    lastStatus = res.status;
    if (res.ok) { xml = await res.text(); break; }
  }
  if (!xml) throw new Error(`ReliefWeb RSS HTTP ${lastStatus}`);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]).slice(0, 50);
  return items.map((item) => {
    const title = pick('title', item);
    const link = pick('link', item) || pickAttr('guid', 'isPermaLink', item);
    const pub = pick('pubDate', item);
    const desc = pick('description', item) || '';
    const org = (desc.match(/Organization\s*:\s*([^\n\r\.]+?)(?:\s+Posted|\s+Closing|\s+Country|$)/i) || desc.match(/Source\s*:\s*([^\n\r\.]+)/i) || [])[1]?.trim() || null;
    const closing = (desc.match(/Closing date\s*:\s*([0-9]{1,2}\s+\w+\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i) || [])[1] || null;
    const loc = (desc.match(/Country\s*:\s*([^\n\r\.]+)/i) || [])[1]?.trim() || 'Ethiopia';
    return {
      external_id: link && /\/job\/(\d+)/.test(link) ? link.match(/\/job\/(\d+)/)[1] : null,
      title,
      company: org || null,
      location: loc,
      original_url: link,
      posted_date: toDate(pub),
      deadline: toDate(closing),
      description: desc,
      requirements: null,
      application_instructions: 'Apply via the original ReliefWeb vacancy page.',
      job_type: null,
      category: null,
      raw_source: 'reliefweb-rss'
    };
  }).filter(j => j.title && j.original_url);
}
