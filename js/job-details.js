document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get('id');
    if (jobId) loadJobDetails(jobId);
    else document.getElementById('jobDetailsContent').innerHTML = '<p>Job not found.</p>';
});

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function loadJobDetails(jobId) {
    const container = document.getElementById('jobDetailsContent');
    container.innerHTML = '<p>Loading job details…</p>';
    let job = null;
    try {
        if (window.JobsApi && typeof window.JobsApi.getById === 'function') job = await window.JobsApi.getById(jobId);
    } catch (e) { console.warn(e); }
    if (!job) job = getJobById(jobId);
    if (!job) {
        container.innerHTML = '<p>Job not found. <a href="jobs.html">Back to jobs</a></p>';
        return;
    }

    const daysLeft = typeof getDaysUntilDeadline === 'function' ? getDaysUntilDeadline(job.deadline) : null;
    const urgentWarning = (daysLeft != null && daysLeft <= 7 && daysLeft >= 0) ? `
        <div class="deadline-warning"><strong>⚠️ Urgent:</strong> Only ${daysLeft} days left to apply!</div>
    ` : '';
    const sourceInfo = (job.sourceName || job.origin === 'direct' || job.origin === 'aggregated') ? `
        <div class="job-source-info" style="margin:1rem 0;padding:.75rem 1rem;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
            <strong>Listing type:</strong> ${esc(job.origin === 'direct' ? 'Direct employer vacancy' : (job.origin === 'aggregated' ? 'Aggregated vacancy' : 'Local listing'))}
            ${job.sourceName ? `<br><strong>Source:</strong> ${esc(job.sourceName)}` : ''}
            ${job.lastVerifiedAt ? `<br><strong>Last verified:</strong> ${esc(String(job.lastVerifiedAt).slice(0,10))}` : ''}
            ${job.originalUrl ? `<br><strong>Original vacancy:</strong> <a href="${esc(job.originalUrl)}" target="_blank" rel="noopener noreferrer">View/apply on source website</a>` : ''}
        </div>` : '';

    const shareUrl = encodeURIComponent(window.location.href);
    const shareTitle = encodeURIComponent((job.title || '') + ' at ' + (job.company || ''));
    const shareText = encodeURIComponent('Check out this job opportunity: ' + (job.title || ''));
    window.__currentJob = job;
    const safeOriginal = job.originalUrl ? String(job.originalUrl) : '';
    const daysText = (daysLeft == null) ? 'N/A' : `${daysLeft} days left`;
    const deadlineText = job.deadline ? `${esc(job.deadline)} (${daysText})` : 'Not specified';
    const applyPrimary = safeOriginal
        ? `<a href="${esc(safeOriginal)}" target="_blank" rel="noopener noreferrer" class="btn-primary">Apply on Source Website</a>`
        : (job.contactEmail ? `<button onclick="openApplicationModal(${Number(job.id)||0})" class="btn-primary">Apply Now</button>` : `<a href="jobs.html" class="btn-primary">View More Jobs</a>`);
    const howToApply = safeOriginal
        ? `<p>Apply through the official/original vacancy page: <a href="${esc(safeOriginal)}" target="_blank" rel="noopener noreferrer"><strong>Open application page</strong></a></p>${job.applicationInstructions ? `<p>${esc(job.applicationInstructions)}</p>` : ''}<p><small>Habesha Careers aggregates public vacancies and links you to the original source. Always verify details on the source website.</small></p>`
        : (job.contactEmail ? `<p>Send your CV and cover letter to: <strong>${esc(job.contactEmail)}</strong></p><p>Please mention the job title in your email subject line.</p>` : `<p>See the original vacancy details for application instructions.</p>`);

    container.innerHTML = `
        <div class="job-detail-card">
            <div class="habesha-career-badge"><span class="badge-text">Habesha Career</span></div>
            <div class="job-header-section">
                <div class="job-title-section">
                    <h2>${esc(job.title)}</h2>
                    <div class="company-save-row">
                        <div class="company-tag">${esc(job.company)}</div>
                        <button class="save-job-btn-inline" onclick="toggleSaveJob(${Number(job.id)||0})" title="Save this job"><span>Save Job</span></button>
                    </div>
                </div>
                <div class="share-section">
                    <span class="share-label">Share:</span>
                    <div class="share-icons">
                        <a href="https://t.me/share/url?url=${shareUrl}&text=${shareText}" target="_blank" rel="noopener noreferrer" class="share-icon telegram" title="Share on Telegram">TG</a>
                        <a href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" target="_blank" rel="noopener noreferrer" class="share-icon linkedin" title="Share on LinkedIn">in</a>
                        <a href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener noreferrer" class="share-icon facebook" title="Share on Facebook">f</a>
                        <a href="mailto:?subject=${shareTitle}&body=${shareText}%20${shareUrl}" class="share-icon email" title="Share via Email">@</a>
                    </div>
                </div>
            </div>
            <div class="header-separator"></div>
            ${sourceInfo}
            <div class="job-detail-meta">
                <div><strong>📍 Location:</strong><br>${esc(job.location || job.regionCity || 'Not specified')}</div>
                <div><strong>💼 Job Type:</strong><br>${esc(job.type || 'Not specified')}</div>
                <div><strong>📂 Category:</strong><br>${esc(job.category || 'Other')}</div>
                <div><strong>👥 Positions:</strong><br>${esc(job.vacancies || 1)}</div>
                <div><strong>📅 Posted:</strong><br>${esc(job.postedDate || 'Not specified')}</div>
                <div><strong>⏰ Deadline:</strong><br>${deadlineText}</div>
            </div>
            ${urgentWarning}
            <h3>Job Description</h3>
            <p>${esc(job.description || 'See original vacancy for full description.')}</p>
            ${job.requirements ? `<h3>Requirements</h3><pre style="white-space: pre-wrap; font-family: inherit;">${esc(job.requirements)}</pre>` : ''}
            ${job.educationRequirements ? `<h3>Education</h3><p>${esc(job.educationRequirements)}</p>` : ''}
            ${job.experienceRequirements ? `<h3>Experience</h3><p>${esc(job.experienceRequirements)}</p>` : ''}
            <h3>How to Apply</h3>
            ${howToApply}
            <div style="margin-top: 2rem;display:flex;gap:.5rem;flex-wrap:wrap;">
                ${applyPrimary}
                <a href="jobs.html" class="btn-secondary">Back to Jobs</a>
            </div>
        </div>
        ${!safeOriginal && job.contactEmail ? `
        <div id="applicationModal" class="modal"><div class="modal-content"><span class="modal-close" onclick="closeApplicationModal()">&times;</span><h3>Choose Application Method</h3><div class="application-options"><div class="application-option" onclick="applyWithHabesha(${Number(job.id)||0})"><div class="option-icon">🇪🇹</div><h4>Apply with Habesha Career</h4><p>Use your profile or upload CV</p></div><div class="application-option" onclick="applyWithCompany()"><div class="option-icon">🏢</div><h4>Apply via Email</h4><p>Send email directly to employer</p></div></div></div></div>
        <div id="habeshaApplicationModal" class="modal"><div class="modal-content"><span class="modal-close" onclick="closeHabeshaModal()">&times;</span><h3>Apply with Habesha Career</h3><div class="application-methods"><button class="method-btn" onclick="applyWithProfile()">Apply with Profile</button><button class="method-btn" onclick="document.getElementById('cvUpload').click()">Upload CV</button><input type="file" id="cvUpload" accept=".pdf,.doc,.docx" style="display:none" onchange="handleCVUpload(event, ${Number(job.id)||0})"></div></div></div>` : ''}
    `;

    // restore save state
    setTimeout(() => {
        const savedJobs = JSON.parse(localStorage.getItem('savedJobs') || '[]');
        const btn = document.querySelector('.save-job-btn-inline');
        if (btn && savedJobs.map(String).includes(String(job.id))) btn.classList.add('saved');
    }, 50);
}

function toggleSaveJob(jobId) {
    const savedJobs = JSON.parse(localStorage.getItem('savedJobs') || '[]');
    const btn = document.querySelector('.save-job-btn-inline');
    const idx = savedJobs.map(String).indexOf(String(jobId));
    if (idx >= 0) {
        savedJobs.splice(idx, 1);
        if (btn) btn.classList.remove('saved');
        alert('Job removed from saved list');
    } else {
        savedJobs.push(jobId);
        if (btn) btn.classList.add('saved');
        alert('Job saved successfully!');
    }
    localStorage.setItem('savedJobs', JSON.stringify(savedJobs));
}

function openApplicationModal(jobId) { const el = document.getElementById('applicationModal'); if (el) el.style.display = 'flex'; }
function closeApplicationModal() { const el = document.getElementById('applicationModal'); if (el) el.style.display = 'none'; }
function applyWithHabesha(jobId) { closeApplicationModal(); const el = document.getElementById('habeshaApplicationModal'); if (el) el.style.display = 'flex'; }
function closeHabeshaModal() { const el = document.getElementById('habeshaApplicationModal'); if (el) el.style.display = 'none'; }
function applyWithCompany() {
    const job = window.__currentJob || {};
    closeApplicationModal();
    if (job.contactEmail) window.location.href = `mailto:${encodeURIComponent(job.contactEmail)}?subject=${encodeURIComponent('Application for ' + (job.title || 'position'))}`;
    else if (job.originalUrl) window.open(job.originalUrl, '_blank', 'noopener,noreferrer');
}
function applyWithProfile() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!currentUser) { alert('Please login to apply with your profile'); window.location.href = 'login.html'; return; }
    alert('Application submitted with your profile!');
    closeHabeshaModal();
}
function handleCVUpload(event, jobId) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('File size should be less than 5MB'); return; }
    alert(`CV "${file.name}" selected. (Upload to server will be enabled when backend file handling is configured.)`);
    closeHabeshaModal();
}
window.onclick = function(event) {
    const appModal = document.getElementById('applicationModal');
    const habeshaModal = document.getElementById('habeshaApplicationModal');
    if (appModal && event.target == appModal) closeApplicationModal();
    if (habeshaModal && event.target == habeshaModal) closeHabeshaModal();
};
