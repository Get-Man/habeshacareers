// ReliefWeb connector using the public ReliefWeb API (JSON).
// Public API is intended for programmatic access; still respect rate limits/terms.
// Disabled by default in DB; enable only after review for your deployment.

import { toDate } from "../utils.mjs";

export const slug = 'reliefweb-ethiopia';

function stripHtml(s='') {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
}

export async function fetchJobs(source) {
  const limit = Math.max(1, Math.min(100, Number(source?.fetch_config?.limit) || 50));
  const endpoint = 'https://api.reliefweb.int/v1/jobs?appname=habeshacareers-aggregator';
  const body = {
    appname: 'habeshacareers-aggregator',
    profile: 'list',
    preset: 'latest',
    limit,
    filter: { field: 'country.name', value: 'Ethiopia' },
    fields: {
      include: ['title', 'url', 'url_alias', 'date', 'source', 'country', 'city', 'body', 'how_to_apply', 'experience', 'career_categories', 'type']
    }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'HabeshaCareers/1.0 (+https://habeshacareers-brown.vercel.app; job aggregation; contact site admin)'
    },
    body: JSON.stringify(body),
    redirect: 'follow'
  });
  if (!res.ok) {
    // Fallback to GET form used by API in some cases
    const getUrl = `https://api.reliefweb.int/v1/jobs?appname=habeshacareers-aggregator&profile=list&preset=latest&limit=${limit}&filter[field]=country.name&filter[value]=Ethiopia&fields[include][]=title&fields[include][]=url&fields[include][]=url_alias&fields[include][]=date&fields[include][]=source&fields[include][]=country&fields[include][]=city&fields[include][]=body&fields[include][]=how_to_apply&fields[include][]=experience&fields[include][]=career_categories&fields[include][]=type`;
    const res2 = await fetch(getUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'HabeshaCareers/1.0 (+https://habeshacareers-brown.vercel.app; contact site admin)' } });
    if (!res2.ok) throw new Error(`ReliefWeb API HTTP ${res.status}/${res2.status}`);
    var data = await res2.json();
  } else {
    var data = await res.json();
  }

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
