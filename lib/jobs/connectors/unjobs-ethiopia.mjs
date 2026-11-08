// UN Jobs Ethiopia connector (best-effort HTML listing parsing).
// UNJobs aggregates vacancies; verify terms/robots/rate limits before enabling.
// Disabled by default in DB. This connector extracts listing links/titles from public pages.

import { toDate } from "../utils.mjs";

function decode(s='') {
  return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}

export const slug = 'unjobs-ethiopia';

export async function fetchJobs(source) {
  const base = 'https://unjobs.org';
  const url = source.listing_url || `${base}/duty_stations/ethiopia`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HabeshaCareersBot/1.0 (+https://vercel.com/habeshacareers; contact via site admin)', 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`UNJobs HTTP ${res.status}`);
  const html = await res.text();
  const jobs = [];
  // Match vacancy links like /vacancies/<id>
  const re = /<a[^>]+href="(\/vacancies\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && jobs.length < 40) {
    const href = m[1];
    const title = decode(m[2]);
    if (!title || title.length < 4) continue;
    // Attempt to find org/date in nearby text (best-effort; do not invent)
    const tail = decode(html.slice(m.index, m.index + 500));
    const updated = tail.match(/Updated:\s*(\d{4}-\d{2}-\d{2})/i);
    const org = tail.match(/\n([A-Z][^\n]{2,80})\s+Updated:/);
    jobs.push({
      external_id: href.split('/').pop(),
      title,
      company: org ? org[1].trim() : null,
      location: 'Ethiopia',
      original_url: base + href,
      posted_date: updated ? updated[1] : null,
      deadline: null,
      description: `Vacancy listing on UNJobs. ${tail.slice(0, 300)}`.slice(0, 500),
      requirements: null,
      application_instructions: 'Apply via the original vacancy page linked from UNJobs.',
      job_type: null,
      category: null,
      raw_source: 'unjobs-html'
    });
  }
  // de-dup by URL
  const seen = new Set();
  return jobs.filter(j => j.title && j.original_url && !seen.has(j.original_url) && seen.add(j.original_url));
}
