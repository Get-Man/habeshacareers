// ReliefWeb connector using the public ReliefWeb API (JSON).
// Public API is intended for programmatic access; still respect rate limits/terms.
// Disabled by default in DB; enable only after review for your deployment.

import { toDate } from "../utils.mjs";

export const slug = 'reliefweb-ethiopia';

function stripHtml(s='') {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
}

function decodeEntities(s='') {
  return String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function pick(tag, block) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')) || block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

export async function fetchJobs(source) {
  const limit = Math.max(1, Math.min(100, Number(source?.fetch_config?.limit) || 50));
  const ua = 'HabeshaCareers/1.0 (+https://habeshacareers-brown.vercel.app; job aggregation; contact site admin)';
  const errors = [];

  // 1) ReliefWeb API v1 (public, JSON). Try compliant GET format.
  try {
    const q = new URLSearchParams({
      appname: 'habeshacareers-brown',
      profile: 'list',
      preset: 'latest',
      limit: String(limit),
      'filter[field]': 'country',
      'filter[value]': 'Ethiopia',
      'fields[include][0]': 'title',
      'fields[include][1]': 'url',
      'fields[include][2]': 'url_alias',
      'fields[include][3]': 'date',
      'fields[include][4]': 'source',
      'fields[include][5]': 'country',
      'fields[include][6]': 'city',
      'fields[include][7]': 'body',
      'fields[include][8]': 'how_to_apply',
      'fields[include][9]': 'experience',
      'fields[include][10]': 'career_categories',
      'fields[include][11]': 'type',
    });
    const res = await fetch(`https://api.reliefweb.int/v1/jobs?${q}`, { headers: { 'Accept': 'application/json', 'User-Agent': ua } });
    if (res.ok) {
      var data = await res.json();
    } else {
      errors.push(`api-get:${res.status}`);
      // POST fallback
      const body = { appname: 'habeshacareers-brown', profile: 'list', preset: 'latest', limit, filter: { field: 'country', value: 'Ethiopia' }, fields: { include: ['title','url','url_alias','date','source','country','city','body','how_to_apply','experience','career_categories','type'] } };
      const res2 = await fetch('https://api.reliefweb.int/v1/jobs', { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify(body) });
      if (res2.ok) var data = await res2.json(); else errors.push(`api-post:${res2.status}`);
    }
  } catch (e) { errors.push(`api:${e.message || e}`); }

  if (data && Array.isArray(data.data)) {
    const items = data.data;
    return items.map((item) => {
      const f = item.fields || {};
      const url = f.url_alias ? (String(f.url_alias).startsWith('http') ? f.url_alias : `https://reliefweb.int${f.url_alias}`) : (f.url || item.href || null);
      const sources = Array.isArray(f.source) ? f.source.map(s => s?.name || s?.shortname).filter(Boolean) : [];
      const countries = Array.isArray(f.country) ? f.country.map(c => c?.name).filter(Boolean) : [];
      const cities = Array.isArray(f.city) ? f.city.map(c => c?.name).filter(Boolean) : [];
      const categories = Array.isArray(f.career_categories) ? f.career_categories.map(c => c?.name).filter(Boolean) : [];
      const types = Array.isArray(f.type) ? f.type.map(t => t?.name).filter(Boolean) : [];
      const body = f.body || '';
      const description = typeof body === 'string' ? stripHtml(body) : stripHtml(body?.['html'] || body?.['markdown'] || JSON.stringify(body));
      const how = typeof f.how_to_apply === 'string' ? stripHtml(f.how_to_apply) : stripHtml(f.how_to_apply?.['html'] || f.how_to_apply?.['markdown'] || '');
      const experience = Array.isArray(f.experience) ? f.experience.map(e => e?.name).filter(Boolean).join(', ') : (f.experience?.name || null);
      return {
        external_id: item.id ? String(item.id) : (url && /\/job\/(\d+)/.test(url) ? url.match(/\/job\/(\d+)/)[1] : null),
        title: f.title || null,
        company: sources[0] || null,
        location: cities[0] || countries[0] || 'Ethiopia',
        region_city: cities[0] || countries[0] || 'Ethiopia',
        original_url: url,
        posted_date: toDate(f.date?.created),
        deadline: toDate(f.date?.closing),
        description: description || 'See original ReliefWeb vacancy for full details.',
        requirements: null,
        application_instructions: how || 'Apply via the original ReliefWeb vacancy page (organization exact link provided).',
        job_type: types[0] || null,
        experience: experience || null,
        category: categories[0] || null,
        raw_source: 'reliefweb-api'
      };
    }).filter(j => j.title && j.original_url);
  }

  // 2) RSS fallback (best-effort; may return 406 depending on client behavior)
  try {
    const feedUrl = 'https://reliefweb.int/jobs/rss.xml?search=country.name%3A%22Ethiopia%22';
    const res = await fetch(feedUrl, { headers: { 'User-Agent': ua, 'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' }, redirect: 'follow' });
    if (res.ok) {
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]).slice(0, limit);
      const mapped = items.map((item) => {
        const title = pick('title', item);
        const link = pick('link', item);
        const pub = pick('pubDate', item);
        const desc = pick('description', item) || '';
        const org = (desc.match(/Organization\s*:\s*([^\n\r\.]+?)(?:\s+Posted|\s+Closing|\s+Country|$)/i) || desc.match(/Source\s*:\s*([^\n\r\.]+)/i) || [])[1]?.trim() || null;
        const closing = (desc.match(/Closing date\s*:\s*([0-9]{1,2}\s+\w+\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i) || [])[1] || null;
        const loc = (desc.match(/Country\s*:\s*([^\n\r\.]+)/i) || [])[1]?.trim() || 'Ethiopia';
        return { external_id: link && /\/job\/(\d+)/.test(link) ? link.match(/\/job\/(\d+)/)[1] : null, title, company: org, location: loc, original_url: link, posted_date: toDate(pub), deadline: toDate(closing), description: desc, requirements: null, application_instructions: 'Apply via the original ReliefWeb vacancy page (organization exact link provided).', job_type: null, category: null, raw_source: 'reliefweb-rss' };
      }).filter(j => j.title && j.original_url);
      if (mapped.length) return mapped;
    } else errors.push(`rss:${res.status}`);
  } catch (e) { errors.push(`rss:${e.message || e}`); }

  throw new Error(`ReliefWeb fetch failed (${errors.join(', ') || 'unknown'})`);

  const items = Array.isArray(data?.data) ? data.data : [];
  return items.map((item) => {
    const f = item.fields || {};
    const url = f.url_alias ? (String(f.url_alias).startsWith('http') ? f.url_alias : `https://reliefweb.int${f.url_alias}`) : (f.url || item.href || null);
    const sources = Array.isArray(f.source) ? f.source.map(s => s?.name || s?.shortname).filter(Boolean) : [];
    const countries = Array.isArray(f.country) ? f.country.map(c => c?.name).filter(Boolean) : [];
    const cities = Array.isArray(f.city) ? f.city.map(c => c?.name).filter(Boolean) : [];
    const categories = Array.isArray(f.career_categories) ? f.career_categories.map(c => c?.name).filter(Boolean) : [];
    const types = Array.isArray(f.type) ? f.type.map(t => t?.name).filter(Boolean) : [];
    const body = f.body || '';
    const description = stripHtml(body);
    const how = stripHtml(f.how_to_apply || '');
    const experience = Array.isArray(f.experience) ? f.experience.map(e => e?.name).filter(Boolean).join(', ') : (f.experience?.name || null);
    return {
      external_id: item.id ? String(item.id) : (url && /\/job\/(\d+)/.test(url) ? url.match(/\/job\/(\d+)/)[1] : null),
      title: f.title || null,
      company: sources[0] || null,
      location: cities[0] || countries[0] || 'Ethiopia',
      region_city: cities[0] || countries[0] || 'Ethiopia',
      original_url: url,
      posted_date: toDate(f.date?.created),
      deadline: toDate(f.date?.closing),
      description: description || 'See original ReliefWeb vacancy for full details.',
      requirements: null,
      application_instructions: how || 'Apply via the original ReliefWeb vacancy page (organization exact link provided).',
      job_type: types[0] || null,
      experience: experience || null,
      category: categories[0] || null,
      raw_source: 'reliefweb-api'
    };
  }).filter(j => j.title && j.original_url);
}
