// UN in Ethiopia jobs page (best-effort HTML parsing).
// Public page links to UN agency vacancy pages; verify terms/robots/rate limits before enabling.

import { toDate } from "../utils.mjs";

function decode(s='') {
  return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}

export const slug = 'un-ethiopia';

export async function fetchJobs(source) {
  const url = source.listing_url || 'https://ethiopia.un.org/en/jobs';
  const res = await fetch(url, { headers: { 'User-Agent': 'HabeshaCareersBot/1.0 (+https://vercel.com/habeshacareers; contact via site admin)', 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`UN Ethiopia HTTP ${res.status}`);
  const html = await res.text();
  const jobs = [];
  // Capture job links (often to jobs.unicef.org, careers.un.org, etc.) and surrounding text.
  const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]*(?:Driver|Specialist|Chief|Officer|Consultant|Coordinator|Manager|Assistant|Analyst|Associate|Advisor|Representative|Intern|Programme|Program|WASH|Climate|Field)[^<]*)<\/a>[\s\S]{0,500}?Closing date[\s\S]{0,40}?([0-9]{1,2}\s+\w+\s+[0-9]{4})?[\s\S]{0,120}?(UNICEF|UNDP|UNHCR|WFP|WHO|FAO|UNFPA|IOM|UN Women|OCHA|ILO|UNECA|UNESCO)[^<]*/gi;
  let m;
  while ((m = re.exec(html)) && jobs.length < 60) {
    const link = m[1];
    const title = decode(m[2]);
    if (!title || /read more|learn more|view all/i.test(title)) continue;
    const closing = m[3] || null;
    const agency = (m[4] || '').trim() || null;
    jobs.push({
      external_id: link,
      title,
      company: agency,
      location: 'Ethiopia',
      original_url: link,
      posted_date: null,
      deadline: toDate(closing),
      description: `${title}${agency ? ` — ${agency}` : ''}. Vacancy listed on UN in Ethiopia; see original application page for full details.`,
      requirements: null,
      application_instructions: 'Apply via the original UN/agency vacancy page.',
      job_type: null,
      category: null,
      raw_source: 'un-ethiopia-html'
    });
  }
  const seen = new Set();
  return jobs.filter(j => j.title && j.original_url && !seen.has(j.original_url) && seen.add(j.original_url));
}
