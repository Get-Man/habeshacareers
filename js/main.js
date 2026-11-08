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

function _jobCardBadge(job) {
    if (job && job.origin === 'aggregated') return `<span style="display:inline-block;margin-left:.35rem;padding:.1rem .4rem;border-radius:999px;background:#eef2ff;font-size:.72rem;vertical-align:middle">Aggregated${job.sourceName ? ': '+String(job.sourceName).replace(/[&<>]/g,'') : ''}</span>`;
    if (job && job.origin === 'direct') return `<span style="display:inline-block;margin-left:.35rem;padding:.1rem .4rem;border-radius:999px;background:#ecfdf5;font-size:.72rem;vertical-align:middle">Direct</span>`;
    return '';
}

// Load recent jobs (last 6)
function loadRecentJobs() {
    const jobs = getAllJobs();
    const recentJobs = [...jobs].sort((a,b)=>String(b.postedDate||'').localeCompare(String(a.postedDate||''))).slice(0,6);
    const container = document.getElementById('recentJobsList');
    if (!container) return;

    if (recentJobs.length === 0) {
        const err = window.JobsApi && window.JobsApi.lastError;
        const msg = (err && err.error === 'db_unavailable') ? 'Live job database is not configured yet. Configure Neon <code>DATABASE_URL</code> and run source sync from <a href="admin.html">Admin</a> to show real aggregated vacancies.' : 'No active vacancies found right now. Check back soon or visit <a href="jobs.html">Browse Jobs</a>.';
        container.innerHTML = `<p>${msg}</p>`;
        return;
    }

    container.innerHTML = recentJobs.map(job => {
        const logoPath = job.logo || 'images/companies/default-company.png';
        return `
        <div class="job-card">
            <div class="job-card-header">
                <img src="${logoPath}" alt="${job.company || ''}" class="company-logo" onerror="this.style.display='none'">
                <div class="job-card-title">
                    <h4>${job.title || ''}${_jobCardBadge(job)}</h4>
                    <p class="company">${job.company || ''}</p>
                </div>
            </div>
            <div class="job-meta">
                <span>📍 ${job.location || 'Not specified'}</span>
                <span>💼 ${job.type || ''}</span>
                <span>📂 ${job.category || ''}</span>
                ${job.originalUrl ? `<span>🔗 ${job.sourceName || 'Original source'}</span>` : ''}
            </div>
            <p>Deadline: ${job.deadline || 'Not specified'}</p>
            <a href="job-details.html?id=${job.id}" class="btn-view">View Details</a>
        </div>
    `}).join('');
}
window.addEventListener('habesha:jobs-updated', () => { try { loadRecentJobs(); if (typeof loadCategoriesWithVacancies==='function') loadCategoriesWithVacancies(); } catch(e){} });

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


// Animated Counter for Impact Stats
function animateCounter(element, target, duration = 2000) {
    let start = 0;
    const increment = target / (duration / 16);
    
    const timer = setInterval(() => {
        start += increment;
        if (start >= target) {
            element.textContent = target.toLocaleString();
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(start).toLocaleString();
        }
    }, 16);
}

// Intersection Observer for stats animation
const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const statNumbers = entry.target.querySelectorAll('.stat-number');
            statNumbers.forEach(stat => {
                const target = parseInt(stat.getAttribute('data-target'));
                animateCounter(stat, target);
            });
            statsObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

// Observe impact stats section
document.addEventListener('DOMContentLoaded', function() {
    const impactStats = document.querySelector('.impact-stats');
    if (impactStats) {
        statsObserver.observe(impactStats);
    }
});


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
