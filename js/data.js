// Habesha Careers - data layer
// Primary source: /api/jobs (Neon/Postgres, aggregated + approved direct jobs).
// Fallback: browser-local direct submissions only (no demo/sample vacancy data).

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function orgInitials(name) {
  const parts = String(name || 'Organization').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'O';
  const letters = parts.slice(0, 2).map(p => p[0].toUpperCase()).join('');
  return letters || 'O';
}

function orgLogoColor(name) {
  const palette = ['#0f766e','#1d4ed8','#7c3aed','#b45309','#be123c','#15803d','#0369a1','#4338ca','#a16207','#0f766e'];
  let h = 0; const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return palette[Math.abs(h) % palette.length];
}

function orgLogoDataUri(name) {
  const initials = orgInitials(name);
  const bg = orgLogoColor(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="18" fill="${bg}"/><text x="60" y="68" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="700" fill="#ffffff">${escHtml(initials)}</text></svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function domainFromUrl(url) {
  try { if (!url) return ''; return new URL(String(url)).hostname.replace(/^www\./i,''); } catch { return ''; }
}

const AGGREGATOR_HOST_RE = /(^|\.)geezjobs\.com$|(^|\.)ethiojobs\.net$|(^|\.)hahu\.jobs$|(^|\.)dereja\.com$|(^|\.)ezega\.com$|(^|\.)jobwebethiopia\.com$|(^|\.)ngojobs\.et$|(^|\.)workethiopia\.net$|(^|\.)srazone\.et$|(^|\.)ethiopianreporterjobs\.com$|(^|\.)reliefweb\.int$|(^|\.)unjobs\.org$|(^|\.)linkedin\.com$|(^|\.)facebook\.com$|(^|\.)twitter\.com$|(^|\.)x\.com$/i;
const ORG_DOMAIN_HINTS = [
  [/\bunicef\b/i,'unicef.org'],[/\bundp\b|united nations development programme/i,'undp.org'],[/\bwho\b|world health organization/i,'who.int'],
  [/\bwfp\b|world food programme/i,'wfp.org'],[/\bunhcr\b|un refugee agency|refugees\b/i,'unhcr.org'],[/\biom\b|international organization for migration/i,'iom.int'],
  [/\bunfpa\b/i,'unfpa.org'],[/\bun women\b|united nations entity for gender/i,'unwomen.org'],[/\bfao\b|food and agriculture organization/i,'fao.org'],
  [/\bilo\b|international labour/i,'ilo.org'],[/\bunesco\b/i,'unesco.org'],[/\bunocha\b|\bocha\b/i,'unocha.org'],[/\bunops\b/i,'unops.org'],
  [/\bworld bank\b|\bifc\b/i,'worldbank.org'],[/\busaid\b/i,'usaid.gov'],[/\bethiopian airlines\b/i,'ethiopianairlines.com'],
  [/\bethio telecom\b|ethiotelecom/i,'ethiotelecom.et'],[/\bcommercial bank of ethiopia\b|\bcbe\b/i,'combanketh.et'],
  [/\bsave the children\b/i,'savethechildren.net'],[/\bcare\b/i,'care.org'],[/\bmercy corps\b/i,'mercycorps.org'],[/\boxfam\b/i,'oxfam.org'],
  [/\bplan international\b/i,'plan-international.org'],[/\bworld vision\b/i,'worldvision.org'],[/\bgiz\b/i,'giz.de'],[/\birc\b|international rescue committee/i,'rescue.org'],
  [/\bamref\b/i,'amref.org'],[/\bpath\b/i,'path.org'],[/\bjhpiego\b/i,'jhpiego.org'],[/\bfhi 360\b|\bfhi360\b/i,'fhi360.org']
];
function orgDomainHint(company){ const n = String(company||''); for (const [re,d] of ORG_DOMAIN_HINTS) if (re.test(n)) return d; return ''; }
function addFaviconCandidates(add, domain){ if (!domain) return; add(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`); add(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`); add(`https://${domain}/favicon.ico`); }

function faviconLogo(url) {
  const d = domainFromUrl(url);
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128` : '';
}

function hostOf(url){ return domainFromUrl(url); }
function isWeakLogo(url) {
  const s = String(url || '').toLowerCase();
  if (!s) return true;
  if (/default[-_]?logo|placeholder|no[-_]?logo|avatar|sprite|blank/.test(s)) return true;
  const h = hostOf(url);
  return !!(h && AGGREGATOR_HOST_RE.test(h));
}
function logoCandidates(job) {
  const out = [];
  const seen = new Set();
  const add = (u) => { if (!u) return; const s = String(u); if (seen.has(s)) return; if (!/^https?:|^data:|^\//i.test(s)) return; seen.add(s); out.push(s); };
  const stored = job && (job.logo || job.logoUrl || job.companyLogo || job.organizationLogo);
  const raw = (job && job.raw_payload && typeof job.raw_payload === 'object') ? job.raw_payload : null;
  const rawLogo = raw ? (raw.logo || raw.company_logo || raw.organization_logo || raw.image) : null;
  const orgDomain = orgDomainHint(job && job.company);
  const strongStored = stored && !isWeakLogo(stored);
  const strongRaw = rawLogo && !isWeakLogo(rawLogo);
  // 1) Strong explicit logos, 2) org-domain hints (e.g. UNICEF), 3) direct non-aggregator host, 4) initials.
  // Never show aggregator platform icons (Ethiojobs/GeezJobs/etc.) as organization logos.
  if (strongStored) add(stored);
  if (strongRaw) add(rawLogo);
  addFaviconCandidates(add, orgDomain);
  const url = job && (job.originalUrl || job.applicationUrl || job.url);
  const d = domainFromUrl(url);
  if (d && !AGGREGATOR_HOST_RE.test(d)) addFaviconCandidates(add, d);
  add(orgLogoDataUri(job && job.company));
  return out;
}

function jobLogoSrc(job) {
  return logoCandidates(job)[0] || orgLogoDataUri(job && job.company);
}

function logoImgAttrs(job) {
  const list = logoCandidates(job);
  const first = escHtml(list[0] || orgLogoDataUri(job && job.company));
  const json = escHtml(JSON.stringify(list));
  return `src="${first}" data-logos="${json}" data-logo-idx="0" onerror="window.HabeshaUI&&window.HabeshaUI.nextLogo?window.HabeshaUI.nextLogo(this):(this.onerror=null)"`;
}

function nextLogo(img) {
  try {
    const list = JSON.parse(img.getAttribute('data-logos') || '[]');
    let i = (+img.getAttribute('data-logo-idx') || 0) + 1;
    while (i < list.length) { img.setAttribute('data-logo-idx', i); img.src = list[i]; return; i++; }
  } catch {}
  img.onerror = null;
}

window.HabeshaUI = Object.assign(window.HabeshaUI || {}, { escHtml, orgInitials, orgLogoDataUri, jobLogoSrc, faviconLogo, logoCandidates, domainFromUrl, logoImgAttrs, nextLogo });

const DEMO_SEED_TITLES = new Set([
  "Senior Software Developer","Registered Nurse","Project Manager",
  "Civil Engineer","High School Teacher - Mathematics","Financial Analyst"
]);

function isDemoJob(job) {
  if (!job) return false;
  if (job.origin === 'demo' || job.isDemo) return true;
  if (DEMO_SEED_TITLES.has(job.title) && (job.origin === 'local' || !job.origin) && /techsolutions\.et|stpauls\.et|intldev\.org|ethioconstruction\.et|boleschool\.et|cbe\.et/.test(String(job.contactEmail||''))) return true;
  return false;
}

function getLocalDirectJobs() {
  try {
    const raw = localStorage.getItem('habeshaJobs');
    const jobs = raw ? JSON.parse(raw) : [];
    const filtered = Array.isArray(jobs) ? jobs.filter(j => !isDemoJob(j)) : [];
    if (raw && filtered.length !== (Array.isArray(jobs) ? jobs.length : 0)) {
      localStorage.setItem('habeshaJobs', JSON.stringify(filtered));
    }
    return filtered;
  } catch { return []; }
}

// Remove legacy demo seed key if it only contained demo data.
try {
  const raw = localStorage.getItem('habeshaJobs');
  if (raw) {
    const jobs = JSON.parse(raw);
    if (Array.isArray(jobs) && jobs.length && jobs.every(isDemoJob)) localStorage.removeItem('habeshaJobs');
  }
} catch {}

const JobsApi = {
    cache: null,
    lastFetch: 0,
    available: null,
    lastError: null,
    async fetch(path, opts = {}) {
        const res = await fetch(path, { headers: { 'Accept': 'application/json', ...(opts.headers || {}) }, ...opts });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || data.message || 'request_failed'), { status: res.status, data });
        return data;
    },
    async refresh(params = {}) {
        try {
            const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null && v !== '')).toString();
            const data = await this.fetch(`/api/jobs${qs ? `?${qs}` : ''}`);
            if (data && data.ok && Array.isArray(data.jobs)) {
                this.cache = data.jobs;
                this.lastFetch = Date.now();
                this.available = true;
                this.lastError = null;
                // Keep only the leading slice in localStorage (quota-safe): this cache
                // powers instant first paint and fallbacks; the jobs list page fetches
                // fresh, complete data from /api/jobs with server-side pagination.
                localStorage.setItem('habeshaJobsCache', JSON.stringify({ at: this.lastFetch, jobs: data.jobs.slice(0, 300) }));
                return data;
            }
        } catch (e) {
            this.available = false;
            this.lastError = e && e.data ? e.data : { message: e.message || String(e) };
            console.warn('Jobs API unavailable; showing local direct submissions only.', e.message || e);
        }
        return null;
    },
    async getById(id) {
        try {
            const data = await this.fetch(`/api/jobs/${encodeURIComponent(id)}`);
            if (data && data.ok && data.job) return data.job;
        } catch (e) {
            if (e && e.status === 503) this.available = false;
        }
        return getJobById(id);
    },
    getCached() {
        if (Array.isArray(this.cache)) return this.cache;
        try {
            const raw = localStorage.getItem('habeshaJobsCache');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.jobs)) { this.cache = parsed.jobs; return this.cache; }
            }
        } catch {}
        return null;
    }
};
window.JobsApi = JobsApi;

function getAllJobs() {
    const cached = JobsApi.getCached();
    if (cached && cached.length) return cached;
    if (JobsApi.available === true) return []; // API reachable but no jobs
    return getLocalDirectJobs();
}

function getJobById(id) {
    const jobs = [...(JobsApi.getCached() || []), ...getLocalDirectJobs()];
    return jobs.find(job => String(job.id) === String(id));
}

function addJob(jobData) {
    const jobs = getLocalDirectJobs();
    const maxId = jobs.reduce((m,j)=>Math.max(m, Number(j.id)||0), 0);
    const newJob = {
        id: maxId + 1,
        ...jobData,
        vacancies: parseInt(jobData.vacancies) || 1,
        postedDate: new Date().toISOString().split('T')[0],
        origin: 'direct-local'
    };
    jobs.push(newJob);
    localStorage.setItem('habeshaJobs', JSON.stringify(jobs));
    return newJob;
}

function getDaysUntilDeadline(deadline) {
    if (!deadline) return null;
    const today = new Date();
    today.setHours(0,0,0,0);
    const deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime())) return null;
    const diffTime = deadlineDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

if (typeof window !== 'undefined') {
    JobsApi.refresh({ limit: 100 }).then(() => {
        window.dispatchEvent(new CustomEvent('habesha:jobs-updated'));
    }).catch(() => {
        window.dispatchEvent(new CustomEvent('habesha:jobs-updated'));
    });
}
