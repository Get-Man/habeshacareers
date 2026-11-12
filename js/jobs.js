// Habesha Careers - jobs list page.
// The full catalog lives in the /api/jobs database (which grows with every sync),
// so this page fetches ONE server-side-filtered, paginated chunk at a time
// (page + all filter params sent to the API) instead of loading the whole
// catalog into the browser. Same cards, same filters, same pagination UI.
let serverJobs = [];
const jobsPerPage = 20; // rows per API page
const jobsState = { page: 1, total: 0 };

function _esc(s){ return (window.HabeshaUI && window.HabeshaUI.escHtml) ? window.HabeshaUI.escHtml(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _logo(job){ return (window.HabeshaUI && window.HabeshaUI.jobLogoSrc) ? window.HabeshaUI.jobLogoSrc(job) : (job && job.logo) || (window.HabeshaUI && window.HabeshaUI.orgLogoDataUri ? window.HabeshaUI.orgLogoDataUri(job && job.company) : ''); }
function _fallbackLogo(job){ return (window.HabeshaUI && window.HabeshaUI.orgLogoDataUri) ? window.HabeshaUI.orgLogoDataUri(job && job.company) : ''; }
function getDaysUntilDeadline(deadline) {
    if (!deadline) return null;
    const today = new Date();
    today.setHours(0,0,0,0);
    const deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime())) return null;
    const diffTime = deadlineDate - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

document.addEventListener('DOMContentLoaded', function() {
    const filtersToggle = document.getElementById('filtersToggle');
    const jobsLayout = document.getElementById('jobsLayout');
    if (filtersToggle && jobsLayout) {
        filtersToggle.addEventListener('click', function() {
            const open = jobsLayout.classList.toggle('filters-open');
            filtersToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            filtersToggle.textContent = open ? 'Hide Categories & Filters' : 'Categories & Filters';
        });
    }

    // Check for filters from home page
    const savedSearch = localStorage.getItem('searchTerm');
    const savedCategory = localStorage.getItem('filterCategory');
    if (savedSearch) {
        document.getElementById('jobSearch').value = savedSearch;
        localStorage.removeItem('searchTerm');
    }
    if (savedCategory) {
        document.getElementById('categoryFilter').value = savedCategory;
        localStorage.removeItem('filterCategory');
    }

    applyFilters();
});

function orderedSortFilter() {
    // "Deadline Soon" ignores rows without a deadline on the server (nulls last).
    const sort = document.getElementById('sortFilter').value;
    return sort === 'deadline' ? 'deadline' : '';
}

function paramsFromFilters() {
    const category = document.getElementById('categoryFilter').value;
    const location = document.getElementById('locationFilter').value;
    const type = document.getElementById('typeFilter').value;
    const search = document.getElementById('jobSearch').value.trim();
    const params = new URLSearchParams({
        page: String(jobsState.page),
        limit: String(jobsPerPage),
        brief: '1'
    });
    if (category) params.set('category', category);
    if (location) params.set('location', location);
    if (type) params.set('type', type);
    const sort = orderedSortFilter();
    if (sort) params.set('sort', sort);
    if (search) params.set('q', search);
    return params;
}

async function applyFilters() {
    const container = document.getElementById('jobsList');
    try {
        const data = await window.JobsApi.fetch(`/api/jobs?${paramsFromFilters().toString()}`);
        if (data && data.ok && Array.isArray(data.jobs)) {
            serverJobs = data.jobs;
            jobsState.total = (typeof data.total === 'number') ? data.total : serverJobs.length;
            displayJobs(serverJobs);
            return;
        }
        throw new Error((data && (data.error || data.message)) || 'request_failed');
    } catch (e) {
        if (e && e.data && e.data.error === 'db_unavailable') {
            serverJobs = [];
            jobsState.total = 0;
            container.innerHTML = '<p>Live job database is not configured yet. Configure Neon <code>DATABASE_URL</code> and sync real sources from <a href="admin.html">Admin</a>.</p>';
            document.getElementById('jobsCount').textContent = '';
            document.getElementById('pagination').innerHTML = '';
            return;
        }
        const cached = getAllJobs();
        if (cached.length) {
            serverJobs = cached;
            jobsState.total = cached.length;
            displayJobs(cached);
        } else {
            serverJobs = [];
            jobsState.total = 0;
            container.innerHTML = '<p>Could not load jobs right now. Please try again.</p>';
            document.getElementById('jobsCount').textContent = '';
            document.getElementById('pagination').innerHTML = '';
        }
    }
}

function displayJobs(jobs) {
    const container = document.getElementById('jobsList');
    const countElement = document.getElementById('jobsCount');

    countElement.textContent = `${jobsState.total} job(s) found`;

    if (jobs.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No jobs match your criteria</h3><p>Try a different keyword, category or location.</p></div>`;
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    container.innerHTML = jobs.map(job => {
        const daysLeft = getDaysUntilDeadline(job.deadline);
        const urgent = daysLeft != null && daysLeft <= 7;
        const fallback = _fallbackLogo(job);
        const logos = (window.HabeshaUI && window.HabeshaUI.logoCandidates) ? window.HabeshaUI.logoCandidates(job) : [fallback];
        const logo = logos[0] || fallback;
        const employer = job.organizationName || job.company || 'Organization not verified';
        const verified = job.organizationVerified ? ' <span class="badge badge-verified">✓ Verified</span>' : '';
        const path = job.publicPath || ('job-details.html?id=' + encodeURIComponent(job.id));
        const apply = (window.HabeshaUI && window.HabeshaUI.applyInfo) ? window.HabeshaUI.applyInfo(job) : null;
        const applyHtml = apply && apply.url
            ? `<a href="${_esc(apply.url)}" class="btn btn-primary"${/^https?:/i.test(apply.url) ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>Apply Now</a>`
            : `<a href="${_esc(path)}" class="btn btn-primary">Apply Now</a>`;

        return `
            <article class="job-card">
                <div class="job-card-header">
                    <img src="${_esc(logo)}" data-logos="${_esc(JSON.stringify(logos))}" data-logo-idx="0" alt="${_esc(employer)} logo" class="company-logo" onerror="window.HabeshaUI&&window.HabeshaUI.nextLogo?window.HabeshaUI.nextLogo(this):(this.onerror=null,this.src='${fallback}')">
                    <div class="job-card-title">
                        <h4>${_esc(job.title)}${verified}</h4>
                        <p class="company">${_esc(employer)}</p>
                    </div>
                </div>
                <div class="job-meta">
                    <span>📍 ${_esc(job.location || job.regionCity || 'Not specified')}</span>
                    <span>💼 ${_esc(job.type || 'Not specified')}</span>
                    <span>📂 ${_esc(job.category || 'Other')}</span>
                    <span>👥 ${_esc(job.vacancies || 1)} ${(job.vacancies || 1) === 1 ? 'position' : 'positions'}</span>
                    <span${urgent ? ' style="color:#b91c1c;font-weight:600"' : ''}>⏰ ${daysLeft == null ? 'Deadline N/A' : daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left'}</span>
                </div>
                <p class="job-card-posted"><strong>Posted:</strong> ${_esc(job.postedDate || 'Not specified')} &nbsp; <strong>Deadline:</strong> ${_esc(job.deadline || 'Not specified')}</p>
                <div class="job-card-actions">
                    ${applyHtml}
                    <a href="${_esc(path)}" class="btn btn-outline">View Details</a>
                </div>
            </article>
        `;
    }).join('');

    renderPagination(Math.ceil(jobsState.total / jobsPerPage));
}

function renderPagination(totalPages) {
    const paginationContainer = document.getElementById('pagination');

    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    let paginationHTML = '';

    // Previous button
    paginationHTML += `
        <button onclick="goToPage(${jobsState.page - 1})" ${jobsState.page === 1 ? 'disabled' : ''}>
            ← Prev
        </button>
    `;

    // Page numbers with smart display
    const maxVisiblePages = 5;
    let startPage = Math.max(1, jobsState.page - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    // Adjust start if we're near the end
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    // First page + dots
    if (startPage > 1) {
        paginationHTML += `<button onclick="goToPage(1)">1</button>`;
        if (startPage > 2) {
            paginationHTML += `<span class="page-dots">...</span>`;
        }
    }

    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
        paginationHTML += `
            <button onclick="goToPage(${i})" class="${i === jobsState.page ? 'active' : ''}">
                ${i}
            </button>
        `;
    }

    // Last page + dots
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            paginationHTML += `<span class="page-dots">...</span>`;
        }
        paginationHTML += `<button onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }

    // Next button
    paginationHTML += `
        <button onclick="goToPage(${jobsState.page + 1})" ${jobsState.page === totalPages ? 'disabled' : ''}>
            Next →
        </button>
    `;

    // Page info
    paginationHTML += `
        <span class="page-info">Page ${jobsState.page} of ${totalPages}</span>
    `;

    paginationContainer.innerHTML = paginationHTML;
}

function goToPage(page) {
    const totalPages = Math.ceil(jobsState.total / jobsPerPage);
    if (page < 1 || page > totalPages) return;
    jobsState.page = page;
    applyFilters();
    const el = document.getElementById('jobsList');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearFilters() {
    document.getElementById('categoryFilter').value = '';
    document.getElementById('locationFilter').value = '';
    document.getElementById('typeFilter').value = '';
    document.getElementById('sortFilter').value = 'newest';
    document.getElementById('jobSearch').value = '';
    jobsState.page = 1;
    applyFilters();
}

function searchJobsPage() {
    jobsState.page = 1;
    applyFilters();
}
