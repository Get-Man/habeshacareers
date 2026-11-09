// Mobile menu toggle
document.addEventListener('DOMContentLoaded', function() {
    // Load recent jobs on home page
    if (document.getElementById('recentJobsList')) {
        loadRecentJobs();
    }

    // Load categories with vacancy counts
    if (document.getElementById('categoryGrid')) {
        loadCategoriesWithVacancies();
    }
    if (document.getElementById('partnersTrack')) {
        loadTrustedPartners();
    }
    if (document.querySelector('.impact-stats')) {
        loadImpactStats();
    }
});

// Load categories with total vacancy counts
function loadCategoriesWithVacancies() {
    const jobs = getAllJobs();
    const categories = [
        { name: 'Healthcare and Medical', icon: '🏥', fullName: 'Healthcare and Medical' },
        { name: 'Information Technology', icon: '💻', fullName: 'Information Technology and Computer Science' },
        { name: 'Education and Training', icon: '📚', fullName: 'Education and Training' },
        { name: 'Engineering and Technical', icon: '⚙️', fullName: 'Engineering and Technical' },
        { name: 'Finance and Accounting', icon: '💰', fullName: 'Finance and Accounting' },
        { name: 'Business and Management', icon: '💼', fullName: 'Business and Management' },
        { name: 'Creative and Design', icon: '🎨', fullName: 'Creative and Design' },
        { name: 'Law and Public Safety', icon: '⚖️', fullName: 'Law and Public Safety' },
        { name: 'Science and Research', icon: '🔬', fullName: 'Science and Research' },
        { name: 'Hospitality and Tourism', icon: '🏨', fullName: 'Hospitality and Tourism' },
        { name: 'Manufacturing and Skilled Trades', icon: '🏭', fullName: 'Manufacturing and Skilled Trades' },
        { name: 'Agriculture and Natural Resources', icon: '🌾', fullName: 'Agriculture and Natural Resources' },
        { name: 'Transportation and Logistics', icon: '🚚', fullName: 'Transportation and Logistics' },
        { name: 'Media and Communication', icon: '📡', fullName: 'Media and Communication' }
    ];

    const container = document.getElementById('categoryGrid');
    
    container.innerHTML = categories.map(cat => {
        const categoryJobs = jobs.filter(job => job.category === cat.name);
        const jobCount = categoryJobs.length;
        
        return `
            <div class="category-card" onclick="filterByCategory('${cat.name}')">
                <span class="icon">${cat.icon}</span>
                <h4>${cat.fullName}</h4>
                <p class="vacancy-count">${jobCount} ${jobCount === 1 ? 'job' : 'jobs'}</p>
            </div>
        `;
    }).join('');
}

function _esc(s){ return (window.HabeshaUI && window.HabeshaUI.escHtml) ? window.HabeshaUI.escHtml(s) : String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _logo(job){ return (window.HabeshaUI && window.HabeshaUI.jobLogoSrc) ? window.HabeshaUI.jobLogoSrc(job) : (job && job.logo) || (window.HabeshaUI && window.HabeshaUI.orgLogoDataUri ? window.HabeshaUI.orgLogoDataUri(job && job.company) : ''); }
function _fallbackLogo(job){ return (window.HabeshaUI && window.HabeshaUI.orgLogoDataUri) ? window.HabeshaUI.orgLogoDataUri(job && job.company) : ''; }
function _logoImgHtml(job, className, alt){ const list = (window.HabeshaUI && window.HabeshaUI.logoCandidates) ? window.HabeshaUI.logoCandidates(job) : [_logo(job), _fallbackLogo(job)].filter(Boolean); const first = list[0] || _fallbackLogo(job) || ''; const json = _esc(JSON.stringify(list)); return `<img src="${_esc(first)}" data-logos="${json}" data-logo-idx="0" alt="${_esc(alt || (job && job.company) || '')}" class="${_esc(className||'company-logo')}" onerror="window.HabeshaUI&&window.HabeshaUI.nextLogo?window.HabeshaUI.nextLogo(this):(this.onerror=null)">`; }

function _jobCardBadge(job) {
    if (job && job.sourceName) return `<span style="display:inline-block;margin-left:.35rem;padding:.1rem .45rem;border-radius:999px;background:#f3f4f6;color:#374151;font-size:.72rem;vertical-align:middle;border:1px solid #e5e7eb">${_esc(job.sourceName)}</span>`;
    return '';
}

// Load recent jobs (last 6)
function loadRecentJobs() {
    const jobs = getAllJobs();
    const recentJobs = [...jobs].sort((a,b)=>String(b.postedDate||b.created_at||'').localeCompare(String(a.postedDate||a.created_at||''))).slice(0,6);
    const container = document.getElementById('recentJobsList');
    if (!container) return;

    if (recentJobs.length === 0) {
        const err = window.JobsApi && window.JobsApi.lastError;
        const msg = (err && err.error === 'db_unavailable') ? 'Live job database is not configured yet. Configure Neon <code>DATABASE_URL</code> and run source sync from <a href="admin.html">Admin</a> to show real aggregated vacancies.' : 'No active vacancies found right now. Check back soon or visit <a href="jobs.html">Browse Jobs</a>.';
        container.innerHTML = `<p>${msg}</p>`;
        return;
    }

    container.innerHTML = recentJobs.map(job => `
        <div class="job-card">
            <div class="job-card-header">
                ${_logoImgHtml(job, 'company-logo', job.company || '')}
                <div class="job-card-title">
                    <h4>${_esc(job.title)}${_jobCardBadge(job)}</h4>
                    <p class="company">${_esc(job.company || '')}</p>
                </div>
            </div>
            <div class="job-meta">
                <span>📍 ${_esc(job.location || job.regionCity || 'Not specified')}</span>
                <span>💼 ${_esc(job.type || 'Not specified')}</span>
                <span>📂 ${_esc(job.category || 'Other')}</span>
                ${job.originalUrl ? `<span>🔗 ${_esc(job.sourceName || 'Original source')}</span>` : ''}
            </div>
            <p>Deadline: ${_esc(job.deadline || 'Not specified')}</p>
            <a href="job-details.html?id=${encodeURIComponent(job.id)}" class="btn-view">View Details</a>
        </div>
    `).join('');
}

function loadTrustedPartners() {
    const track = document.getElementById('partnersTrack');
    if (!track) return;
    const jobs = getAllJobs();
    const seen = new Map();
    for (const job of jobs) {
        const key = String(job.company || '').trim().toLowerCase();
        if (!key) continue;
        if (!seen.has(key)) seen.set(key, { name: job.company, job });
    }
    const partners = Array.from(seen.values());
    if (!partners.length) {
        track.innerHTML = `<div class="partner-logo partner-logo-empty">Partner logos will appear here as jobs are posted</div>`;
        return;
    }
    const item = (p) => `<div class="partner-logo partner-logo-card" title="${_esc(p.name)}">${_logoImgHtml(p.job, 'partner-logo-img', p.name)}<span class="partner-logo-name">${_esc(p.name)}</span></div>`;
    const items = partners.map(item).join('');
    track.innerHTML = partners.length > 3 ? (items + items) : items; // duplicate for seamless loop when enough
}

function loadImpactStats() {
    const jobs = getAllJobs();
    const activeJobs = jobs.length;
    const orgs = new Set(jobs.map(j => String(j.company||'').trim().toLowerCase()).filter(Boolean)).size;
    const categories = new Set(jobs.map(j => String(j.category||'').trim()).filter(Boolean)).size;
    const sources = new Set(jobs.map(j => String(j.sourceName || j.sourceSlug || (j.origin==='direct'?'Direct':'') || '').trim()).filter(Boolean)).size;
    const setStat = (id, value, label) => {
        const el = document.getElementById(id);
        if (el) { el.textContent = String(value); el.setAttribute('data-target', String(value)); }
        const lbl = document.getElementById(id + 'Label');
        if (lbl && label) lbl.textContent = label;
    };
    setStat('statJobs', activeJobs, 'Active Vacancies');
    setStat('statOrgs', orgs, 'Partner Organizations');
    setStat('statCategories', categories, 'Categories Covered');
    setStat('statSources', sources || orgs, 'Sources / Employers');
}

window.addEventListener('habesha:jobs-updated', () => { try { loadRecentJobs(); loadTrustedPartners(); loadImpactStats(); if (typeof loadCategoriesWithVacancies==='function') loadCategoriesWithVacancies(); } catch(e){} });

// Search jobs from home page
function searchJobs() {
    const searchTerm = document.getElementById('homeSearch').value;
    localStorage.setItem('searchTerm', searchTerm);
    window.location.href = 'jobs.html';
}

// Clear search input
function clearSearch(inputId) {
    const input = document.getElementById(inputId);
    input.value = '';
    input.focus();
    
    // Hide the clear button
    const clearBtn = input.nextElementSibling;
    if (clearBtn && clearBtn.classList.contains('clear-btn')) {
        clearBtn.style.display = 'none';
    }
    
    // If on jobs page, trigger search to show all jobs
    if (inputId === 'jobSearch' && typeof filterJobs === 'function') {
        filterJobs();
    }
}

// Show/hide clear button based on input
document.addEventListener('DOMContentLoaded', function() {
    const searchInputs = ['homeSearch', 'jobSearch'];
    
    searchInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener('input', function() {
                const clearBtn = this.nextElementSibling;
                if (clearBtn && clearBtn.classList.contains('clear-btn')) {
                    clearBtn.style.display = this.value ? 'flex' : 'none';
                }
            });
            
            // Allow Enter key to trigger search
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    if (inputId === 'homeSearch') {
                        searchJobs();
                    } else if (inputId === 'jobSearch') {
                        searchJobsPage();
                    }
                }
            });
        }
    });
});

// Search recent jobs
function searchRecentJobs() {
    const searchTerm = document.getElementById('recentJobsSearch').value;
    localStorage.setItem('searchTerm', searchTerm);
    window.location.href = 'jobs.html';
}

// Filter by category from home page
function filterByCategory(category) {
    localStorage.setItem('filterCategory', category);
    window.location.href = 'jobs.html';
}


// Impact stats are now rendered from live job data in loadImpactStats().


// Update navbar based on login status
function updateNavbar() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    const profileLink = document.getElementById('profileLink');
    const loginLink = document.getElementById('loginLink');
    const postJobLink = document.getElementById('postJobLink');
    
    if (currentUser) {
        // User is logged in
        if (profileLink) {
            profileLink.style.display = 'block';
            
            // Update profile link based on user type
            const profileAnchor = profileLink.querySelector('a');
            if (profileAnchor) {
                if (currentUser.type === 'employer') {
                    // For employers, link to employer dashboard (or profile for now)
                    profileAnchor.href = 'profile.html'; // TODO: Change to employer-dashboard.html when ready
                    profileAnchor.title = 'My Dashboard';
                } else {
                    // For job seekers, link to profile
                    profileAnchor.href = 'profile.html';
                    profileAnchor.title = 'My Profile';
                }
            }
        }
        
        if (loginLink) loginLink.style.display = 'none';
        
        // Hide/Show Post Job button based on user type
        if (postJobLink) {
            if (currentUser.type === 'jobseeker') {
                // Hide Post Job for job seekers
                postJobLink.style.display = 'none';
            } else if (currentUser.type === 'employer') {
                // Show Post Job for employers
                postJobLink.style.display = 'block';
            }
        }
    } else {
        // User is not logged in
        if (profileLink) profileLink.style.display = 'none';
        if (loginLink) loginLink.style.display = 'block';
        
        // Show Post Job button for non-logged-in users
        if (postJobLink) {
            postJobLink.style.display = 'block';
        }
    }
}

// Logout function
function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
}

// Update navbar on page load
document.addEventListener('DOMContentLoaded', updateNavbar);
