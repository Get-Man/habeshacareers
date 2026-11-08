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
    if (!container) return;
    container.innerHTML = '<p>Loading job details…</p>';
    let job = null;
    let loadError = null;
    try {
        if (window.JobsApi && typeof window.JobsApi.getById === 'function') job = await window.JobsApi.getById(jobId);
    } catch (e) { loadError = e; console.warn(e); }
    if (!job && typeof getJobById === 'function') {
        try { job = getJobById(jobId); } catch (e) { if (!loadError) loadError = e; }
    }
    if (!job) {
        const hint = (loadError && /401|403|auth|protected|html|json/i.test(String(loadError.message||loadError))) ? ' If the site is protected, sign in or open the public production URL.' : '';
        container.innerHTML = `<div class="job-detail-card"><p><strong>Job details could not be loaded.</strong>${esc(hint)}</p><p><a href="jobs.html">Back to jobs</a></p></div>`;
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
    const applyHref = orgLink || (contactMail ? `mailto:${contactMail}?subject=${encodeURIComponent('Application for ' + (job.title||'position'))}` : '');
    const applyTarget = orgLink ? ' target="_blank" rel="noopener noreferrer"' : '';
    const applyCta = applyHref
      ? `<a class="btn-apply-source" href="${esc(applyHref)}"${applyTarget}>${orgLink ? 'Apply on Source (Organization Website)' : 'Contact Organization'}</a>
         ${orgLink ? `<div class="job-detail-apply-link-wrap"><strong>Exact source link:</strong> <a class="job-detail-apply-link" href="${esc(orgLink)}" target="_blank" rel="noopener noreferrer">${esc(orgLink)}</a></div>` : ''}`
      : `<div class="job-detail-apply-link-wrap">No external application link provided. See application instructions below.</div>`;

    const skills = Array.isArray(job.requiredSkills) ? job.requiredSkills.filter(Boolean) : (job.requiredSkills ? [job.requiredSkills] : []);
    const allDetails = [
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
      ['Source Name', job.sourceName],
      ['Last Verified', _fmtDate(job.lastVerifiedAt)],
      ['Contact Email', job.contactEmail],
      ['Official Application URL', orgLink],
      ['Job ID', job.id == null ? null : String(job.id)],
      ['Status', job.status],
    ];

    const fieldHtml = allDetails.map(([label, value]) => {
      if (value == null || String(value).trim() === '') return '';
      const safe = esc(value);
      if (label === 'Contact Email' && contactMail) return `<div class="job-detail-field"><strong>${esc(label)}</strong><span><a href="mailto:${encodeURIComponent(contactMail)}">${safe}</a></span></div>`;
      if (label === 'Official Application URL' && orgLink) return `<div class="job-detail-field"><strong>${esc(label)}</strong><span><a href="${esc(orgLink)}" target="_blank" rel="noopener noreferrer">${safe}</a></span></div>`;
      return `<div class="job-detail-field"><strong>${esc(label)}</strong><span>${safe}</span></div>`;
    }).join('');

    const desc = String(job.description || '').trim() || 'Full description is available on the official source page linked above.';
    const req = String(job.requirements || '').trim();
    const extraRaw = (job.raw_payload && typeof job.raw_payload === 'object') ? null : null;

    const shareSvg = {
      telegram: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M21.9 4.6c.3-1.2-.9-2.1-2-1.6L2.8 9.8c-1.3.5-1.2 2.4.1 2.8l4.4 1.4 1.7 5.3c.4 1.2 2 1.5 2.8.5l2.5-3.1 4.5 3.3c1 .8 2.5.2 2.8-1.1l.3-1.4zM9.3 13.3l8.9-5.5c.2-.1.4.1.2.3l-7.3 6.8c-.2.2-.4.5-.4.8l-.3 2.2c0 .2-.3.2-.4 0l-1.3-4.1c-.1-.3 0-.4.6-.5z"/></svg>',
      linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6.94 8.5H3.56V20h3.38V8.5zM5.25 3A2.06 2.06 0 0 0 3.2 5.06c0 1.13.92 2.06 2.05 2.06A2.06 2.06 0 0 0 7.3 5.06 2.06 2.06 0 0 0 5.25 3zM20.8 13.41c0-3.27-1.75-4.79-4.08-4.79-1.88 0-2.72 1.03-3.19 1.76V8.5h-3.38c.04 1.25 0 11.5 0 11.5h3.38v-6.42c0-.34.02-.69.13-.93.28-.69.91-1.41 1.97-1.41 1.39 0 1.95 1.06 1.95 2.62V20H20.8v-6.59z"/></svg>',
      facebook: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z"/></svg>',
      x: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M18.9 3H22l-6.77 7.74L23.2 21h-6.24l-4.89-6.39L6.48 21H3.37l7.24-8.28L2.8 3h6.4l4.42 5.85L18.9 3zm-1.1 16.17h1.72L8.27 4.73H6.43l11.37 14.44z"/></svg>',
      email: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5L4 8V6l8 5 8-5v2z"/></svg>'
    };

    const logoList = (window.HabeshaUI && window.HabeshaUI.logoCandidates) ? window.HabeshaUI.logoCandidates(job) : [_logo(job), _fallbackLogo(job)];
    const logoJson = esc(JSON.stringify(logoList));
    container.innerHTML = `
        <div class="job-detail-card">
            <div class="job-header-section">
                <div class="job-title-section" style="flex:1;min-width:260px">
                    <div class="job-detail-org">
                        <img src="${esc(logoList[0] || _fallbackLogo(job))}" data-logos="${logoJson}" data-logo-idx="0" alt="${esc(job.company || 'Organization')}" class="job-detail-org-logo" onerror="(function(img){try{var l=JSON.parse(img.getAttribute('data-logos')||'[]');var i=(+img.getAttribute('data-logo-idx')||0)+1; if(i<l.length){img.setAttribute('data-logo-idx',i);img.src=l[i];}else{img.onerror=null;}}catch(e){img.onerror=null;}})(this)">
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
                    <div class="share-icons share-icons-exact">
                        <a href="https://t.me/share/url?url=${shareUrl}&text=${shareText}" target="_blank" rel="noopener noreferrer" class="share-icon telegram" title="Share on Telegram" aria-label="Telegram">${shareSvg.telegram}</a>
                        <a href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" target="_blank" rel="noopener noreferrer" class="share-icon linkedin" title="Share on LinkedIn" aria-label="LinkedIn">${shareSvg.linkedin}</a>
                        <a href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener noreferrer" class="share-icon facebook" title="Share on Facebook" aria-label="Facebook">${shareSvg.facebook}</a>
                        <a href="https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}" target="_blank" rel="noopener noreferrer" class="share-icon x" title="Share on X" aria-label="X">${shareSvg.x}</a>
                        <a href="mailto:?subject=${shareTitle}&body=${shareText}%20${shareUrl}" class="share-icon email" title="Share via Email" aria-label="Email">${shareSvg.email}</a>
                    </div>
                </div>
            </div>
            <div class="header-separator"></div>
            ${urgentWarning}

            <div class="job-detail-section job-apply-section">
                <h3>Apply</h3>
                <p>Apply through the organization’s official/source page. The application action below opens the source website.</p>
                ${applyCta}
                ${job.applicationInstructions ? `<div style="margin-top:1rem"><h4 style="margin:.5rem 0 .25rem">Application Instructions</h4><div class="job-detail-pre">${esc(job.applicationInstructions)}</div></div>` : ''}
            </div>

            <div class="job-detail-section">
                <h3>All Job Details</h3>
                <div class="job-detail-fields">${fieldHtml || '<div class="job-detail-field"><strong>Details</strong><span>See the full description and source link below.</span></div>'}</div>
            </div>

            <div class="job-detail-section">
                <h3>Full Job Description</h3>
                <div class="job-detail-fulltext">${esc(desc).replace(/\n/g,'<br>')}</div>
            </div>

            ${req ? `<div class="job-detail-section"><h3>Requirements / Qualifications</h3><div class="job-detail-fulltext">${esc(req).replace(/\n/g,'<br>')}</div></div>` : ''}
            ${job.educationRequirements ? `<div class="job-detail-section"><h3>Education Requirements</h3><div class="job-detail-fulltext">${esc(job.educationRequirements)}</div></div>` : ''}
            ${job.experienceRequirements ? `<div class="job-detail-section"><h3>Experience Requirements</h3><div class="job-detail-fulltext">${esc(job.experienceRequirements)}</div></div>` : ''}
            ${skills.length ? `<div class="job-detail-section"><h3>Required Skills</h3><p>${esc(skills.join(', '))}</p></div>` : ''}

            <div class="job-detail-section">
                <h3>Source</h3>
                ${job.sourceName ? `<p><strong>Source:</strong> ${esc(job.sourceName)}</p>` : ''}
                ${job.lastVerifiedAt ? `<p><strong>Last verified:</strong> ${esc(_fmtDate(job.lastVerifiedAt))}</p>` : ''}
                ${orgLink ? `<p><strong>Official vacancy/application URL:</strong> <a href="${esc(orgLink)}" target="_blank" rel="noopener noreferrer">${esc(orgLink)}</a></p>` : ''}
                <p><small>Always verify details on the organization’s official page before applying.</small></p>
            </div>

            <div style="margin-top: 2rem;display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;">
                ${applyHref ? `<a class="btn-apply-source" href="${esc(applyHref)}"${applyTarget}>${orgLink ? 'Apply on Source Website' : 'Contact Organization'}</a>` : ''}
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
