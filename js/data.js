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
  const palette = ['#0F2C59','#1B9C85','#1D4ED8','#7C3AED','#B45309','#BE123C','#15803D','#0369A1','#4338CA','#A16207','#0E7490','#9D174D'];
  let h = 0; const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return palette[Math.abs(h) % palette.length];
}

// A professionally designed monogram placeholder used when no reliable
// organisation logo exists. Never an unrelated logo.
function orgLogoDataUri(name) {
  const label = String(name || '').trim();
  const initials = orgInitials(label);
  const bg = orgLogoColor(label);
  const bg2 = shade(bg, -18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="${escHtml(label || 'Organization')}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0%" stop-color="${bg}"/><stop offset="100%" stop-color="${bg2}"/></linearGradient></defs>`
    + `<rect width="120" height="120" rx="20" fill="url(#g)"/>`
    + `<rect x="0.75" y="0.75" width="118.5" height="118.5" rx="19.25" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>`
    + `<text x="60" y="60" text-anchor="middle" dominant-baseline="central" font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="700" letter-spacing="1" fill="#ffffff">${escHtml(initials)}</text>`
    + `</svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function shade(hex, percent) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '#0F2C59'));
  if (!m) return hex;
  const shift = (v) => Math.max(0, Math.min(255, Math.round(parseInt(v, 16) * (1 + percent / 100))));
  return '#' + [shift(m[1]), shift(m[2]), shift(m[3])].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function domainFromUrl(url) {
  try { if (!url) return ''; return new URL(String(url)).hostname.replace(/^www\./i,''); } catch { return ''; }
}

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
function looksLikeVacancyPoster(url) {
  // Vacancy advertisement creatives/posters/banners/flyers are not org logos.
  const s = String(url || '').toLowerCase();
  if (!s) return true;
  return /(?:vacancy|job[-_ ]?poster|advert(?:isement)?|flyer|job[-_ ]?ad|hiring[-_ ]?banner|recruit(?:ment)?[-_ ]?(?:poster|banner|ad)|position[-_ ]?ad|now[-_ ]?hiring)/.test(s);
}
function isWeakLogo(url) {
  const s = String(url || '').toLowerCase();
  if (!s) return true;
  if (/default[-_]?logo|placeholder|no[-_]?logo|avatar|sprite|blank/.test(s)) return true;
  if (looksLikeVacancyPoster(s)) return true;
  return false;
}
function logoCandidates(job) {
  const out = [];
  const seen = new Set();
  const add = (u) => { if (!u) return; const s = String(u); if (seen.has(s)) return; if (!/^https?:|^data:|^\//i.test(s)) return; seen.add(s); out.push(s); };
  const stored = job && (job.organizationLogo || job.logo || job.logoUrl || job.companyLogo);
  const orgDomain = job && (job.organizationDomain || job.employerWebsiteDomain || '');
  const strongStored = stored && !isWeakLogo(stored);
  // 1) The verified employer logo (server-side, official organisation asset).
  if (strongStored) add(stored);
  // 2) The organisation's own favicon, keyed on its own verified domain.
  addFaviconCandidates(add, orgDomain);
  // 3) Well-known organisation domains.
  addFaviconCandidates(add, orgDomainHint(job && job.company));
  // 4) Professional initials placeholder — never an unrelated logo.
  add(orgLogoDataUri(job && job.company));
  return out;
}

// ---------------------------------------------------------------------------
// Application destination
//
// The API already classifies the destination for every vacancy. This is the
// same rule applied on the client for jobs that come from the local cache,
// so the Apply button always says the same thing and always has a target.
// ---------------------------------------------------------------------------
const ATS_HOSTS = [
  'greenhouse.io', 'lever.co', 'workday.com', 'myworkdayjobs.com', 'bamboohr.com',
  'smartrecruiters.com', 'icims.com', 'taleo.net', 'oraclecloud.com', 'successfactors.com',
  'sapsf.com', 'jobvite.com', 'recruitee.com', 'personio.com', 'personio.de',
  'zohorecruit.com', 'breezy.hr', 'ashbyhq.com', 'teamtailor.com', 'applytojob.com',
  'workable.com', 'smartrecruiters.net', 'talent.com', 'hire.com', 'jobs.smartrecruiters.com'
];
const GENERIC_HOSTS = [
  'forms.gle', 'docs.google.com', 'typeform.com', 'jotform.com', 'shorturl.at',
  'tinyurl.com', 'bit.ly', 'rb.gy', 'linktr.ee', 't.me', 'wa.me', 'forms.office.com'
];

function _hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function _endsWith(host, domain) {
  const h = String(host || ''), d = String(domain || '');
  return !!h && !!d && (h === d || h.endsWith('.' + d));
}
function _isAtsHost(host) { return ATS_HOSTS.some((d) => _endsWith(host, d)); }
function _isGenericHost(host) { return GENERIC_HOSTS.some((d) => _endsWith(host, d)); }

const APPLY_META = {
  official_employer: { badge: 'Official employer link', badgeClass: 'badge-official', note: 'Opens the employer’s own application page.', official: true },
  official_ats:      { badge: 'Official employer link', badgeClass: 'badge-official', note: 'Opens the employer’s own recruitment portal.', official: true },
  third_party:       { badge: 'Third-party application', badgeClass: 'badge-third-party', note: 'This vacancy was published on another platform. The link opens that application form.', official: false },
  email:             { badge: 'Application email', badgeClass: 'badge-neutral', note: 'Sends your application directly to the employer.', official: true },
  employer_careers:  { badge: 'Official careers page', badgeClass: 'badge-official', note: 'No direct application link was published, so this opens the employer’s own careers page.', official: true },
  none:              { badge: '', badgeClass: '', note: 'Contact details and application instructions are listed in the vacancy.', official: false }
};

/**
 * Where the "Apply Now" button goes, and how that destination is described.
 */
function applyInfo(job) {
  if (job && job.apply && job.apply.url) {
    const meta = APPLY_META[job.apply.kind] || APPLY_META.none;
    return Object.assign({}, job.apply, {
      badge: job.apply.badge || meta.badge,
      badgeClass: job.apply.badgeClass || meta.badgeClass,
      note: job.apply.note || meta.note
    });
  }
  const email = job && (job.applicationEmail || job.contactEmail);
  const url = job && job.applyUrl;
  const domain = job && job.organizationDomain;
  if (url && /^https?:/i.test(url)) {
    const host = _hostOf(url);
    let kind = 'third_party';
    if (domain && (_endsWith(host, domain) || _endsWith(host, domain.replace(/^www\./, '')))) kind = 'official_employer';
    else if (_isAtsHost(host)) kind = 'official_ats';
    else if (_isGenericHost(host)) kind = 'third_party';
    const meta = APPLY_META[kind];
    return { kind, url, badge: meta.badge, badgeClass: meta.badgeClass, note: meta.note, official: meta.official, verified: !!(job && job.applyUrlVerified) };
  }
  if (email && /@/.test(email)) {
    const subject = encodeURIComponent('Application for ' + String((job && job.title) || 'this position'));
    const meta = APPLY_META.email;
    return { kind: 'email', url: 'mailto:' + email + '?subject=' + subject, badge: meta.badge, badgeClass: meta.badgeClass, note: meta.note, official: meta.official, verified: false };
  }
  const careers = job && (job.organizationCareersUrl || job.organizationWebsite);
  if (careers) {
    const meta = APPLY_META.employer_careers;
    return { kind: 'employer_careers', url: careers, badge: meta.badge, badgeClass: meta.badgeClass, note: meta.note, official: meta.official, verified: false };
  }
  const meta = APPLY_META.none;
  return { kind: 'none', url: null, badge: meta.badge, badgeClass: meta.badgeClass, note: meta.note, official: false, verified: false };
}

/**
 * The Apply Now button, with the badge that says where it goes.
 */
function applyButtonHtml(job, extraClass) {
  const info = applyInfo(job);
  const cls = ('jd-apply-btn' + (extraClass ? ' ' + extraClass : '')).trim();
  if (!info.url) {
    return '<div class="jd-apply-unavailable">Application details are listed in the vacancy below.</div>' +
           '<a class="' + cls + '" href="jobs.html">Browse similar jobs</a>';
  }
  const external = /^https?:/i.test(info.url);
  const attrs = external ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
  const badge = info.badge ? '<span class="jd-apply-origin"><span class="badge ' + escHtml(info.badgeClass || 'badge-neutral') + '">' + escHtml(info.badge) + '</span></span>' : '';
  const note = info.note ? '<p class="jd-apply-note">' + escHtml(info.note) + '</p>' : '';
  return badge + '<a class="' + cls + '" href="' + escHtml(info.url) + '"' + attrs + '>Apply Now</a>' + note;
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

window.HabeshaUI = Object.assign(window.HabeshaUI || {}, { escHtml, orgInitials, orgLogoDataUri, jobLogoSrc, faviconLogo, logoCandidates, domainFromUrl, logoImgAttrs, nextLogo, applyInfo, applyButtonHtml, orgDomainHint });

/**
 * Identify a vacancy that came from the retired demo seed.
 *
 * The demo seed was removed from the application long ago, but browsers that
 * visited the site before then can still have it cached in localStorage.
 * Those entries are dropped on sight so a demo vacancy can never be shown or
 * counted as a real one.
 */
const DEMO_SEED_TITLES = new Set([
  "Senior Software Developer", "Registered Nurse", "Project Manager",
  "Civil Engineer", "High School Teacher - Mathematics", "Financial Analyst"
]);
const DEMO_SEED_DOMAINS = /techsolutions\.et|stpauls\.et|intldev\.org|ethioconstruction\.et|boleschool\.et|cbe\.et/i;

function isDemoJob(job) {
  if (!job) return false;
  if (job.origin === 'demo' || job.isDemo) return true;
  if (job.origin === 'local' && DEMO_SEED_DOMAINS.test(String(job.contactEmail || ''))) return true;
  if (DEMO_SEED_TITLES.has(job.title) && DEMO_SEED_DOMAINS.test(String(job.contactEmail || ''))) return true;
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
