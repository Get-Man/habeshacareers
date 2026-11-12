// Habesha Careers — premium job details page.
// Public data only: the API mapper never returns discovery-source fields, and
// the apply action uses the validated employer destination (never a listing page).
(function () {
  'use strict';

  const state = { job: null, related: [] };

  function esc(s) {
    return (window.HabeshaUI && window.HabeshaUI.escHtml)
      ? window.HabeshaUI.escHtml(s)
      : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function icon(name, cls) {
    const paths = {
      pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
      briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
      building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/>',
      wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
      graduation: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
      bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
      arrow: '<path d="m9 18 6-6-6-6"/>',
      alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'
    };
    return `<svg class="jd-icon ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  function fmtDate(value) {
    if (!value) return 'Not specified';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function daysLeft(deadline) {
    if (!deadline) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(`${String(deadline).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(target.getTime())) return null;
    return Math.ceil((target - today) / 86400000);
  }

  function stripNoise(text) {
    let t = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const markers = [
      /\n\s*Apply for this job\b[\s\S]*$/i,
      /\n\s*Autofill my application\b[\s\S]*$/i,
      /\n\s*\*\s*indicates a required field\b[\s\S]*$/i,
      /\n\s*Submit application\b[\s\S]*$/i,
      /\n\s*Powered by Greenhouse\b[\s\S]*$/i,
      /\n\s*Create a Job Alert\b[\s\S]*$/i,
      /\n\s*Apply on the employer['’]s application page\b[\s\S]*$/i,
      /\n\s*View advert\s*&\s*apply\b[\s\S]*$/i,
      /\n\s*Related open jobs\b[\s\S]*$/i,
      /\n\s*Your friend in the job hunt\.?[\s\S]*$/i,
      /\n\s*We use Google Analytics cookies[\s\S]*$/i,
      /\n\s*Find jobs Post a job Employers\b[\s\S]*$/i
    ];
    for (const re of markers) t = t.replace(re, '\n');
    return t.replace(/^\s*(?:←\s*)?All open jobs\s*/i, '').trim();
  }

  // Escape-first formatter: headings, paragraphs and bullet lists only.
  function formatPostText(text) {
    const raw = stripNoise(text);
    if (!raw) return '';
    const lines = raw.split('\n');
    const blocks = [];
    let para = [];
    let list = null;
    const flushPara = () => {
      if (!para.length) return;
      blocks.push(`<p>${esc(para.join(' ').replace(/\s+/g, ' ').trim())}</p>`);
      para = [];
    };
    const flushList = () => {
      if (!list || !list.items.length) { list = null; return; }
      blocks.push(`<${list.type}>${list.items.map((li) => `<li>${esc(li)}</li>`).join('')}</${list.type}>`);
      list = null;
    };
    for (const line of lines) {
      const t = line.trim();
      if (!t) { flushPara(); flushList(); continue; }
      const bullet = t.match(/^([•●▪◦*–—-]|\(?\d{1,3}[.)]\)?)\s+(.*)$/);
      if (bullet) {
        flushPara();
        const type = /^\d/.test(bullet[1]) ? 'ol' : 'ul';
        if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
        list.items.push(bullet[2].trim());
        continue;
      }
      const isHeading = t.length <= 90 && (/[:：]$/.test(t) || (/^[A-Z0-9][A-Z0-9\s/&(),.+-]{2,}$/.test(t) && /[A-Z]/.test(t)));
      if (isHeading) {
        flushPara(); flushList();
        blocks.push(`<h4>${esc(t.replace(/[:：]$/, ''))}</h4>`);
        continue;
      }
      flushList();
      para.push(t);
    }
    flushPara(); flushList();
    return blocks.join('\n') || `<p>${esc(raw)}</p>`;
  }

  function logoList(job) {
    if (window.HabeshaUI && window.HabeshaUI.logoCandidates) return window.HabeshaUI.logoCandidates(job);
    return [job.logo || (window.HabeshaUI && window.HabeshaUI.orgLogoDataUri ? window.HabeshaUI.orgLogoDataUri(job.company) : '')].filter(Boolean);
  }

  function logoImg(job, cls) {
    const list = logoList(job);
    const first = list[0] || '';
    return `<img class="${cls || 'jd-logo'}" src="${esc(first)}" data-logos="${esc(JSON.stringify(list))}" data-logo-idx="0" alt="${esc(job.company || 'Organization')} logo" onerror="window.HabeshaUI&&window.HabeshaUI.nextLogo?window.HabeshaUI.nextLogo(this):(this.onerror=null)">`;
  }

  function chips(job) {
    const items = [
      ['pin', job.location || job.regionCity],
      ['briefcase', job.type],
      ['building', job.category],
      ['users', job.vacancies ? `${job.vacancies} position${Number(job.vacancies) === 1 ? '' : 's'}` : null]
    ];
    return items.filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([ic, v]) => `<span class="jd-chip">${icon(ic)}${esc(v)}</span>`).join('');
  }

  function applyDetails(job) {
    const email = job.applicationEmail || job.contactEmail;
    if (job.applyUrl) {
      return {
        href: job.applyUrl,
        external: true,
        label: 'Apply for this job',
        note: job.applyUrlVerified
          ? 'Application link verified'
          : 'Application link not independently verified — confirm with the employer'
      };
    }
    if (email) {
      const subject = encodeURIComponent(`Application for ${job.title || 'position'}`);
      return { href: `mailto:${email}?subject=${subject}`, external: false, label: 'Apply by email', note: 'Sends your application directly to the employer' };
    }
    return null;
  }

  function applyButton(job, extraClass) {
    const a = applyDetails(job);
    if (!a) return `<div class="jd-apply-unavailable">${icon('alert')} Application link is under review. See the application instructions below.</div>`;
    const target = a.external ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
    return `<a class="jd-apply-btn ${extraClass || ''}" href="${esc(a.href)}"${target}>${icon('arrow')} ${esc(a.label)}</a>`;
  }

  function renderLoading(container) {
    container.innerHTML = `
      <div class="jd-loading" aria-busy="true" aria-live="polite">
        <div class="jd-skeleton jd-skeleton-hero"></div>
        <div class="jd-grid">
          <div class="jd-main"><div class="jd-skeleton"></div><div class="jd-skeleton jd-skeleton-lg"></div><div class="jd-skeleton"></div></div>
          <div class="jd-sidebar"><div class="jd-skeleton"></div></div>
        </div>
        <span class="jd-loading-label">Loading job details…</span>
      </div>`;
  }

  function renderError(container, message) {
    container.innerHTML = `
      <div class="jd-empty">
        <div class="jd-empty-icon">${icon('alert')}</div>
        <h2>We couldn't load this job</h2>
        <p>${esc(message || 'The vacancy may have expired or been removed.')}</p>
        <a class="jd-apply-btn" href="jobs.html">Browse current jobs</a>
      </div>`;
  }

  function renderJob(container, job, related) {
    const days = daysLeft(job.deadline);
    const apply = applyDetails(job);
    const verifiedBadge = job.organizationVerified ? `<span class="jd-verified">${icon('check')} Verified employer</span>` : '';
    const skills = Array.isArray(job.requiredSkills) ? job.requiredSkills.filter(Boolean) : [];
    const deadlineClass = days != null && days <= 7 && days >= 0 ? 'urgent' : '';
    const deadlineValue = job.deadline ? `${fmtDate(job.deadline)}${days != null && days >= 0 ? ` · ${days} day${days === 1 ? '' : 's'} left` : ''}` : 'Not specified';
    const shareUrl = encodeURIComponent(location.origin + (job.publicPath || `/job/${job.id}`));
    const shareTitle = encodeURIComponent(`${job.title} at ${job.company || 'Habesha Careers'}`);

    const overview = [
      ['pin', 'Location', job.location || job.regionCity || 'Ethiopia'],
      ['briefcase', 'Employment type', job.type],
      ['calendar', 'Application deadline', deadlineValue],
      ['wallet', 'Salary', job.salary],
      ['graduation', 'Education', job.educationRequirements],
      ['clock', 'Experience', job.experienceRequirements]
    ].filter(([, , v]) => v != null && String(v).trim() !== '').map(([ic, label, value]) => `
      <div class="jd-overview-card">
        <span class="jd-overview-icon">${icon(ic)}</span>
        <div><span class="jd-overview-label">${esc(label)}</span><strong>${esc(value)}</strong></div>
      </div>`).join('');

    const relatedHtml = related && related.length ? `
      <section class="jd-related">
        <h2>Similar jobs</h2>
        <div class="jd-related-grid">
          ${related.map((r) => `
            <a class="jd-related-card" href="${esc(r.publicPath || `job-details.html?id=${encodeURIComponent(r.id)}`)}">
              <span class="jd-related-title">${esc(r.title)}</span>
              <span class="jd-related-company">${esc(r.company || 'Organization not verified')}</span>
              <span class="jd-related-meta">${esc(r.location || r.regionCity || 'Ethiopia')} · ${esc(r.type || 'Full-time')}</span>
            </a>`).join('')}
        </div>
      </section>` : '';

    container.innerHTML = `
      <article class="jd-article">
        <header class="jd-hero">
          <div class="jd-hero-main">
            ${logoImg(job)}
            <div class="jd-hero-text">
              <h1 class="jd-title">${esc(job.title)}</h1>
              <p class="jd-company">${esc(job.company || 'Organization not verified')} ${verifiedBadge}</p>
              <div class="jd-chips">${chips(job)}</div>
            </div>
          </div>
          <button type="button" class="jd-save-btn" onclick="toggleSaveJob('${esc(String(job.id))}')" aria-pressed="false" title="Save this job">
            ${icon('bookmark')}<span>Save</span>
          </button>
        </header>

        <div class="jd-grid">
          <div class="jd-main">
            <section class="jd-card">
              <h2>Overview</h2>
              <div class="jd-overview">${overview}</div>
            </section>

            <section class="jd-card">
              <h2>Job description</h2>
              <div class="jd-body">${formatPostText(job.description) || '<p>Full description is available from the employer’s application page.</p>'}</div>
            </section>

            <section class="jd-card">
              <h2>Requirements &amp; qualifications</h2>
              <div class="jd-body">${job.requirements && !job.requirementsMissing ? formatPostText(job.requirements) : '<p>Not specified in the announcement.</p>'}</div>
              ${skills.length ? `<h3 class="jd-subhead">Required skills</h3><div class="jd-body"><ul>${skills.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
            </section>

            ${job.applicationInstructions ? `<section class="jd-card"><h2>How to apply</h2><div class="jd-body">${formatPostText(job.applicationInstructions)}</div></section>` : ''}

            <section class="jd-card jd-before">
              <h2>Before you apply</h2>
              <div class="jd-body">
                <p>Habesha Careers lists this opportunity for discovery. Always confirm the role, deadline and requirements with the hiring organization before sharing personal information.</p>
                ${job.lastVerifiedAt ? `<p><small>Listing last checked ${esc(fmtDate(job.lastVerifiedAt))}.</small></p>` : ''}
              </div>
            </section>
          </div>

          <aside class="jd-sidebar" aria-label="Application and job details">
            <section class="jd-card jd-apply-card">
              ${applyButton(job)}
              ${apply ? `<p class="jd-apply-note">${esc(apply.note)}</p>` : ''}
              <div class="jd-share">
                <span>${icon('share')} Share</span>
                <a href="https://t.me/share/url?url=${shareUrl}&text=${shareTitle}" target="_blank" rel="noopener noreferrer" aria-label="Share on Telegram">Telegram</a>
                <a href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn">LinkedIn</a>
                <a href="https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareTitle}" target="_blank" rel="noopener noreferrer" aria-label="Share on X">X</a>
              </div>
            </section>

            <section class="jd-card">
              <h2>Job details</h2>
              <ul class="jd-facts">
                <li><span>Deadline</span><strong class="jd-deadline ${deadlineClass}">${esc(job.deadline ? fmtDate(job.deadline) : 'Not specified')}</strong></li>
                <li><span>Posted</span><strong>${esc(job.postedDate ? fmtDate(job.postedDate) : 'Not specified')}</strong></li>
                <li><span>Job type</span><strong>${esc(job.type || 'Not specified')}</strong></li>
                <li><span>Location</span><strong>${esc(job.location || job.regionCity || 'Ethiopia')}</strong></li>
                <li><span>Vacancies</span><strong>${esc(job.vacancies || 1)}</strong></li>
                ${job.category ? `<li><span>Category</span><strong>${esc(job.category)}</strong></li>` : ''}
                ${job.jobReference ? `<li><span>Reference</span><strong>${esc(job.jobReference)}</strong></li>` : ''}
              </ul>
            </section>
          </aside>
        </div>

        ${relatedHtml}
      </article>
      <div class="jd-mobile-apply">${applyButton(job)}</div>
    `;

    // Reflect saved state.
    try {
      const saved = JSON.parse(localStorage.getItem('savedJobs') || '[]').map(String);
      const btn = container.querySelector('.jd-save-btn');
      if (btn && saved.includes(String(job.id))) {
        btn.classList.add('saved');
        btn.setAttribute('aria-pressed', 'true');
        btn.querySelector('span').textContent = 'Saved';
      }
    } catch { /* ignore */ }
  }

  function setMeta(selector, attr, value) {
    let el = document.head.querySelector(selector);
    if (!el) {
      el = document.createElement('meta');
      if (selector.includes('property=')) el.setAttribute('property', selector.match(/property="([^"]+)"/)[1]);
      else el.setAttribute('name', selector.match(/name="([^"]+)"/)[1]);
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  }

  function applySeo(job) {
    const origin = location.origin;
    const canonical = origin + (job.publicPath || `/job/${job.id}`);
    const description = String(job.description || '').replace(/\s+/g, ' ').trim().slice(0, 158) || `Apply for ${job.title} at ${job.company} on Habesha Careers.`;
    const image = /^https?:\/\//i.test(job.logo || '') ? job.logo : `${origin}/images/logo.png`;

    document.title = `${job.title} at ${job.company || 'Habesha Careers'} | Habesha Careers`;
    setMeta('meta[name="description"]', 'content', description);

    let canonicalEl = document.head.querySelector('link[rel="canonical"]');
    if (!canonicalEl) {
      canonicalEl = document.createElement('link');
      canonicalEl.rel = 'canonical';
      document.head.appendChild(canonicalEl);
    }
    canonicalEl.href = canonical;

    setMeta('meta[property="og:type"]', 'content', 'article');
    setMeta('meta[property="og:site_name"]', 'content', 'Habesha Careers');
    setMeta('meta[property="og:title"]', 'content', `${job.title} at ${job.company || 'Habesha Careers'}`);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:url"]', 'content', canonical);
    setMeta('meta[property="og:image"]', 'content', image);
    setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    setMeta('meta[name="twitter:title"]', 'content', `${job.title} at ${job.company || 'Habesha Careers'}`);
    setMeta('meta[name="twitter:description"]', 'content', description);
    setMeta('meta[name="twitter:image"]', 'content', image);

    const old = document.getElementById('jobStructuredData');
    if (old) old.remove();
    if (!job.jsonLdEligible) return;

    const data = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: job.title,
      description: String(job.description || '').slice(0, 12000),
      datePosted: job.postedDate || undefined,
      validThrough: job.deadline || undefined,
      employmentType: job.type || undefined,
      hiringOrganization: { '@type': 'Organization', name: job.company },
      jobLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: job.regionCity || job.location || 'Addis Ababa',
          addressCountry: 'ET'
        }
      },
      identifier: { '@type': 'PropertyValue', name: 'Habesha Careers', value: String(job.id) },
      url: canonical,
      directApply: !!job.applyUrl,
      industry: job.category || undefined
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'jobStructuredData';
    script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    document.head.appendChild(script);
  }

  async function load(jobId) {
    const container = document.getElementById('jobDetailsContent');
    if (!container) return;
    renderLoading(container);

    let job = null;
    let related = [];
    let failure = null;

    try {
      if (window.JobsApi && typeof window.JobsApi.fetch === 'function') {
        const data = await window.JobsApi.fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (data && data.ok && data.job) {
          job = data.job;
          related = Array.isArray(data.related) ? data.related : [];
        }
      }
    } catch (e) {
      failure = e;
    }

    if (!job && typeof getJobById === 'function') {
      try { job = getJobById(jobId); } catch { /* ignore */ }
    }

    if (!job) {
      const expired = failure && failure.status === 404;
      renderError(container, expired ? 'This vacancy is no longer available. It may have expired or been removed.' : 'Please check your connection and try again.');
      return;
    }

    state.job = job;
    state.related = related;
    window.__currentJob = job;
    renderJob(container, job, related);
    applySeo(job);
  }

  function resolveJobId() {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('id');
    if (fromQuery) return fromQuery;
    const m = location.pathname.match(/\/job\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const id = resolveJobId();
    if (id) load(id);
    else renderError(document.getElementById('jobDetailsContent'), 'No job was selected.');
  });

  // Kept for compatibility with any inline handlers elsewhere on the site.
  window.toggleSaveJob = function (jobId) {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('savedJobs') || '[]').map(String); } catch { saved = []; }
    const idx = saved.indexOf(String(jobId));
    const btn = document.querySelector('.jd-save-btn');
    if (idx >= 0) {
      saved.splice(idx, 1);
      if (btn) { btn.classList.remove('saved'); btn.setAttribute('aria-pressed', 'false'); const s = btn.querySelector('span'); if (s) s.textContent = 'Save'; }
    } else {
      saved.push(String(jobId));
      if (btn) { btn.classList.add('saved'); btn.setAttribute('aria-pressed', 'true'); const s = btn.querySelector('span'); if (s) s.textContent = 'Saved'; }
    }
    localStorage.setItem('savedJobs', JSON.stringify(saved));
  };
})();
