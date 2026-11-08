// Habesha Careers - data layer
// Integrates with /api/jobs when backend+DB are configured; falls back to local sample/localStorage data.
// Existing synchronous helpers are preserved for compatibility.

const jobsData = [
    {
        id: 1,
        title: "Senior Software Developer",
        company: "Tech Solutions Ethiopia",
        logo: "images/companies/tech-solutions.png",
        category: "Information Technology",
        location: "Addis Ababa",
        type: "Full-time / Permanent",
        vacancies: 3,
        postedDate: "2025-11-15",
        deadline: "2025-12-15",
        description: "We are seeking an experienced software developer to join our growing team. The ideal candidate will have strong programming skills and experience with modern web technologies.",
        requirements: "- Bachelor's degree in Computer Science or related field\n- 5+ years of experience in software development\n- Proficiency in JavaScript, Python, or Java\n- Experience with databases and APIs\n- Strong problem-solving skills",
        contactEmail: "hr@techsolutions.et",
        origin: "local"
    },
    {
        id: 2,
        title: "Registered Nurse",
        company: "St. Paul's Hospital",
        logo: "images/companies/st-pauls.png",
        category: "Healthcare and Medical",
        location: "Addis Ababa",
        type: "Full-time / Permanent",
        vacancies: 5,
        postedDate: "2025-11-16",
        deadline: "2025-12-10",
        description: "St. Paul's Hospital is looking for a compassionate and skilled registered nurse to provide quality patient care.",
        requirements: "- Bachelor's degree in Nursing\n- Valid nursing license\n- 2+ years of clinical experience\n- Excellent communication skills\n- Ability to work in a fast-paced environment",
        contactEmail: "recruitment@stpauls.et",
        origin: "local"
    },
    {
        id: 3,
        title: "Project Manager",
        company: "International Development Organization",
        logo: "images/companies/intl-dev.png",
        category: "Business and Management",
        location: "Addis Ababa",
        type: "Contract / Fixed-term",
        vacancies: 2,
        postedDate: "2025-11-17",
        deadline: "2025-12-20",
        description: "We are seeking a project manager to oversee community development initiatives across Ethiopia.",
        requirements: "- Master's degree in Business Management or related field\n- 5+ years of project management experience\n- Experience working with international organizations\n- Strong leadership and communication skills\n- Fluency in English and Amharic",
        contactEmail: "jobs@intldev.org",
        origin: "local"
    },
    {
        id: 4,
        title: "Civil Engineer",
        company: "Ethiopian Construction Corp",
        logo: "images/companies/construction-corp.png",
        category: "Engineering and Technical",
        location: "Dire Dawa",
        type: "Full-time / Permanent",
        vacancies: 4,
        postedDate: "2025-11-14",
        deadline: "2025-12-05",
        description: "Looking for a civil engineer to work on infrastructure projects in the Dire Dawa region.",
        requirements: "- Bachelor's degree in Civil Engineering\n- 3+ years of experience\n- Knowledge of construction standards\n- AutoCAD proficiency\n- Valid engineering license",
        contactEmail: "hr@ethioconstruction.et",
        origin: "local"
    },
    {
        id: 5,
        title: "High School Teacher - Mathematics",
        company: "Bole International School",
        logo: "images/companies/bole-school.png",
        category: "Education and Training",
        location: "Addis Ababa",
        type: "Full-time / Permanent",
        vacancies: 2,
        postedDate: "2025-11-18",
        deadline: "2025-12-25",
        description: "We are looking for an enthusiastic mathematics teacher to join our academic team.",
        requirements: "- Bachelor's degree in Mathematics or Education\n- Teaching certification\n- 2+ years of teaching experience\n- Strong classroom management skills\n- Passion for education",
        contactEmail: "hr@boleschool.et",
        origin: "local"
    },
    {
        id: 6,
        title: "Financial Analyst",
        company: "Commercial Bank of Ethiopia",
        logo: "images/companies/cbe.png",
        category: "Finance and Accounting",
        location: "Addis Ababa",
        type: "Full-time / Permanent",
        vacancies: 1,
        postedDate: "2025-11-13",
        deadline: "2025-12-08",
        description: "Seeking a financial analyst to support our corporate banking division.",
        requirements: "- Bachelor's degree in Finance or Accounting\n- 3+ years of financial analysis experience\n- Strong Excel and analytical skills\n- Knowledge of banking regulations\n- CFA certification preferred",
        contactEmail: "careers@cbe.et",
        origin: "local"
    }
];

if (!localStorage.getItem('habeshaJobs')) {
    localStorage.setItem('habeshaJobs', JSON.stringify(jobsData));
}

const JobsApi = {
    cache: null,
    lastFetch: 0,
    available: null,
    async fetch(path, opts = {}) {
        const res = await fetch(path, { headers: { 'Accept': 'application/json', ...(opts.headers || {}) }, ...opts });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || 'request_failed'), { status: res.status, data });
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
                localStorage.setItem('habeshaJobsCache', JSON.stringify({ at: this.lastFetch, jobs: data.jobs }));
                return data;
            }
        } catch (e) {
            if (e && e.status === 503) this.available = false;
            console.warn('Jobs API unavailable, using local data.', e.message || e);
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
    const jobs = localStorage.getItem('habeshaJobs');
    return jobs ? JSON.parse(jobs) : jobsData;
}

function getJobById(id) {
    const jobs = getAllJobs();
    return jobs.find(job => String(job.id) === String(id));
}

function addJob(jobData) {
    const jobs = JSON.parse(localStorage.getItem('habeshaJobs') || '[]');
    const base = jobs.length ? jobs : jobsData;
    const newJob = {
        id: base.length > 0 ? Math.max(...base.map(j => Number(j.id) || 0)) + 1 : 1,
        ...jobData,
        vacancies: parseInt(jobData.vacancies) || 1,
        postedDate: new Date().toISOString().split('T')[0],
        origin: 'direct-local'
    };
    base.push(newJob);
    localStorage.setItem('habeshaJobs', JSON.stringify(base));
    // Best-effort API submission (direct employer flow handled separately)
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

// Kick off background refresh; pages can await JobsApi.refresh() for freshest data.
if (typeof window !== 'undefined') {
    JobsApi.refresh({ limit: 100 }).then(() => {
        window.dispatchEvent(new CustomEvent('habesha:jobs-updated'));
    }).catch(() => {});
}
