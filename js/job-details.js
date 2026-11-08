document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get('id');
    if (jobId) loadJobDetails(jobId);
    else document.getElementById('jobDetailsContent').innerHTML = '<p>Job not found.</p>';
});

function esc(s) {
    return (window.HabeshaUI && window.HabeshaUI.escHtml) ? window.HabeshaUI.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function _logo(job){ return (window.HabeshaUI && window.HabeshaUI.jobLogoSrc) ? window.HabeshaUI.jobLogoSrc(job) : (job && (job.logo || 'images/companies/default-company.png')); }
function _fallbackLogo(job){ return (window.HabeshaUI && window.HabeshaUI.orgLogoDataUri) ? window.HabeshaUI.orgLogoDataUri(job && job.company) : 'images/companies/default-company.png'; }
function _fmtDate(v){ if(!v) return 'Not specified'; const s=String(v); return s.length >= 10 ? s.slice(0,10) : s; }

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
        <div class="deadline-warning"><strong>⚠️ Urgent:</strong> Only ${daysLeft} day(s) left to apply.</div>
    ` : '';
    const shareUrl = encodeURIComponent(window.location.href);
    const shareTitle = encodeURIComponent((job.title || '') + ' at ' + (job.company || ''));
    const shareText = encodeURIComponent('Check out this job opportunity: ' + (job.title || ''));
    window.__currentJob = job;

    const orgLink = job.originalUrl ? String(job.originalUrl) : '';
    const contactMail = job.contactEmail ? String(job.contactEmail) : '';
    const orgExactLink = orgLink
      ? `<a class="job-detail-apply-link" href="${esc(orgLink)}" target="_blank" rel="noopener noreferrer">${esc(orgLink)}</a>`
      : (contactMail ? `<a class="job-detail-apply-link" href="mailto:${encodeURIComponent(contactMail)}?subject=${encodeURIComponent('Application for ' + (job.title||'position'))}">${esc(contactMail)}</a>` : `<span>Not specified. See application instructions/source details.</span>`);

    const skills = Array.isArray(job.requiredSkills) ? job.requiredSkills.filter(Boolean) : (job.requiredSkills ? [job.requiredSkills] : []);
    const fields = [
      ['Organization', job.company],
      ['Job Title', job.title],
      ['Category', job.category],
      ['Location', job.location],
      ['Region / City', job.regionCity],
      ['Job Type', job.type],
      ['Number of Vacancies / Positions', job.vacancies == null ? null : String(job.vacancies)],
      ['Posted Date', _fmtDate(job.postedDate)],
      ['Application Deadline', job.deadline ? `${_fmtDate(job.deadline)}${daysLeft == null ? '' : ` (${daysLeft} day(s) left)`}` : 'Not specified'],
      ['Salary', job.salary],
      ['Education Requirements', job.educationRequirements],
      ['Experience Requirements', job.experienceRequirements],
      ['Required Skills', skills.length ? skills.join(', ') : null],
      ['Listing Type / Origin', job.origin === 'direct' ? 'Direct employer vacancy' : (job.origin === 'aggregated' ? 'Aggregated vacancy' : (job.origin || 'Not specified'))],
      ['Status', job.status],
      ['Featured', job.featured ? 'Yes' : (job.featured === false ? 'No' : null)],
      ['Source', job.sourceName || job.sourceSlug],
      ['Last Verified', _fmtDate(job.lastVerifiedAt)],
      ['Contact Email', job.contactEmail],
      ['Job ID', job.id == null ? null : String(job.id)],
    ];

    const fieldHtml = fields.map(([label, value]) => {
      if (value == null || String(value).trim() === '') return '';
      const safe = esc(value);
      if (label === 'Contact Email' && contactMail) return `<div class="job-detail-field"><strong>${esc(label)}</strong><span><a href="mailto:${encodeURIComponent(contactMail)}">${safe}</a></span></div>`;
      return `<div class="job-detail-field"><strong>${esc(label)}</strong><span>${safe}</span></div>`;
    }).join('');

    const applySection = `
      <div class="job-detail-section">
        <h3>Organization Exact Link (Apply)</h3>
        <p>Use the organization’s exact application/vacancy link below. Habesha Careers does not replace the original application process.</p>
        ${orgExactLink}
        ${job.applicationInstructions ? `<div class="job-detail-section"><h3>Application Instructions</h3><p>${esc(job.applicationInstructions)}</p></div>` : ''}
      </div>`;

    const desc = job.description || 'See original vacancy for full description.';
    const req = job.requirements;

    container.innerHTML = `
        <div class="job-detail-card">
            <div class="habesha-career-badge"><span class="badge-text">Habesha Career</span></div>
            <div class="job-header-section">
                <div class="job-title-section" style="flex:1;min-width:260px">
                    <div class="job-detail-org">
                        <img src="${esc(_logo(job))}" alt="${esc(job.company || 'Organization')}" class="job-detail-org-logo" onerror="this.onerror=null;this.src='${_fallbackLogo(job)}'">
                        <div>
                            <h2 style="margin:0 0 .35rem">${esc(job.title)}</h2>
                            <div class="company-save-row" style="justify-content:flex-start;flex-wrap:wrap">
                                <div class="company-tag" style="margin-left:0;padding-left:1.2rem">${esc(job.company || 'Organization not specified')}</div>
                                <button class="save-job-btn-inline" onclick="toggleSaveJob('${esc(String(job.id))}')" title="Save this job"><span>Save Job</span></button>
                            </div>
                        </div>
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
            ${urgentWarning}

            <div class="job-detail-section">
                <h3>Job Details</h3>
                <div class="job-detail-fields">${fieldHtml || '<div class="job-detail-field"><strong>Details</strong><span>No additional structured details available. See description and source link.</span></div>'}</div>
            </div>

            ${applySection}

            <div class="job-detail-section">
                <h3>Job Description</h3>
                <p style="white-space:pre-wrap">${esc(desc)}</p>
            </div>

            ${req ? `<div class="job-detail-section"><h3>Requirements</h3><pre class="job-detail-pre">${esc(req)}</pre></div>` : ''}
            ${job.educationRequirements ? `<div class="job-detail-section"><h3>Education Requirements</h3><p>${esc(job.educationRequirements)}</p></div>` : ''}
            ${job.experienceRequirements ? `<div class="job-detail-section"><h3>Experience Requirements</h3><p>${esc(job.experienceRequirements)}</p></div>` : ''}
            ${skills.length ? `<div class="job-detail-section"><h3>Required Skills</h3><p>${esc(skills.join(', '))}</p></div>` : ''}

            <div class="job-detail-section">
                <h3>Source / Verification</h3>
                <p><strong>Listing type:</strong> ${esc(job.origin === 'direct' ? 'Direct employer vacancy' : (job.origin === 'aggregated' ? 'Aggregated vacancy' : (job.origin || 'Not specified')))}</p>
                ${job.sourceName ? `<p><strong>Source name:</strong> ${esc(job.sourceName)}</p>` : ''}
                ${job.sourceSlug ? `<p><strong>Source slug:</strong> ${esc(job.sourceSlug)}</p>` : ''}
                ${job.lastVerifiedAt ? `<p><strong>Last verified:</strong> ${esc(_fmtDate(job.lastVerifiedAt))}</p>` : ''}
                ${orgLink ? `<p><strong>Original vacancy URL:</strong> <a href="${esc(orgLink)}" target="_blank" rel="noopener noreferrer">${esc(orgLink)}</a></p>` : ''}
                <p><small>Always verify details on the organization’s official application page before applying.</small></p>
            </div>

            <div style="margin-top: 2rem;display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;">
                ${orgLink ? `<a href="${esc(orgLink)}" target="_blank" rel="noopener noreferrer" class="job-detail-apply-link" style="font-size:1rem">Open organization exact link</a>` : ''}
                <a href="jobs.html" class="btn-secondary">Back to Jobs</a>
            </div>
        </div>
    `;

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
