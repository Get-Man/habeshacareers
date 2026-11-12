// Habesha Careers admin dashboard.
// Source identity and extraction internals are visible here only; public
// surfaces never receive these fields from the API mapper.
const AdminApp = {
  currentReviewId: null,
  candidatesById: {},
  key() { return sessionStorage.getItem('habesha_admin_key') || ''; },
  saveKey() {
    const v = document.getElementById('adminKey').value.trim();
    if (v) sessionStorage.setItem('habesha_admin_key', v);
    this.msg('Admin key saved for this tab.');
    this.refreshAll();
  },
  msg(t, err = false) {
    const el = document.getElementById('adminMsg');
    if (!el) return;
    el.textContent = t;
    el.style.color = err ? '#b91c1c' : '#475569';
  },
  async api(path, opts = {}) {
    const key = this.key();
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (key) headers['x-admin-key'] = key;
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...opts,
      headers
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || ('HTTP ' + res.status));
    return data;
  },
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  num(v) { return v == null || v === '' ? 0 : Number(v) || 0; },
  pill(s) {
    const raw = String(s || '').toLowerCase().replace(/\s+/g, '_');
    return `<span class="pill status-${this.esc(raw)}">${this.esc(s || '')}</span>`;
  },
  short(s, n = 60) {
    const v = String(s == null ? '' : s);
    return v.length > n ? v.slice(0, n - 1) + '…' : v;
  },
  showTab(name) {
    document.querySelectorAll('.admin-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    document.querySelectorAll('.admin-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'review') this.loadReview();
    if (name === 'audit') this.loadAudit();
    if (name === 'sources') this.loadSources();
    if (name === 'employers') this.loadEmployers();
    if (name === 'runs') { this.loadRuns(); this.loadSubs(); }
    if (name === 'jobs') this.loadJobs();
  },
  async refreshAll() {
    await Promise.allSettled([
      this.loadStats(), this.loadSources(), this.loadRuns(), this.loadSubs(),
      this.loadJobs(), this.loadReview(), this.loadExtraction(), this.loadAudit()
    ]);
  },

  async loadStats() {
    try {
      const { stats } = await this.api('/api/admin/stats');
      const t = stats.totals || {};
      const q = stats.queue || {};
      const ex = stats.extraction || {};
      const src = stats.sources || {};
      const runs = stats.runs24h || {};
      const apply = stats.apply || {};
      const cards = [
        ['Total listings', t.total, `${stats.newToday || 0} new today`],
        ['Active vacancies', t.active, `${stats.newThisWeek || 0} this week`],
        ['Pending', t.pending, 'awaiting publication'],
        ['Needs review', t.needs_review, 'quality flags'],
        ['Expired', t.expired, 'not publicly listed'],
        ['Missing apply link', t.missing_apply, 'needs correction'],
        ['Verified apply links', t.apply_verified, `avg confidence ${apply.avg_confidence ?? 0}%`],
        ['Organizations', t.organizations, `${t.org_unverified || 0} unverified`],
        ['Duplicates queued', stats.duplicates, 'merge queue'],
        ['Sources enabled', `${src.enabled ?? 0}/${src.total ?? 0}`, `${src.stale ?? 0} stale >24h`],
        ['Failed sources', src.failed, 'error / blocked'],
        ['Sync success 24h', runs.successRate == null ? '—' : `${runs.successRate}%`, `${runs.ok || 0} ok / ${runs.failed || 0} failed`],
        ['Queue pending', q.pending, `${q.failed || 0} failed`],
        ['Extraction failed', ex.failed, `${ex.needs_manual_review || 0} manual review`]
      ];
      document.getElementById('statsCards').innerHTML = cards.map(([h, n, sub]) => `
        <div class="admin-card"><h4>${this.esc(h)}</h4><div class="n">${this.esc(n ?? 0)}</div>${sub ? `<div class="sub">${this.esc(sub)}</div>` : ''}</div>`).join('');
    } catch (e) { this.msg('Stats: ' + e.message, true); }
  },

  async loadExtraction() {
    try {
      const { queue, locks } = await this.api('/api/admin/extraction');
      const cards = [
        ['Pending', queue.pending], ['Extracting', queue.extracting], ['Extracted', queue.extracted],
        ['Failed', queue.failed], ['Skipped', queue.skipped], ['Duplicates', queue.duplicate], ['Queue total', queue.total]
      ];
      document.getElementById('queueCards').innerHTML = cards.map(([h, n]) => `
        <div class="admin-card"><h4>${this.esc(h)}</h4><div class="n">${this.num(n)}</div></div>`).join('');
      const tbody = document.querySelector('#locksTable tbody');
      tbody.innerHTML = locks.length ? locks.map((l) => `<tr>
        <td><code>${this.esc(l.lock_key)}</code></td><td>${this.esc(l.owner || '—')}</td>
        <td>${this.esc(this.fmtDate(l.locked_at))}</td><td>${this.esc(this.fmtDate(l.expires_at))}</td></tr>`).join('')
        : '<tr><td colspan="4" class="admin-empty">No active locks.</td></tr>';
    } catch (e) { this.msg('Extraction: ' + e.message, true); }
  },

  async requeueFailed() {
    this.msg('Requeueing failed discovery items…');
    try {
      const r = await this.api('/api/admin/extraction', { method: 'POST', body: JSON.stringify({ action: 'requeue', limit: 200 }) });
      this.msg(`Requeued ${r.requeued || 0} failed items.`);
      this.loadExtraction();
    } catch (e) { this.msg(e.message, true); }
  },

  async runExtraction() {
    this.msg('Running extraction batch…');
    try {
      const r = await this.api('/api/admin/extraction', { method: 'POST', body: JSON.stringify({ action: 'run' }) });
      this.msg('Extraction finished: ' + JSON.stringify(r.result || {}));
      this.refreshAll();
    } catch (e) { this.msg(e.message, true); }
  },

  async loadSources() {
    try {
      const { sources } = await this.api('/api/admin/sources');
      document.querySelector('#sourcesTable tbody').innerHTML = sources.map((s) => {
        const queue = `${this.num(s.queue_pending)}p / ${this.num(s.queue_failed)}f / ${this.num(s.queue_total)} total`;
        return `<tr>
          <td><strong>${this.esc(s.name)}</strong><br><small class="muted">${this.esc(s.slug)}</small><br><small class="muted">${this.esc(s.base_url || s.listing_url || '')}</small></td>
          <td><code>${this.esc(s.adapter_key || 'legacy')}</code></td>
          <td>${this.pill(s.integration_status)}<br><small class="muted">${this.esc(this.short(s.status_note || s.last_error || '', 90))}</small></td>
          <td>${s.enabled ? 'Yes' : 'No'}</td>
          <td>${this.esc(queue)}</td>
          <td>${this.num(s.listing_count)} <small class="muted">(${this.num(s.pending_count)} pending, ${this.num(s.missing_apply)} no apply)</small></td>
          <td>${this.esc(this.fmtDate(s.last_discovery_at || s.last_sync_at))}</td>
          <td class="admin-actions">
            <button class="btn-secondary" onclick="AdminApp.toggleSource('${this.esc(s.slug)}',${!s.enabled})">${s.enabled ? 'Disable' : 'Enable'}</button>
            <button class="btn-primary" onclick="AdminApp.syncSource('${this.esc(s.slug)}')">Sync</button>
          </td></tr>`;
      }).join('') || '<tr><td colspan="8" class="admin-empty">No sources configured.</td></tr>';
    } catch (e) { this.msg('Sources: ' + e.message, true); }
  },

  async toggleSource(slug, enabled) {
    try {
      await this.api('/api/admin/sources', { method: 'POST', body: JSON.stringify({ action: 'setEnabled', slug, enabled }) });
      this.loadSources();
    } catch (e) { alert(e.message); }
  },

  async syncSource(slug) {
    this.msg('Syncing ' + slug + '…');
    try {
      const r = await this.api('/api/admin/sync', { method: 'POST', body: JSON.stringify({ slug }) });
      this.msg('Sync result: ' + JSON.stringify(r.result || {}));
      this.refreshAll();
    } catch (e) { this.msg(e.message, true); }
  },

  async syncAll() {
    this.msg('Syncing enabled sources…');
    try {
      const r = await this.api('/api/admin/sync', { method: 'POST', body: '{}' });
      this.msg('Sync result: ' + JSON.stringify(r.result || {}));
      this.refreshAll();
    } catch (e) { this.msg(e.message, true); }
  },

  async loadRuns() {
    try {
      const { runs } = await this.api('/api/admin/runs');
      document.querySelector('#runsTable tbody').innerHTML = runs.map((r) => `<tr>
        <td>${this.esc(this.fmtDate(r.started_at))}</td>
        <td>${this.esc(r.source_name || r.source_slug || 'all')}</td>
        <td>${this.esc(r.trigger_type)}</td>
        <td>${this.pill(r.status)}</td>
        <td>${this.num(r.discovered_count)}</td>
        <td>${this.num(r.extracted_count)}</td>
        <td>${this.num(r.apply_found_count)}</td>
        <td>${this.num(r.needs_review_count)}</td>
        <td>${this.num(r.duplicate_count)}</td>
        <td>${this.num(r.error_count)}</td>
        <td>${r.duration_ms == null ? '—' : (r.duration_ms / 1000).toFixed(1) + 's'}</td>
        <td>${this.esc(this.short(r.message || r.last_error || '', 80))}</td></tr>`).join('')
        || '<tr><td colspan="12" class="admin-empty">No sync runs recorded.</td></tr>';
    } catch (e) { /* silent until key set */ }
  },

  async loadSubs() {
    try {
      const { submissions } = await this.api('/api/admin/submissions');
      document.querySelector('#subsTable tbody').innerHTML = submissions.map((s) => {
        const p = s.payload || {};
        return `<tr><td>${this.esc(s.id)}</td><td>${this.esc(p.company || s.organization_name)}</td>
          <td>${this.esc(p.title)}</td><td>${this.pill(s.approval_status)}</td>
          <td>${this.esc((s.created_at || '').slice(0, 10))}</td>
          <td class="admin-actions">${s.approval_status === 'pending'
            ? `<button class="btn-primary" onclick="AdminApp.approveSub(${this.esc(s.id)})">Approve</button>
               <button class="btn-secondary" onclick="AdminApp.rejectSub(${this.esc(s.id)})">Reject</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="admin-empty">No submissions.</td></tr>';
    } catch (e) { /* silent until key set */ }
  },

  async approveSub(id) {
    try {
      await this.api('/api/admin/submissions', { method: 'POST', body: JSON.stringify({ action: 'approve', id }) });
      this.refreshAll();
    } catch (e) { alert(e.message); }
  },

  async rejectSub(id) {
    const note = prompt('Reviewer note (optional)') || '';
    try {
      await this.api('/api/admin/submissions', { method: 'POST', body: JSON.stringify({ action: 'reject', id, note }) });
      this.refreshAll();
    } catch (e) { alert(e.message); }
  },

  async loadJobs() {
    try {
      const status = document.getElementById('jobStatusFilter').value;
      const { jobs } = await this.api('/api/admin/jobs' + (status ? `?status=${encodeURIComponent(status)}` : ''));
      document.querySelector('#jobsTable tbody').innerHTML = jobs.map((j) => `<tr>
        <td>${this.esc(j.id)}</td>
        <td><strong>${this.esc(j.title)}</strong><br><small class="muted">${this.esc(j.category || '')}</small></td>
        <td>${this.esc(j.company)}</td>
        <td>${this.esc(j.source_name || '—')}</td>
        <td>${this.pill(j.status)}</td>
        <td>${this.pill(j.review_status || 'unreviewed')}<br><small class="muted">${this.esc(j.extraction_status || '')}</small></td>
        <td>${j.apply_url ? `${this.pill(j.apply_url_verified ? 'verified' : 'unverified')}<br><small class="muted">${this.num(j.apply_url_confidence)}%</small>` : this.pill('missing')}</td>
        <td>${this.esc((j.deadline || '').slice(0, 10))}</td>
        <td class="admin-actions">
          <button class="btn-secondary" onclick="AdminApp.openReview(${this.esc(j.id)})">Review</button>
          <button class="btn-secondary" onclick="AdminApp.jobAction(${this.esc(j.id)},'${j.status === 'active' ? 'archive' : 'activate'}')">${j.status === 'active' ? 'Archive' : 'Activate'}</button>
          <button class="btn-secondary" onclick="AdminApp.jobAction(${this.esc(j.id)},'feature',${!j.featured})">${j.featured ? 'Unfeature' : 'Feature'}</button>
        </td></tr>`).join('') || '<tr><td colspan="9" class="admin-empty">No jobs match this filter.</td></tr>';
    } catch (e) { /* silent until key set */ }
  },

  async jobAction(id, action, featured) {
    try {
      await this.api('/api/admin/jobs', { method: 'POST', body: JSON.stringify({ id, action, featured }) });
      this.loadJobs();
      this.loadStats();
    } catch (e) { alert(e.message); }
  },

  async loadReview() {
    try {
      const status = document.getElementById('reviewFilter')?.value || '';
      const { jobs } = await this.api('/api/admin/review' + (status ? `?reviewStatus=${encodeURIComponent(status)}` : ''));
      const badge = document.getElementById('reviewCountBadge');
      if (badge) badge.textContent = String(jobs.length);
      document.querySelector('#reviewTable tbody').innerHTML = jobs.map((j) => `<tr>
        <td>${this.esc(j.id)}</td>
        <td><strong>${this.esc(j.title)}</strong><br><small class="muted">${this.esc(j.company || 'Organization not verified')}</small></td>
        <td>${this.esc(j.source_name || '—')}</td>
        <td>${this.pill(j.status)}<br><small class="muted">${this.esc(j.review_status || '')}</small></td>
        <td>${this.pill(j.extraction_status || 'unknown')}<br><small class="muted">quality ${this.num(j.quality_score)}</small></td>
        <td>${j.apply_url ? `${this.pill(j.apply_url_verified ? 'verified' : 'unverified')}<br><small class="muted">${this.esc(j.apply_url_type || '')} · ${this.num(j.apply_url_confidence)}%</small>` : this.pill('missing')}</td>
        <td>${this.num(j.candidate_count)}</td>
        <td class="admin-actions">
          <button class="btn-primary" onclick="AdminApp.openReview(${this.esc(j.id)})">Open</button>
          <button class="btn-secondary" onclick="AdminApp.retryReview(${this.esc(j.id)})">Retry</button>
        </td></tr>`).join('') || '<tr><td colspan="8" class="admin-empty">Nothing needs review.</td></tr>';
    } catch (e) { this.msg('Review: ' + e.message, true); }
  },

  async openReview(id) {
    this.currentReviewId = id;
    const box = document.getElementById('reviewDetail');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<p class="muted">Loading review detail…</p>';
    try {
      const data = await this.api('/api/admin/jobs?id=' + encodeURIComponent(id));
      const j = data.job || {};
      const candidates = data.candidates || [];
      const audit = data.audit || [];
      const kv = [
        ['Listing ID', j.id],
        ['Status', j.status],
        ['Review status', j.review_status || 'unreviewed'],
        ['Extraction', j.extraction_status || '—'],
        ['Employer', j.company || 'Organization not verified'],
        ['Organization verified', j.organization_verified ? 'Yes' : 'No'],
        ['Source (admin only)', `${j.source_name || '—'} (${j.source_slug || '—'})`],
        ['Listing page URL', j.listing_page_url],
        ['Original job URL', j.original_job_url || j.original_url],
        ['Canonical job URL', j.canonical_job_url],
        ['Apply URL', j.apply_url],
        ['Apply type', j.apply_url_type],
        ['Apply verified', j.apply_url_verified ? 'Yes' : 'No'],
        ['Apply confidence', j.apply_url_confidence == null ? '—' : j.apply_url_confidence + '%'],
        ['Quality score', j.quality_score],
        ['Deadline', j.deadline ? String(j.deadline).slice(0, 10) : '—'],
        ['Posted', j.posted_date ? String(j.posted_date).slice(0, 10) : '—'],
        ['Last verified', this.fmtDate(j.last_verified_at)]
      ];
      const urlFields = new Set(['Listing page URL', 'Original job URL', 'Canonical job URL', 'Apply URL']);
      const kvHtml = kv.map(([label, value]) => `<div><span>${this.esc(label)}</span><strong class="${urlFields.has(label) ? 'admin-url' : ''}">${this.esc(value == null || value === '' ? '—' : value)}</strong></div>`).join('');
      this.candidatesById = {};
      for (const c of candidates) this.candidatesById[c.id] = c.url;
      const candidateRows = candidates.length ? candidates.map((c) => `<tr>
        <td><span class="admin-url">${this.esc(c.url)}</span></td>
        <td>${this.pill(c.url_type || 'unknown')}</td>
        <td>${this.num(c.confidence)}%</td>
        <td>${this.esc(c.source || '—')}</td>
        <td>${this.esc(this.short(c.label || c.context || '', 70))}</td>
        <td>${this.pill(c.verified ? 'verified' : 'unverified')}</td>
        <td class="admin-actions"><button class="btn-secondary" onclick="AdminApp.useCandidate(${this.esc(c.id)})">Use</button></td></tr>`).join('')
        : '<tr><td colspan="7" class="admin-empty">No application candidates captured.</td></tr>';
      const auditRows = audit.length ? audit.map((a) => `<tr>
        <td>${this.esc(this.fmtDate(a.created_at))}</td><td>${this.esc(a.actor || 'admin')}</td>
        <td>${this.esc(a.action)}</td><td>${this.esc(a.field || '—')}</td>
        <td><span class="admin-url">${this.esc(this.short(a.old_value || '—', 50))} → ${this.esc(this.short(a.new_value || '—', 50))}</span></td>
        <td>${this.esc(a.note || '')}</td></tr>`).join('')
        : '<tr><td colspan="6" class="admin-empty">No audit entries yet.</td></tr>';

      box.innerHTML = `
        <div class="admin-toolbar">
          <h3>Review: ${this.esc(j.title || ('#' + id))}</h3>
          <button class="btn-secondary" onclick="AdminApp.closeReview()">Close</button>
        </div>
        <div class="admin-kv">${kvHtml}</div>
        <div class="admin-apply-row">
          <input id="manualApplyUrl" type="url" placeholder="https://employer.example/careers/apply/123 or mailto:jobs@employer.example" value="${this.esc(j.apply_url || '')}">
          <button class="btn-primary" onclick="AdminApp.saveApply(${this.esc(id)})">Save apply URL</button>
        </div>
        <textarea id="reviewNote" class="admin-note" placeholder="Reviewer note (recorded in audit trail)"></textarea>
        <div class="admin-actions" style="margin-bottom:1rem">
          <button class="btn-primary" onclick="AdminApp.approveReview(${this.esc(id)})">Approve &amp; publish</button>
          <button class="btn-secondary" onclick="AdminApp.rejectReview(${this.esc(id)})">Reject</button>
          <button class="btn-secondary" onclick="AdminApp.retryReview(${this.esc(id)})">Retry extraction</button>
        </div>
        <div class="admin-split">
          <div class="admin-sub">
            <h4>Application link candidates</h4>
            <div style="overflow:auto"><table class="admin-table"><thead><tr><th>URL</th><th>Type</th><th>Conf.</th><th>Source</th><th>Label</th><th>Verified</th><th></th></tr></thead><tbody>${candidateRows}</tbody></table></div>
          </div>
          <div class="admin-sub">
            <h4>Audit trail for this job</h4>
            <div style="overflow:auto"><table class="admin-table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Field</th><th>Change</th><th>Note</th></tr></thead><tbody>${auditRows}</tbody></table></div>
          </div>
        </div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      box.innerHTML = `<p class="muted">Could not load review detail: ${this.esc(e.message)}</p>`;
    }
  },

  closeReview() {
    const box = document.getElementById('reviewDetail');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    this.currentReviewId = null;
  },

  reviewNote() {
    return document.getElementById('reviewNote')?.value.trim() || '';
  },

  async saveApply(id, explicitUrl) {
    const url = explicitUrl || document.getElementById('manualApplyUrl')?.value.trim() || '';
    if (!url) return this.msg('Enter a valid employer application URL.', true);
    try {
      const r = await this.api('/api/admin/review', { method: 'POST', body: JSON.stringify({ action: 'apply', id, url, note: this.reviewNote() }) });
      this.msg(`Apply URL saved (${r.result?.applyUrlType || 'validated'}).`);
      this.openReview(id);
      this.loadReview();
      this.loadJobs();
      this.loadStats();
    } catch (e) { this.msg('Apply URL: ' + e.message, true); }
  },

  useCandidate(candidateId) {
    const url = this.candidatesById[candidateId];
    if (!url) return this.msg('Candidate not found — reload the review detail.', true);
    const input = document.getElementById('manualApplyUrl');
    if (input) input.value = url;
    this.msg('Candidate loaded into the apply URL field. Review it, then save.');
  },

  async approveReview(id) {
    try {
      await this.api('/api/admin/review', { method: 'POST', body: JSON.stringify({ action: 'approve', id, note: this.reviewNote() }) });
      this.msg('Job approved and published if eligible.');
      this.openReview(id);
      this.loadReview();
      this.loadJobs();
      this.loadStats();
    } catch (e) { this.msg(e.message, true); }
  },

  async rejectReview(id) {
    const note = this.reviewNote() || prompt('Reason for rejection (optional)') || '';
    try {
      await this.api('/api/admin/review', { method: 'POST', body: JSON.stringify({ action: 'reject', id, note }) });
      this.msg('Job rejected.');
      this.openReview(id);
      this.loadReview();
      this.loadJobs();
      this.loadStats();
    } catch (e) { this.msg(e.message, true); }
  },

  async retryReview(id) {
    try {
      await this.api('/api/admin/review', { method: 'POST', body: JSON.stringify({ action: 'retry', id }) });
      this.msg('Extraction retry queued.');
      this.openReview(id);
      this.loadReview();
      this.loadExtraction();
    } catch (e) { this.msg(e.message, true); }
  },

  async loadEmployers() {
    try {
      const q = (document.getElementById('employerSearch')?.value || '').trim();
      const { employers } = await this.api('/api/admin/employers?limit=200' + (q ? '&q=' + encodeURIComponent(q) : ''));
      document.querySelector('#employersTable tbody').innerHTML = employers.map((e) => {
        const logo = e.logo_public_url || '';
        const logoCell = logo
          ? `<img src="${this.esc(logo)}" alt="" width="34" height="34" style="border-radius:8px;object-fit:contain;border:1px solid #e5e7eb;background:#fff" onerror="this.style.visibility='hidden'">`
          : '<span class="muted">—</span>';
        return `<tr>
          <td>${this.esc(e.id)}</td>
          <td><strong>${this.esc(e.name)}</strong><br><small class="muted">${this.esc(e.name_key || '')}</small></td>
          <td>${e.website_url ? `<a href="${this.esc(e.website_url)}" target="_blank" rel="noopener noreferrer" class="admin-url">${this.esc(this.short(e.website_url, 46))}</a>` : '<span class="muted">—</span>'}</td>
          <td>${logoCell}</td>
          <td>${this.pill(e.logo_verified ? 'verified' : 'unverified')}<br><small class="muted">${this.esc(e.logo_source || 'none')} · ${this.num(e.logo_confidence)}%</small></td>
          <td>${this.num(e.active_count)} <small class="muted">/ ${this.num(e.listing_count)}</small></td>
          <td class="admin-actions"><button class="btn-secondary" onclick="AdminApp.editEmployer(${this.esc(e.id)})">Set logo</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="admin-empty">No organisations yet.</td></tr>';
    } catch (e) { this.msg('Employers: ' + e.message, true); }
  },

  editEmployer(id) {
    const logo = prompt('Official logo URL for this organisation (https://...):\nLeave empty to clear it.', '');
    if (logo === null) return;
    const website = prompt('Official website URL (optional, https://...):', '');
    if (website === null) return;
    const payload = { id, logoUrl: logo.trim() || null };
    if (website.trim()) payload.websiteUrl = website.trim();
    this.api('/api/admin/employers', { method: 'POST', body: JSON.stringify(payload) })
      .then(() => { this.msg('Organisation updated.'); this.loadEmployers(); })
      .catch((e) => this.msg(e.message, true));
  },

  async loadAudit() {
    try {
      const { audit } = await this.api('/api/admin/audit?limit=150');
      document.querySelector('#auditTable tbody').innerHTML = audit.map((a) => `<tr>
        <td>${this.esc(this.fmtDate(a.created_at))}</td>
        <td>${this.esc(a.listing_title || (a.listing_id ? '#' + a.listing_id : '—'))}</td>
        <td>${this.esc(a.actor || 'admin')}</td>
        <td>${this.pill(a.action)}</td>
        <td>${this.esc(a.field || '—')}</td>
        <td><span class="admin-url">${this.esc(this.short(a.old_value || '—', 50))} → ${this.esc(this.short(a.new_value || '—', 50))}</span></td>
        <td>${this.esc(this.short(a.note || '', 70))}</td></tr>`).join('')
        || '<tr><td colspan="7" class="admin-empty">No audit entries yet.</td></tr>';
    } catch (e) { /* silent until key set */ }
  }
};
window.AdminApp = AdminApp;
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('adminKey').value = AdminApp.key();
  if (AdminApp.key()) AdminApp.refreshAll();
});
