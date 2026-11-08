let currentJobs = [];
let currentPage = 1;
const jobsPerPage = 6;
function _esc(s){ return (window.HabeshaUI && window.HabeshaUI.escHtml) ? window.HabeshaUI.escHtml(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _logo(job){ return (window.HabeshaUI && window.HabeshaUI.jobLogoSrc) ? window.HabeshaUI.jobLogoSrc(job) : (job.logo || 'images/companies/default-company.png'); }
function _fallbackLogo(job){ return (window.HabeshaUI && window.HabeshaUI.orgLogoDataUri) ? window.HabeshaUI.orgLogoDataUri(job && job.company) : 'images/companies/default-company.png'; }

document.addEventListener('DOMContentLoaded', function() {
    loadJobs();

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

    if (savedSearch || savedCategory) {
        applyFilters();
    }
});

window.addEventListener('habesha:jobs-updated', () => { try { applyFilters(); } catch(e){} });

function loadJobs() {
    currentJobs = getAllJobs();
    currentPage = 1;
    displayJobs(currentJobs);
}

function displayJobs(jobs) {
    const container = document.getElementById('jobsList');
    const countElement = document.getElementById('jobsCount');

    countElement.textContent = `${jobs.length} job(s) found`;

    if (jobs.length === 0) {
        const err = window.JobsApi && window.JobsApi.lastError;
        const msg = (err && err.error === 'db_unavailable') ? 'Live job database is not configured yet. Configure Neon <code>DATABASE_URL</code> and sync real sources from <a href="admin.html">Admin</a>.' : 'No jobs match your criteria.';
        container.innerHTML = `<p>${msg}</p>`;
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(jobs.length / jobsPerPage);
    const startIndex = (currentPage - 1) * jobsPerPage;
    const endIndex = startIndex + jobsPerPage;
    const paginatedJobs = jobs.slice(startIndex, endIndex);

    container.innerHTML = paginatedJobs.map(job => {
        const daysLeft = getDaysUntilDeadline(job.deadline);
        const urgentClass = (daysLeft != null && daysLeft <= 7) ? 'style="color: red;"' : '';
        const logoPath = _logo(job);
        const fallback = _fallbackLogo(job);
        const badge = job.origin === 'aggregated' ? `<span style="display:inline-block;margin-left:.35rem;padding:.1rem .4rem;border-radius:999px;background:#eef2ff;font-size:.72rem">Aggregated${job.sourceName?': '+_esc(job.sourceName):''}</span>` : (job.origin==='direct'?`<span style="display:inline-block;margin-left:.35rem;padding:.1rem .4rem;border-radius:999px;background:#ecfdf5;font-size:.72rem">Direct</span>`:'');

        return `
            <div class="job-card">
                <div class="job-card-header">
                    <img src="${_esc(logoPath)}" alt="${_esc(job.company || '')}" class="company-logo" onerror="this.onerror=null;this.src='${fallback}'">
                    <div class="job-card-title">
                        <h4>${_esc(job.title)}${badge}</h4>
                        <p class="company">${_esc(job.company || 'Organization not specified')}</p>
                    </div>
                </div>
                <div class="job-meta">
                    <span>📍 ${_esc(job.location || job.regionCity || 'Not specified')}</span>
                    <span>💼 ${_esc(job.type || 'Not specified')}</span>
                    <span>📂 ${_esc(job.category || 'Other')}</span>
                    <span>👥 ${_esc(job.vacancies || 1)} ${(job.vacancies || 1) === 1 ? 'position' : 'positions'}</span>
                    <span ${urgentClass}>⏰ ${daysLeft == null ? 'Deadline N/A' : daysLeft + ' days left'}</span>
                    ${job.sourceName ? `<span>🔗 ${_esc(job.sourceName)}</span>` : (job.originalUrl ? `<span>🔗 Original source</span>` : '')}
                </div>
                <p><strong>Posted:</strong> ${_esc(job.postedDate || 'Not specified')} &nbsp; <strong>Deadline:</strong> ${_esc(job.deadline || 'Not specified')}</p>
                <a href="job-details.html?id=${encodeURIComponent(job.id)}" class="btn-view">View Details</a>
            </div>
        `;
    }).join('');

    renderPagination(totalPages);
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
        <button onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
            ← Prev
        </button>
    `;

    // Page numbers with smart display
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
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
            <button onclick="goToPage(${i})" class="${i === currentPage ? 'active' : ''}">
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
        <button onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
            Next →
        </button>
    `;

    // Page info
    paginationHTML += `
        <span class="page-info">Page ${currentPage} of ${totalPages}</span>
    `;

    paginationContainer.innerHTML = paginationHTML;
}

function goToPage(page) {
    const totalPages = Math.ceil(currentJobs.length / jobsPerPage);
    
    if (page < 1 || page > totalPages) return;
    
    currentPage = page;
    displayJobs(currentJobs);
    
    // Scroll to top of jobs list
    document.getElementById('jobsList').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Exact match function - case insensitive
function exactMatch(text, search) {
    text = text.toLowerCase();
    search = search.toLowerCase();
    
    // Exact substring match
    return text.includes(search);
}

function applyFilters() {
    const category = document.getElementById('categoryFilter').value;
    const location = document.getElementById('locationFilter').value;
    const type = document.getElementById('typeFilter').value;
    const sort = document.getElementById('sortFilter').value;
    const search = document.getElementById('jobSearch').value.trim();

    let filtered = getAllJobs();

    // Apply filters
    if (category) {
        filtered = filtered.filter(job => job.category === category);
    }

    if (location) {
        filtered = filtered.filter(job => job.location === location);
    }

    if (type) {
        filtered = filtered.filter(job => job.type === type);
    }

    if (search) {
        filtered = filtered.filter(job => 
            exactMatch(job.title, search) ||
            exactMatch(job.company, search) ||
            exactMatch(job.description, search) ||
            exactMatch(job.category, search) ||
            exactMatch(job.location, search)
        );
    }

    // Apply sorting
    if (sort === 'newest') {
        filtered.sort((a, b) => new Date(b.postedDate) - new Date(a.postedDate));
    } else if (sort === 'deadline') {
        filtered.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    }

    currentJobs = filtered;
    currentPage = 1; // Reset to first page when filtering
    displayJobs(filtered);
}

function clearFilters() {
    document.getElementById('categoryFilter').value = '';
    document.getElementById('locationFilter').value = '';
    document.getElementById('typeFilter').value = '';
    document.getElementById('sortFilter').value = 'newest';
    document.getElementById('jobSearch').value = '';
    loadJobs();
}

function searchJobsPage() {
    applyFilters();
}
