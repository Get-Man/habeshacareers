// Habesha Careers - data layer
// Primary source: /api/jobs (Neon/Postgres, aggregated + approved direct jobs).
// Fallback: browser-local direct submissions only (no demo/sample vacancy data).

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
                localStorage.setItem('habeshaJobsCache', JSON.stringify({ at: this.lastFetch, jobs: data.jobs }));
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
