// Habesha Careers — page controllers.
// Every controller is registered through window.App.onPage. The core runtime
// owns the shell, session, guards, navigation and shared job card markup.
(function () {
  'use strict';

  var App = window.App;
  if (!App || typeof App.onPage !== 'function') return;

  // ---------------------------------------------------------------------------
  // Shared helpers (null-safe DOM access, escaped output, neutral messaging)
  // ---------------------------------------------------------------------------

  function byId(id) {
    return id ? document.getElementById(id) : null;
  }

  function qs(selector, root) {
    try {
      return App.qs ? App.qs(selector, root) : (root || document).querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  function qsa(selector, root) {
    try {
      return App.qsa ? App.qsa(selector, root) : Array.prototype.slice.call((root || document).querySelectorAll(selector));
    } catch (e) {
      return [];
    }
  }

  function esc(value) {
    return App.esc ? App.esc(value) : String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function text(id, value) {
    var node = byId(id);
    if (node) node.textContent = value == null ? '' : String(value);
  }

  function val(id) {
    var node = byId(id);
    return node ? String(node.value == null ? '' : node.value) : '';
  }

  function setVal(id, value) {
    var node = byId(id);
    if (node) node.value = value == null ? '' : String(value);
  }

  function show(id, visible) {
    var node = byId(id);
    if (node) node.hidden = !visible;
  }

  function message(id, content, type) {
    var node = byId(id);
    var kind = type === 'success' ? 'success' : type === 'info' ? 'info' : 'error';
    if (!node) {
      if (content) App.toast(content, kind);
      return;
    }
    node.textContent = content == null ? '' : String(content);
    node.className = 'alert alert-' + kind;
    node.hidden = !content;
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function errMsg(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (err.code === 'db_unavailable') return 'This service is temporarily unavailable. Please try again in a moment.';
    var data = err.data;
    if (data && data.message) return String(data.message);
    if (data && data.error) return String(data.error).replace(/_/g, ' ');
    return err.message ? String(err.message) : 'Something went wrong. Please try again.';
  }

  function jobsFetch(path, options) {
    if (App.JobsApi && typeof App.JobsApi.fetch === 'function') return App.JobsApi.fetch(path, options);
    return App.api(path, options);
  }

  function cachedJobs() {
    try {
      return App.getAllJobs ? (App.getAllJobs() || []) : [];
    } catch (e) {
      return [];
    }
  }

  function currentUser() {
    try {
      return App.getUser ? App.getUser() : null;
    } catch (e) {
      return null;
    }
  }

  function userRole(user) {
    return (user && (user.role || user.type)) || 'employee';
  }

  function displayName(user) {
    return (user && (user.name || user.fullName || user.contactName || user.companyName || user.company || user.email)) || 'there';
  }

  function fmtDate(value) {
    if (!value) return 'Not specified';
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    try {
      return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return String(value).slice(0, 10);
    }
  }

  function daysLeft(deadline) {
    if (!deadline) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var target = new Date(String(deadline).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(target.getTime())) return null;
    return Math.ceil((target - today) / 86400000);
  }

  function jobCard(job) {
    if (typeof App.jobCard === 'function') return App.jobCard(job);
    var item = job || {};
    var employer = item.organizationName || item.company || 'Organization not verified';
    var path = item.publicPath || ('job-details.html?id=' + encodeURIComponent(item.id || ''));
    var summary = String(item.summary || item.shortDescription || item.excerpt || item.description || '').replace(/\s+/g, ' ').trim();
    if (summary.length > 140) summary = summary.slice(0, 137).trimEnd() + '…';
    return '<article class="job-card">' +
      '<div class="job-card-header"><div class="job-card-title">' +
      '<h4><a href="' + esc(path) + '" class="job-card-link">' + esc(item.title || 'Untitled vacancy') + '</a></h4>' +
      '<p class="company">' + esc(employer) + '</p></div></div>' +
      '<div class="job-meta"><span>📍 ' + esc(item.location || item.regionCity || 'Not specified') + '</span>' +
      (item.type ? '<span>💼 ' + esc(item.type) + '</span>' : '') + '</div>' +
      (summary ? '<p class="job-card-excerpt">' + esc(summary) + '</p>' : '') +
      '<div class="job-card-actions"><a href="' + esc(path) + '" class="btn btn-primary btn-sm">View full job</a></div>' +
      '</article>';
  }

  function logoImage(job, className, alt) {
    var ui = App.HabeshaUI || {};
    var name = (job && (job.company || job.organizationName)) || '';
    var list = typeof ui.logoCandidates === 'function' ? ui.logoCandidates(job) : [];
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (src) { return !!src; });
    if (!list.length && typeof ui.orgLogoDataUri === 'function') list = [ui.orgLogoDataUri(name)];
    var first = list[0] || '';
    return '<img src="' + esc(first) + '" data-logos="' + esc(JSON.stringify(list)) + '" data-logo-idx="0" alt="' +
      esc(alt || name || 'Organization') + ' logo" class="' + esc(className || 'company-logo') + '">';
  }

  function storeHandoff(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (e) {
      /* storage can be disabled; navigation still works */
    }
  }

  function takeHandoff(key) {
    try {
      var value = localStorage.getItem(key);
      if (value != null) localStorage.removeItem(key);
      return value || '';
    } catch (e) {
      return '';
    }
  }

  function readSavedJobs() {
    try {
      var raw = JSON.parse(localStorage.getItem('savedJobs') || '[]');
      return Array.isArray(raw) ? raw.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function writeSavedJobs(ids) {
    try {
      localStorage.setItem('savedJobs', JSON.stringify(ids));
    } catch (e) {
      /* ignore storage failures */
    }
  }

  function safeNext(raw) {
    if (!raw || typeof raw !== 'string') return null;
    if (!/^[A-Za-z0-9._-]+\.html?$/i.test(raw)) return null;
    if (/^login\.html?$/i.test(raw)) return null;
    return raw;
  }

  function bindClick(selectorOrNode, handler, root) {
    var node = selectorOrNode;
    if (typeof node === 'string') {
      // Accept both CSS selectors and bare element IDs.
      node = /^[A-Za-z][\w-]*$/.test(node) ? (byId(node) || qs(node, root)) : qs(node, root);
    }
    if (node && typeof node.addEventListener === 'function') {
      node.addEventListener('click', handler);
    }
  }

  App.onPage('home', function homePage() {
    var categories = [
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

    var state = { stats: null, jobs: [] };

    function countsFromStats() {
      var map = {};
      var rows = state.stats && Array.isArray(state.stats.byCategory) ? state.stats.byCategory : [];
      rows.forEach(function (row) {
        if (row && row.category) map[String(row.category)] = Number(row.count) || 0;
      });
      return map;
    }

    function renderCategories() {
      var grid = byId('categoryGrid');
      if (!grid) return;
      var counts = countsFromStats();
      var jobs = state.jobs.length ? state.jobs : cachedJobs();
      grid.innerHTML = categories.map(function (cat) {
        var count = Object.prototype.hasOwnProperty.call(counts, cat.name)
          ? counts[cat.name]
          : jobs.filter(function (job) { return job && job.category === cat.name; }).length;
        return '<button type="button" class="category-card" data-category="' + esc(cat.name) + '">' +
          '<span class="icon" aria-hidden="true">' + esc(cat.icon) + '</span>' +
          '<h4>' + esc(cat.fullName) + '</h4>' +
          '<p class="vacancy-count">' + count + ' ' + (count === 1 ? 'job' : 'jobs') + '</p>' +
          '</button>';
      }).join('');
    }

    function renderStats() {
      var jobs = state.jobs.length ? state.jobs : cachedJobs();
      var stats = state.stats || {};
      var total = typeof stats.total === 'number' ? stats.total : jobs.length;
      var orgs = typeof stats.orgs === 'number'
        ? stats.orgs
        : new Set(jobs.map(function (job) { return String((job && job.company) || '').trim().toLowerCase(); }).filter(Boolean)).size;
      var cats = typeof stats.categories === 'number'
        ? stats.categories
        : new Set(jobs.map(function (job) { return String((job && job.category) || '').trim(); }).filter(Boolean)).size;
      var verified = typeof stats.verifiedOrgs === 'number'
        ? stats.verifiedOrgs
        : new Set(jobs.filter(function (job) { return job && job.organizationVerified; })
          .map(function (job) { return String(job.company || '').trim().toLowerCase(); }).filter(Boolean)).size;
      text('statJobs', total);
      text('statOrgs', orgs);
      text('statCategories', cats);
      text('statSources', verified);
      [['statJobs', 'Active Vacancies'], ['statOrgs', 'Partner Organisations'],
        ['statCategories', 'Categories Covered'], ['statSources', 'Verified Employers']].forEach(function (pair) {
        var label = byId(pair[0] + 'Label');
        if (label) label.textContent = pair[1];
        var number = byId(pair[0]);
        if (number) number.setAttribute('data-target', String(number.textContent));
      });
    }

    function renderRecent() {
      var list = byId('recentJobsList');
      if (!list) return;
      var jobs = (state.jobs.length ? state.jobs : cachedJobs()).slice().sort(function (a, b) {
        return String((b && (b.postedDate || b.created_at)) || '').localeCompare(String((a && (a.postedDate || a.created_at)) || ''));
      }).slice(0, 6);
      if (!jobs.length) {
        list.innerHTML = '<div class="empty-state">No active vacancies found right now. Check back soon or visit <a href="jobs.html">Browse Jobs</a>.</div>';
        return;
      }
      list.innerHTML = jobs.map(jobCard).join('');
    }

    function renderPartners() {
      var track = byId('partnersTrack');
      if (!track) return;
      var seen = {};
      var partners = [];
      var jobs = state.jobs.length ? state.jobs : cachedJobs();
      jobs.forEach(function (job) {
        var key = String((job && job.company) || '').trim().toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = true;
        partners.push({ name: job.company, job: job });
      });
      if (!partners.length) {
        track.innerHTML = '<div class="partner-logo partner-logo-empty">Partner logos will appear here as jobs are posted</div>';
        return;
      }
      var items = partners.map(function (partner) {
        return '<div class="partner-logo partner-logo-card" title="' + esc(partner.name) + '">' +
          logoImage(partner.job, 'partner-logo-img', partner.name) +
          '<span class="partner-logo-name">' + esc(partner.name) + '</span></div>';
      }).join('');
      track.innerHTML = partners.length > 3 ? items + items : items;
    }

    function renderAll() {
      renderCategories();
      renderStats();
      renderRecent();
      renderPartners();
    }

    function searchFrom(id) {
      var node = byId(id);
      var term = node ? String(node.value || '').trim() : '';
      storeHandoff('searchTerm', term);
      App.go('jobs.html');
    }

    function enterSearch(id) {
      var node = byId(id);
      if (!node) return;
      node.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          searchFrom(id);
        }
      });
    }

    var searchButton = qs('[data-search-submit]') || byId('homeSearchBtn');
    bindClick(searchButton, function () { searchFrom('homeSearch'); });
    enterSearch('homeSearch');
    enterSearch('recentJobsSearch');

    var grid = byId('categoryGrid');
    if (grid) {
      grid.addEventListener('click', function (event) {
        var card = event.target && event.target.closest ? event.target.closest('[data-category]') : null;
        if (!card || !grid.contains(card)) return;
        storeHandoff('filterCategory', card.getAttribute('data-category') || '');
        App.go('jobs.html');
      });
    }

    window.addEventListener('habesha:jobs-updated', function () {
      if (!state.stats) renderAll();
    });

    Promise.allSettled([
      jobsFetch('/api/jobs?meta=stats&limit=1'),
      jobsFetch('/api/jobs?limit=6')
    ]).then(function (results) {
      var statsResult = results[0];
      var jobsResult = results[1];
      if (statsResult && statsResult.status === 'fulfilled' && statsResult.value && statsResult.value.stats) {
        state.stats = statsResult.value.stats;
      }
      if (jobsResult && jobsResult.status === 'fulfilled' && jobsResult.value && Array.isArray(jobsResult.value.jobs)) {
        state.jobs = jobsResult.value.jobs;
      }
      renderAll();
    });
  });
  App.onPage('jobs', function jobsPage() {
    var PAGE_SIZE = 20;
    var state = { page: 1, total: 0, jobs: [] };

    function filterParams() {
      var params = new URLSearchParams({
        page: String(state.page),
        limit: String(PAGE_SIZE),
        brief: '1'
      });
      [['category', 'categoryFilter'], ['location', 'locationFilter'], ['type', 'typeFilter']].forEach(function (pair) {
        var value = val(pair[1]).trim();
        if (value) params.set(pair[0], value);
      });
      if (val('sortFilter') === 'deadline') params.set('sort', 'deadline');
      var search = val('jobSearch').trim();
      if (search) params.set('q', search);
      return params;
    }

    function filterCached() {
      var query = val('jobSearch').trim().toLowerCase();
      var category = val('categoryFilter');
      var location = val('locationFilter');
      var type = val('typeFilter');
      var list = cachedJobs().filter(function (job) {
        if (!job) return false;
        if (category && job.category !== category) return false;
        if (location && job.location !== location && job.regionCity !== location) return false;
        if (type && job.type !== type) return false;
        if (query) {
          var haystack = [job.title, job.company, job.organizationName, job.location, job.category, job.summary].join(' ').toLowerCase();
          if (haystack.indexOf(query) === -1) return false;
        }
        return true;
      });
      if (val('sortFilter') === 'deadline') {
        list.sort(function (a, b) {
          var left = App.getDaysUntilDeadline ? App.getDaysUntilDeadline(a) : daysLeft(a.deadline);
          var right = App.getDaysUntilDeadline ? App.getDaysUntilDeadline(b) : daysLeft(b.deadline);
          if (left == null) return right == null ? 0 : 1;
          if (right == null) return -1;
          return left - right;
        });
      }
      return list;
    }

    function renderJobs(list) {
      var container = byId('jobsList');
      if (!container) return;
      text('jobsCount', state.total + ' job(s) found');
      if (!list.length) {
        container.innerHTML = '<div class="empty-state"><h3>No jobs match your criteria</h3><p>Try a different keyword, category or location.</p></div>';
        return;
      }
      container.innerHTML = list.map(jobCard).join('');
    }

    function pageButton(label, page, options) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      var opts = options || {};
      if (opts.disabled) button.disabled = true;
      if (opts.active) button.className = 'active';
      if (page != null && !opts.disabled) {
        button.addEventListener('click', function () { goToPage(page); });
      }
      return button;
    }

    function renderPagination(totalPages) {
      var container = byId('pagination');
      if (!container) return;
      container.innerHTML = '';
      if (totalPages <= 1) return;

      container.appendChild(pageButton('← Prev', state.page - 1, { disabled: state.page === 1 }));

      var first = Math.max(1, state.page - 2);
      var last = Math.min(totalPages, first + 4);
      first = Math.max(1, last - 4);
      if (first > 1) {
        container.appendChild(pageButton('1', 1));
        if (first > 2) {
          var leading = document.createElement('span');
          leading.className = 'page-dots';
          leading.textContent = '…';
          container.appendChild(leading);
        }
      }
      for (var page = first; page <= last; page += 1) {
        container.appendChild(pageButton(String(page), page, { active: page === state.page }));
      }
      if (last < totalPages) {
        if (last < totalPages - 1) {
          var trailing = document.createElement('span');
          trailing.className = 'page-dots';
          trailing.textContent = '…';
          container.appendChild(trailing);
        }
        container.appendChild(pageButton(String(totalPages), totalPages));
      }

      container.appendChild(pageButton('Next →', state.page + 1, { disabled: state.page === totalPages }));
      var info = document.createElement('span');
      info.className = 'page-info';
      info.textContent = 'Page ' + state.page + ' of ' + totalPages;
      container.appendChild(info);
    }

    async function applyFilters() {
      text('jobsCount', 'Loading jobs…');
      try {
        var data = await jobsFetch('/api/jobs?' + filterParams().toString());
        if (!data || !Array.isArray(data.jobs)) throw new Error('Request failed');
        state.jobs = data.jobs;
        state.total = typeof data.total === 'number' ? data.total : data.jobs.length;
      } catch (err) {
        state.jobs = filterCached().slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
        state.total = filterCached().length;
        App.toast(errMsg(err), 'error');
      }
      renderJobs(state.jobs);
      renderPagination(Math.ceil(state.total / PAGE_SIZE));
    }

    function goToPage(page) {
      var totalPages = Math.ceil(state.total / PAGE_SIZE);
      if (page < 1 || (totalPages && page > totalPages)) return;
      state.page = page;
      applyFilters();
      var list = byId('jobsList');
      if (list && typeof list.scrollIntoView === 'function') {
        list.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function clearFilters() {
      setVal('categoryFilter', '');
      setVal('locationFilter', '');
      setVal('typeFilter', '');
      setVal('sortFilter', 'newest');
      setVal('jobSearch', '');
      state.page = 1;
      applyFilters();
    }

    var toggle = byId('filtersToggle');
    var layout = byId('jobsLayout');
    if (toggle && layout) {
      toggle.addEventListener('click', function () {
        var open = layout.classList.toggle('filters-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.textContent = open ? 'Hide Categories & Filters' : 'Categories & Filters';
      });
    }

    var savedSearch = takeHandoff('searchTerm');
    var savedCategory = takeHandoff('filterCategory');
    if (savedSearch) setVal('jobSearch', savedSearch);
    if (savedCategory) setVal('categoryFilter', savedCategory);

    bindClick('[data-filter-apply]', function () { state.page = 1; applyFilters(); });
    bindClick('[data-filter-clear]', clearFilters);
    bindClick('[data-search-submit]', function () { state.page = 1; applyFilters(); });
    ['categoryFilter', 'locationFilter', 'typeFilter', 'sortFilter'].forEach(function (id) {
      var node = byId(id);
      if (node) node.addEventListener('change', function () { state.page = 1; applyFilters(); });
    });
    var search = byId('jobSearch');
    if (search) {
      search.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          state.page = 1;
          applyFilters();
        }
      });
    }

    applyFilters();
  });
  App.onPage('job', function jobPage() {
    var state = { job: null, related: [] };

    function icon(name, cls) {
      var paths = {
        pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
        briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
        building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
        bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
        alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'
      };
      return '<svg class="jd-icon ' + esc(cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
    }

    function stripNoise(value) {
      var output = String(value == null ? '' : value).replace(/\r\n?/g, '\n');
      var markers = [
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
      markers.forEach(function (pattern) { output = output.replace(pattern, '\n'); });
      return output.replace(/^\s*(?:←\s*)?All open jobs\s*/i, '').trim();
    }

    function formatPostText(value) {
      var raw = stripNoise(value);
      if (!raw) return '';
      var blocks = [];
      var paragraph = [];
      var list = null;
      function flushParagraph() {
        if (!paragraph.length) return;
        blocks.push('<p>' + esc(paragraph.join(' ').replace(/\s+/g, ' ').trim()) + '</p>');
        paragraph = [];
      }
      function flushList() {
        if (!list || !list.items.length) { list = null; return; }
        blocks.push('<' + list.type + '>' + list.items.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</' + list.type + '>');
        list = null;
      }
      raw.split('\n').forEach(function (line) {
        var trimmed = line.trim();
        if (!trimmed) { flushParagraph(); flushList(); return; }
        var bullet = trimmed.match(/^([•●▪◦*–—-]|\(?\d{1,3}[.)]\)?)\s+(.*)$/);
        if (bullet) {
          flushParagraph();
          var type = /^\d/.test(bullet[1]) ? 'ol' : 'ul';
          if (!list || list.type !== type) { flushList(); list = { type: type, items: [] }; }
          list.items.push(bullet[2].trim());
          return;
        }
        var heading = trimmed.length <= 90 && (/[:：]$/.test(trimmed) ||
          (/^[A-Z0-9][A-Z0-9\s/&(),.+-]{2,}$/.test(trimmed) && /[A-Z]/.test(trimmed)));
        if (heading) {
          flushParagraph();
          flushList();
          blocks.push('<h4>' + esc(trimmed.replace(/[:：]$/, '')) + '</h4>');
          return;
        }
        flushList();
        paragraph.push(trimmed);
      });
      flushParagraph();
      flushList();
      return blocks.join('\n') || '<p>' + esc(raw) + '</p>';
    }

    var sectionIcons = {
      summary: '📝', responsibilities: '🎯', requirements: '🎓', experience: '💼',
      benefits: '🎁', location: '📍', salary: '💰', employmentType: '🗂️',
      howToApply: '📨', other: 'ℹ️'
    };

    function jobPostHtml(job) {
      var sections = Array.isArray(job.sections) ? job.sections : [];
      var fallback = formatPostText(job.description || job.descriptionHtml || '');
      if (!sections.length) {
        return fallback
          ? '<section class="jd-card"><h2>Job description</h2><div class="job-post-content">' + fallback + '</div></section>'
          : '<section class="jd-card"><h2>Job description</h2><p>Full description is not available for this vacancy. Please use the employer’s application details below.</p></section>';
      }
      var blocks = sections.map(function (section) {
        var paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs : [];
        var items = Array.isArray(section.items) ? section.items : [];
        return '<section class="job-post-section">' +
          '<h2 class="job-post-title"><span class="job-post-icon" aria-hidden="true">' +
          esc(sectionIcons[section.key] || '•') + '</span>' + esc(section.title || 'Details') + '</h2>' +
          '<div class="job-post-content">' +
          paragraphs.map(function (line) { return '<p>' + esc(line) + '</p>'; }).join('') +
          (items.length ? '<ul>' + items.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>' : '') +
          '</div></section>';
      }).join('');
      var rendered = '<div class="job-post">' + blocks + '</div>';
      if (rendered.replace(/<[^>]+>/g, '').trim().length < 20 && fallback) {
        return '<section class="jd-card"><h2>Job description</h2><div class="job-post-content">' + fallback + '</div></section>';
      }
      return rendered;
    }

    function applyDetails(job) {
      if (App.HabeshaUI && typeof App.HabeshaUI.applyInfo === 'function') return App.HabeshaUI.applyInfo(job) || {};
      var email = job.applicationEmail || job.contactEmail;
      if (job.applyUrl) {
        return {
          kind: 'third_party', url: job.applyUrl,
          badge: 'Third-party application', badgeClass: 'badge-third-party',
          note: job.applyUrlVerified ? 'Application link verified' : 'Application link not independently verified — confirm with the employer'
        };
      }
      if (email) {
        return {
          kind: 'email', url: 'mailto:' + email + '?subject=' + encodeURIComponent('Application for ' + (job.title || 'position')),
          badge: 'Application email', badgeClass: 'badge-neutral', note: 'Sends your application directly to the employer'
        };
      }
      return { kind: 'none', url: null, badge: '', badgeClass: '', note: '' };
    }

    function applyButton(job) {
      if (App.HabeshaUI && typeof App.HabeshaUI.applyButtonHtml === 'function') {
        return App.HabeshaUI.applyButtonHtml(job, 'jd-apply-btn--end');
      }
      var info = applyDetails(job);
      var badge = info.badge
        ? '<span class="jd-apply-origin"><span class="badge ' + esc(info.badgeClass || 'badge-neutral') + '">' + esc(info.badge) + '</span></span>'
        : '';
      var href = info.url || '#how-to-apply';
      var external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
      return badge + '<a class="jd-apply-btn jd-apply-btn--end" href="' + esc(href) + '"' + external + '>Apply Now</a>';
    }

    function chips(job) {
      var items = [
        ['pin', job.location || job.regionCity],
        ['briefcase', job.type],
        ['building', job.category],
        ['users', job.vacancies ? job.vacancies + ' position' + (Number(job.vacancies) === 1 ? '' : 's') : null]
      ];
      return items.filter(function (pair) { return pair[1] != null && String(pair[1]).trim() !== ''; })
        .map(function (pair) { return '<span class="jd-chip">' + icon(pair[0]) + esc(pair[1]) + '</span>'; }).join('');
    }

    function renderLoading(container) {
      container.innerHTML = '<div class="jd-loading" aria-busy="true" aria-live="polite">' +
        '<div class="jd-skeleton jd-skeleton-hero"></div><div class="jd-grid">' +
        '<div class="jd-main"><div class="jd-skeleton"></div><div class="jd-skeleton jd-skeleton-lg"></div><div class="jd-skeleton"></div></div>' +
        '<div class="jd-sidebar"><div class="jd-skeleton"></div></div></div>' +
        '<span class="jd-loading-label">Loading job details…</span></div>';
    }

    function renderError(container, detail) {
      container.innerHTML = '<div class="jd-empty"><div class="jd-empty-icon">' + icon('alert') + '</div>' +
        '<h2>We couldn\'t load this job</h2><p>' + esc(detail || 'The vacancy may have expired or been removed.') + '</p>' +
        '<a class="jd-apply-btn" href="jobs.html">Browse current jobs</a></div>';
    }

    function renderJob(container, job, related) {
      var days = daysLeft(job.deadline);
      var apply = applyDetails(job);
      var employer = job.organizationName || job.company || 'Organization not verified';
      var verified = job.organizationVerified
        ? '<span class="badge badge-verified">' + icon('check') + ' Verified employer</span>' : '';
      var skills = Array.isArray(job.requiredSkills) ? job.requiredSkills.filter(Boolean) : [];
      var deadlineClass = days != null && days <= 7 && days >= 0 ? 'urgent' : '';
      var deadlineValue = job.deadline
        ? fmtDate(job.deadline) + (days != null && days >= 0 ? ' · ' + days + ' day' + (days === 1 ? '' : 's') + ' left' : '')
        : 'Not specified';
      var sharePath = job.publicPath || ('/job/' + encodeURIComponent(job.id));
      var shareUrl = encodeURIComponent(location.origin + sharePath);
      var shareTitle = encodeURIComponent((job.title || 'Job') + ' at ' + (job.company || 'Habesha Careers'));
      var facts = [
        ['🏢', 'Organization', employer],
        ['📍', 'Location', job.location || job.regionCity || 'Ethiopia'],
        ['💼', 'Employment type', job.type],
        ['🗓️', 'Application deadline', deadlineValue],
        ['👥', 'Open positions', job.vacancies || 1],
        ['📂', 'Category', job.category],
        ['💰', 'Salary', job.salary],
        ['🎓', 'Education', job.educationRequirements],
        ['🧭', 'Experience', job.experienceRequirements],
        ['🔖', 'Reference', job.jobReference]
      ].filter(function (fact) { return fact[2] != null && String(fact[2]).trim() !== ''; })
        .map(function (fact) {
          return '<div class="job-fact"><span class="job-fact-icon" aria-hidden="true">' + esc(fact[0]) + '</span>' +
            '<span><span class="job-fact-label">' + esc(fact[1]) + '</span>' +
            '<span class="job-fact-value">' + esc(fact[2]) + '</span></span></div>';
        }).join('');
      var employerSite = job.organizationWebsite
        ? '<p class="jd-employer-site"><span class="job-fact-label">Employer website</span> <a href="' + esc(job.organizationWebsite) +
          '" target="_blank" rel="noopener noreferrer nofollow">' + esc(job.organizationDomain || job.organizationWebsite) + '</a></p>' : '';
      var relatedHtml = related.length
        ? '<section class="jd-related"><h2>Similar jobs</h2><div class="jd-related-grid">' + related.map(function (item) {
          return '<a class="jd-related-card" href="' + esc(item.publicPath || ('job-details.html?id=' + encodeURIComponent(item.id))) + '">' +
            '<span class="jd-related-title">' + esc(item.title) + '</span>' +
            '<span class="jd-related-company">' + esc(item.company || 'Organization not verified') + '</span>' +
            '<span class="jd-related-meta">' + esc(item.location || item.regionCity || 'Ethiopia') + ' · ' + esc(item.type || 'Full-time') + '</span></a>';
        }).join('') + '</div></section>' : '';
      var applyNote = apply && apply.note
        ? esc(apply.note)
        : 'No reliable application link could be verified for this vacancy. Use the employer’s official contact or application details above.';
      var directLink = apply && apply.url && /^https?:/i.test(apply.url) && !/^\/api\/apply\?/i.test(apply.url)
        ? '<p class="jd-apply-note">Direct link: <a href="' + esc(apply.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(apply.url) + '</a></p>' : '';

      container.innerHTML = '<article class="jd-article">' +
        '<header class="jd-hero"><div class="jd-hero-main">' + logoImage(job, 'jd-logo', employer) +
        '<div class="jd-hero-text"><h1 class="jd-title">' + esc(job.title) + '</h1>' +
        '<p class="jd-company">' + esc(employer) + ' ' + verified + '</p>' +
        '<div class="jd-chips">' + chips(job) + '</div>' + employerSite + '</div></div>' +
        '<button type="button" class="jd-save-btn" data-save-job="' + esc(String(job.id)) + '" aria-pressed="false" title="Save this job">' +
        icon('bookmark') + '<span>Save</span></button></header>' +
        '<div class="jd-grid"><div class="jd-main">' +
        '<section class="jd-card"><h2>Vacancy at a glance</h2><div class="job-facts">' + facts + '</div></section>' +
        jobPostHtml(job) +
        (skills.length ? '<section class="job-post-section"><h2 class="job-post-title"><span class="job-post-icon" aria-hidden="true">🧰</span>Required skills</h2><div class="job-post-content"><ul>' +
          skills.map(function (skill) { return '<li>' + esc(skill) + '</li>'; }).join('') + '</ul></div></section>' : '') +
        (job.applicationInstructions
          ? '<section class="job-post-section" id="how-to-apply"><h2 class="job-post-title"><span class="job-post-icon" aria-hidden="true">📨</span>How to Apply</h2><div class="job-post-content"><p>' + esc(job.applicationInstructions) + '</p></div></section>'
          : '<section class="job-post-section" id="how-to-apply"><h2 class="job-post-title"><span class="job-post-icon" aria-hidden="true">📨</span>How to Apply</h2><div class="job-post-content">' +
            '<p>This vacancy does not publish an online application link. Contact <strong>' + esc(employer) + '</strong> using the details in the announcement above, and mention the job title when you apply.</p>' +
            (job.organizationWebsite ? '<p>Employer website: <a href="' + esc(job.organizationWebsite) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(job.organizationDomain || job.organizationWebsite) + '</a></p>' : '') +
            '</div></section>') +
        '<section class="jd-card jd-before"><h2>Before you apply</h2><p>Habesha Careers lists this opportunity for discovery. Always confirm the role, deadline and requirements with the hiring organization before sharing personal information.</p>' +
        (job.lastVerifiedAt ? '<p><small>Listing last checked ' + esc(fmtDate(job.lastVerifiedAt)) + '.</small></p>' : '') + '</section>' +
        '<section class="jd-card jd-final-apply" aria-label="Apply for this position"><h2>Ready to apply?</h2>' +
        '<p>Review the complete vacancy details above before applying.</p>' + applyButton(job) +
        directLink + '<p class="jd-apply-note">' + applyNote + '</p></section></div>' +
        '<aside class="jd-sidebar" aria-label="Job details and sharing"><section class="jd-card"><h2>Job details</h2><ul class="jd-facts">' +
        '<li><span>Deadline</span><strong class="jd-deadline ' + esc(deadlineClass) + '">' + esc(job.deadline ? fmtDate(job.deadline) : 'Not specified') + '</strong></li>' +
        '<li><span>Posted</span><strong>' + esc(job.postedDate ? fmtDate(job.postedDate) : 'Not specified') + '</strong></li>' +
        '<li><span>Job type</span><strong>' + esc(job.type || 'Not specified') + '</strong></li>' +
        '<li><span>Location</span><strong>' + esc(job.location || job.regionCity || 'Ethiopia') + '</strong></li>' +
        '<li><span>Vacancies</span><strong>' + esc(job.vacancies || 1) + '</strong></li>' +
        (job.category ? '<li><span>Category</span><strong>' + esc(job.category) + '</strong></li>' : '') +
        (job.jobReference ? '<li><span>Reference</span><strong>' + esc(job.jobReference) + '</strong></li>' : '') +
        '</ul></section>' +
        '<section class="jd-card jd-share-card"><h2>' + icon('share') + ' Share this vacancy</h2><div class="jd-share">' +
        '<a href="https://t.me/share/url?url=' + shareUrl + '&text=' + shareTitle + '" target="_blank" rel="noopener noreferrer" aria-label="Share on Telegram">Telegram</a>' +
        '<a href="https://www.linkedin.com/sharing/share-offsite/?url=' + shareUrl + '" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn">LinkedIn</a>' +
        '<a href="https://twitter.com/intent/tweet?url=' + shareUrl + '&text=' + shareTitle + '" target="_blank" rel="noopener noreferrer" aria-label="Share on X">X</a>' +
        '</div></section></aside></div>' + relatedHtml + '</article>';

      var saved = readSavedJobs();
      var saveButton = qs('[data-save-job]', container);
      if (saveButton && saved.indexOf(String(job.id)) >= 0) {
        saveButton.classList.add('saved');
        saveButton.setAttribute('aria-pressed', 'true');
        var label = qs('span', saveButton);
        if (label) label.textContent = 'Saved';
      }
    }

    function setMeta(selector, attribute, value) {
      var node = document.head ? document.head.querySelector(selector) : null;
      if (!node) {
        node = document.createElement('meta');
        var property = /property="([^"]+)"/.exec(selector);
        var name = /name="([^"]+)"/.exec(selector);
        if (property) node.setAttribute('property', property[1]);
        else if (name) node.setAttribute('name', name[1]);
        if (document.head) document.head.appendChild(node);
      }
      if (node) node.setAttribute(attribute, value);
    }

    function applySeo(job) {
      var canonical = location.origin + (job.publicPath || ('/job/' + encodeURIComponent(job.id)));
      var description = String(job.description || '').replace(/\s+/g, ' ').trim().slice(0, 158) ||
        ('Apply for ' + job.title + ' at ' + (job.company || 'Habesha Careers') + ' on Habesha Careers.');
      var image = /^https?:\/\//i.test(job.logo || '') ? job.logo : location.origin + '/images/logo.png';
      var title = job.title + ' at ' + (job.company || 'Habesha Careers') + ' | Habesha Careers';
      document.title = title;
      setMeta('meta[name="description"]', 'content', description);
      var link = document.head ? document.head.querySelector('link[rel="canonical"]') : null;
      if (!link && document.head) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      if (link) link.href = canonical;
      setMeta('meta[property="og:type"]', 'content', 'article');
      setMeta('meta[property="og:site_name"]', 'content', 'Habesha Careers');
      setMeta('meta[property="og:title"]', 'content', title);
      setMeta('meta[property="og:description"]', 'content', description);
      setMeta('meta[property="og:url"]', 'content', canonical);
      setMeta('meta[property="og:image"]', 'content', image);
      setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
      setMeta('meta[name="twitter:title"]', 'content', title);
      setMeta('meta[name="twitter:description"]', 'content', description);
      setMeta('meta[name="twitter:image"]', 'content', image);
      var structured = byId('jobStructuredData');
      if (structured) {
        if (!job.jsonLdEligible) {
          structured.textContent = '{}';
          return;
        }
        var data = {
          '@context': 'https://schema.org', '@type': 'JobPosting', title: job.title,
          description: String(job.description || '').slice(0, 12000),
          datePosted: job.postedDate || undefined, validThrough: job.deadline || undefined,
          employmentType: job.type || undefined,
          hiringOrganization: { '@type': 'Organization', name: job.company },
          jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: job.regionCity || job.location || 'Addis Ababa', addressCountry: 'ET' } },
          identifier: { '@type': 'PropertyValue', name: 'Habesha Careers', value: String(job.id) },
          url: canonical, directApply: !!job.applyUrl, industry: job.category || undefined
        };
        structured.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
      }
    }

    function resolveJobId() {
      var fromQuery = new URLSearchParams(location.search).get('id');
      if (fromQuery) return fromQuery;
      var match = /\/job\/(\d+)(?:\/|$)/.exec(location.pathname || '');
      return match ? match[1] : null;
    }

    var container = byId('jobDetailsContent');
    if (!container) return;

    container.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-save-job]') : null;
      if (!button || !container.contains(button)) return;
      var id = button.getAttribute('data-save-job') || '';
      var saved = readSavedJobs();
      var index = saved.indexOf(id);
      if (index >= 0) {
        saved.splice(index, 1);
        button.classList.remove('saved');
        button.setAttribute('aria-pressed', 'false');
        var label = qs('span', button);
        if (label) label.textContent = 'Save';
        App.toast('Removed from saved jobs.', 'info');
      } else {
        saved.push(id);
        button.classList.add('saved');
        button.setAttribute('aria-pressed', 'true');
        var savedLabel = qs('span', button);
        if (savedLabel) savedLabel.textContent = 'Saved';
        App.toast('Job saved.', 'success');
      }
      writeSavedJobs(saved);
    });

    var jobId = resolveJobId();
    if (!jobId) {
      renderError(container, 'No job was selected.');
      return;
    }

    renderLoading(container);
    var failedStatus = null;
    jobsFetch('/api/jobs/' + encodeURIComponent(jobId)).then(function (data) {
      if (data && data.ok && data.job) return data;
      return null;
    }).catch(function (err) {
      failedStatus = err && err.status;
      return null;
    }).then(function (data) {
      var job = data ? data.job : null;
      if (!job && App.getJobById) {
        try { job = App.getJobById(jobId); } catch (e) { job = null; }
      }
      if (!job) {
        renderError(container, failedStatus === 404
          ? 'This vacancy is no longer available. It may have expired or been removed.'
          : 'Please check your connection and try again.');
        return;
      }
      var related = data && Array.isArray(data.related) ? data.related : [];
      state.job = job;
      state.related = related;
      renderJob(container, job, related);
      applySeo(job);
    });
  });
  App.onPage('login', function loginPage() {
    function normalizeCard(cardType) {
      var value = String(cardType || '').toLowerCase();
      if (value === 'employee' || value === 'jobseeker') return 'jobseeker';
      if (value === 'employer') return 'employer';
      return value;
    }

    function switchCardTab(cardType, view, evt) {
      var card = normalizeCard(cardType);
      var mode = String(view || '').toLowerCase() === 'register' ? 'register' : 'login';
      var targetId = card + (mode === 'register' ? 'Register' : 'Login');
      var targetPanel = byId(targetId);
      if (!targetPanel) targetPanel = byId(card + 'Login') || byId(card + 'Register');
      if (!targetPanel) return;
      var host = targetPanel.closest ? targetPanel.closest('.auth-card') : null;
      if (!host) return;

      var clicked = evt && evt.target && evt.target.closest ? evt.target.closest('.card-tab-btn') : null;
      qsa('.card-tab-btn', host).forEach(function (tab) {
        var active = clicked
          ? tab === clicked
          : normalizeCard(tab.getAttribute('data-card')) === card && String(tab.getAttribute('data-view') || '').toLowerCase() === mode;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      qsa('.card-content', host).forEach(function (panel) {
        var active = panel === targetPanel;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      });
    }

    // Legacy pages called this global directly; keep the name available.
    window.switchCardTab = function (cardType, view, evt) {
      switchCardTab(cardType, view, evt);
    };

    qsa('.card-tab-btn').forEach(function (tab) {
      tab.addEventListener('click', function (event) {
        switchCardTab(tab.getAttribute('data-card'), tab.getAttribute('data-view'), event);
      });
    });

    function showPanel(which, show) {
      var panel = byId(which);
      if (!panel) return;
      panel.hidden = !show;
      if (!show) return;
      var other = byId(which === 'forgotPanel' ? 'resetPanel' : 'forgotPanel');
      if (other) other.hidden = true;
      try {
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        /* older browsers */
      }
    }

    qsa('[data-forgot-toggle]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        message('forgotMessage', '');
        showPanel('forgotPanel', true);
      });
    });
    bindClick('forgotCancel', function () { showPanel('forgotPanel', false); });

    var resetParam = new URLSearchParams(location.search).get('reset');
    if (resetParam) {
      setVal('resetToken', resetParam);
      showPanel('resetPanel', true);
    }
    var typeParam = new URLSearchParams(location.search).get('type');
    if (typeParam && /^(jobseeker|employee|employer)$/i.test(typeParam)) {
      switchCardTab(typeParam, 'register');
    }

    function submitWithButton(form, messageId, work) {
      var button = form ? form.querySelector('button[type="submit"]') : null;
      if (button) App.setLoading(button, true);
      return Promise.resolve().then(work).catch(function (err) {
        message(messageId, errMsg(err));
        App.toast(errMsg(err), 'error');
      }).then(function () {
        if (button) App.setLoading(button, false);
      });
    }

    function login(roleHint) {
      var type = roleHint === 'employee' ? 'jobseeker' : 'employer';
      var messageId = type === 'jobseeker' ? 'jsLoginMessage' : 'empLoginMessage';
      var email = val(type === 'jobseeker' ? 'jsEmail' : 'empEmail').trim();
      var password = val(type === 'jobseeker' ? 'jsPassword' : 'empPassword');
      message(messageId, '');
      if (!email || !password) {
        message(messageId, 'Email and password are required.');
        return;
      }
      var form = byId(type === 'jobseeker' ? 'jobseekerLoginForm' : 'employerLoginForm');
      submitWithButton(form, messageId, function () {
        return App.api('/api/auth/login', { method: 'POST', body: { email: email, password: password } }).then(function (data) {
          var user = App.setCurrentUser((data && data.user) || null);
          var destination = App.postAuthRedirect ? App.postAuthRedirect(user) : (userRole(user) === 'admin' ? 'admin.html' : 'dashboard.html');
          App.go(safeNext(destination) || (userRole(user) === 'admin' ? 'admin.html' : 'dashboard.html'));
        });
      });
    }

    function register(role) {
      var isEmployee = role === 'employee';
      var messageId = isEmployee ? 'jsRegMessage' : 'empRegMessage';
      message(messageId, '');
      var payload;
      if (isEmployee) {
        var name = val('jsName').trim();
        var email = val('jsRegEmail').trim();
        var location = val('jsLocation').trim();
        var phone = val('jsPhone').trim();
        var password = val('jsRegPassword');
        var confirm = val('jsConfirmPassword');
        if (!name || !email || !location || !phone || !password) {
          message(messageId, 'Please fill in all required fields.');
          return;
        }
        if (password.length < 8) {
          message(messageId, 'Password must be at least 8 characters.');
          return;
        }
        if (password !== confirm) {
          message(messageId, 'Passwords do not match.');
          return;
        }
        payload = { role: 'employee', name: name, email: email, location: location, phone: phone, password: password, confirmPassword: confirm };
      } else {
        var companyName = val('empCompany').trim();
        var contactName = val('empContactName').trim();
        var empEmail = val('empRegEmail').trim();
        var empLocation = val('empLocation').trim();
        var empPhone = val('empPhone').trim();
        var empPassword = val('empRegPassword');
        var empConfirm = val('empConfirmPassword');
        if (!companyName || !contactName || !empEmail || !empLocation || !empPhone || !empPassword) {
          message(messageId, 'Please fill in all required fields.');
          return;
        }
        if (empPassword.length < 8) {
          message(messageId, 'Password must be at least 8 characters.');
          return;
        }
        if (empPassword !== empConfirm) {
          message(messageId, 'Passwords do not match.');
          return;
        }
        payload = { role: 'employer', companyName: companyName, contactName: contactName, email: empEmail, location: empLocation, phone: empPhone, password: empPassword, confirmPassword: empConfirm };
      }
      var form = byId(isEmployee ? 'jobseekerRegForm' : 'employerRegForm');
      submitWithButton(form, messageId, function () {
        return App.api('/api/auth/register', { method: 'POST', body: payload }).then(function (data) {
          var user = App.setCurrentUser((data && data.user) || null);
          message(messageId, (data && data.message) || 'Registration successful.', 'success');
          var destination = App.postAuthRedirect ? App.postAuthRedirect(user) : (userRole(user) === 'admin' ? 'admin.html' : 'dashboard.html');
          App.go(safeNext(destination) || (userRole(user) === 'admin' ? 'admin.html' : 'dashboard.html'));
        });
      });
    }

    ['jobseekerLoginForm', 'employerLoginForm'].forEach(function (id) {
      var form = byId(id);
      if (form) form.addEventListener('submit', function (event) {
        event.preventDefault();
        login(id === 'jobseekerLoginForm' ? 'employee' : 'employer');
      });
    });
    ['jobseekerRegForm', 'employerRegForm'].forEach(function (id) {
      var form = byId(id);
      if (!form) return;
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        register(id === 'jobseekerRegForm' ? 'employee' : 'employer');
      });
    });

    var forgotForm = byId('forgotForm');
    if (forgotForm) {
      forgotForm.addEventListener('submit', function (event) {
        event.preventDefault();
        message('forgotMessage', '');
        var email = val('forgotEmail').trim();
        if (!email) {
          message('forgotMessage', 'Enter your email address.');
          return;
        }
        submitWithButton(forgotForm, 'forgotMessage', function () {
          return App.api('/api/account/forgot-password', { method: 'POST', body: { email: email } }).then(function (data) {
            message('forgotMessage', (data && data.message) || 'If that email is registered, a reset link has been sent.', 'success');
            var devLink = byId('devResetLink');
            if (devLink) {
              if (data && data.devResetUrl) {
                devLink.href = data.devResetUrl;
                devLink.hidden = false;
              } else {
                devLink.hidden = true;
              }
            }
          });
        });
      });
    }

    var resetForm = byId('resetForm');
    if (resetForm) {
      resetForm.addEventListener('submit', function (event) {
        event.preventDefault();
        message('resetMessage', '');
        var token = val('resetToken').trim();
        var password = val('resetPassword');
        var confirm = val('resetConfirm');
        if (!token) {
          message('resetMessage', 'A reset token is required.');
          return;
        }
        if (password.length < 8) {
          message('resetMessage', 'Password must be at least 8 characters.');
          return;
        }
        if (password !== confirm) {
          message('resetMessage', 'Passwords do not match.');
          return;
        }
        submitWithButton(resetForm, 'resetMessage', function () {
          return App.api('/api/account/reset-password', { method: 'POST', body: { token: token, password: password } }).then(function (data) {
            message('resetMessage', (data && data.message) || 'Password updated. You can now sign in.', 'success');
            setVal('resetPassword', '');
            setVal('resetConfirm', '');
            show('resetLoginLink', true);
          });
        });
      });
    }
  });

  App.onPage('dashboard', function dashboardPage() {
    var user = currentUser();

    function dateOrDash(value) {
      if (!value) return '—';
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return esc(value).slice(0, 10);
      return esc(date.toLocaleString());
    }

    function roleMeta(role) {
      if (role === 'admin') return { label: 'Administrator', badge: 'badge-official' };
      if (role === 'employer') return { label: 'Employer', badge: 'badge-neutral' };
      return { label: 'Job Seeker', badge: 'badge-neutral' };
    }

    function quickActions(role) {
      if (role === 'employer') {
        return [
          { icon: '➕', title: 'Post a job', desc: 'Submit a vacancy for review.', href: 'post-job.html' },
          { icon: '🧾', title: 'Structured CV', desc: 'Build a CV from your saved profile.', href: 'account.html#profile' },
          { icon: '⚙️', title: 'Account settings', desc: 'Update contact details and security.', href: 'account.html' }
        ];
      }
      if (role === 'admin') {
        return [
          { icon: '🛠️', title: 'Open admin console', desc: 'Sources, review queue and platform health.', href: 'admin.html' },
          { icon: '⚙️', title: 'Account settings', desc: 'Manage your admin account and sessions.', href: 'account.html' }
        ];
      }
      return [
        { icon: '🔎', title: 'Browse jobs', desc: 'Discover current vacancies.', href: 'jobs.html' },
        { icon: '🧾', title: 'Complete profile', desc: 'Strengthen your CV and application profile.', href: 'account.html#profile' },
        { icon: '⚙️', title: 'Account settings', desc: 'Update contact details and security.', href: 'account.html' }
      ];
    }

    function renderActions(role) {
      var container = byId('quickActions');
      if (!container) return;
      container.innerHTML = quickActions(role).map(function (action) {
        return '<div class="card card-hover">' +
          '<div class="dash-action-icon" aria-hidden="true">' + esc(action.icon) + '</div>' +
          '<h4 class="card-title">' + esc(action.title) + '</h4>' +
          '<p>' + esc(action.desc) + '</p>' +
          '<p><a href="' + esc(action.href) + '" class="btn btn-primary btn-sm">Open</a></p>' +
          '</div>';
      }).join('');
    }

    function completionFields(role) {
      function pick(key) {
        if (user && user[key]) return user[key];
        return state.profile && state.profile[key] ? state.profile[key] : null;
      }
      if (role === 'employer') {
        return [
          { label: 'Company name', value: user && (user.companyName || user.company) },
          { label: 'Contact name', value: user && (user.contactName || user.name || pick('contactName')) },
          { label: 'Phone', value: pick('phone') },
          { label: 'Location', value: pick('location') }
        ];
      }
      if (role === 'admin') {
        return [
          { label: 'Name', value: user && (user.name || user.fullName) },
          { label: 'Email', value: user && user.email }
        ];
      }
      return [
        { label: 'Full name', value: user && (user.name || user.fullName) },
        { label: 'Email', value: user && user.email },
        { label: 'Phone', value: pick('phone') },
        { label: 'Location', value: pick('location') }
      ];
    }

    var state = { profile: null, sessions: [], profileFailed: false, sessionsFailed: false };

    function renderCompletion(role) {
      var container = byId('completionContent');
      if (!container) return;
      var fields = completionFields(role);
      var done = fields.filter(function (field) { return !!field.value; }).length;
      var percent = fields.length ? Math.round((done / fields.length) * 100) : 0;
      var missing = fields.filter(function (field) { return !field.value; });
      var html = '<p><strong>' + percent + '%</strong> complete — ' + done + ' of ' + fields.length + ' key details filled in.</p>' +
        '<progress max="100" value="' + percent + '" style="width:100%;max-width:100%;"></progress>';
      if (missing.length) {
        html += '<p class="chip-label" style="margin-top:.75rem;">Still missing</p><p>' +
          missing.map(function (field) { return '<span class="chip badge-neutral">' + esc(field.label) + '</span>'; }).join(' ') + '</p>';
      } else {
        html += '<p style="margin-top:.75rem;"><span class="chip badge-official">✓ Looking good</span></p>';
      }
      if (state.profileFailed) {
        html += '<p class="alert alert-warning" style="margin-top:.75rem;">Extra profile details are unavailable right now — showing basic account information only.</p>';
      }
      container.innerHTML = html;
    }

    function renderAccountSummary() {
      var container = byId('accountSummary');
      if (!container) return;
      var html = '<div class="profile-details-grid">' +
        '<div class="profile-detail-item"><span class="detail-label">Email</span><span class="detail-value">' + esc((user && user.email) || '—') + '</span></div>' +
        '<div class="profile-detail-item"><span class="detail-label">Member since</span><span class="detail-value">' + dateOrDash(user && user.createdAt) + '</span></div>' +
        '</div>';
      if (state.sessionsFailed) {
        html += '<p class="alert alert-warning" style="margin-top:.75rem;">Session activity is unavailable right now.</p>';
      } else if (!state.sessions.length) {
        html += '<p style="margin-top:.75rem;">No active sessions recorded.</p>';
      } else {
        var current = state.sessions.filter(function (session) { return session && session.current; })[0];
        html += '<p style="margin-top:.75rem;"><span class="chip badge-neutral">' + state.sessions.length +
          ' active ' + (state.sessions.length === 1 ? 'session' : 'sessions') + '</span></p>';
        if (current) {
          html += '<p>Last seen on this session: <strong>' + dateOrDash(current.last_seen_at || current.created_at) + '</strong></p>';
        }
      }
      container.innerHTML = html;
    }

    function fail(text) {
      var loading = byId('dashboardLoading');
      var error = byId('dashboardError');
      if (loading) loading.hidden = true;
      if (error) {
        error.textContent = text;
        error.hidden = false;
      }
    }

    if (!user) {
      fail('We could not confirm your session. Redirecting you to sign in…');
      return;
    }

    var loading = byId('dashboardLoading');
    if (loading) loading.hidden = true;
    var content = byId('dashboardContent');
    if (content) content.hidden = false;

    var role = userRole(user);
    var meta = roleMeta(role);
    text('dashboardWelcome', 'Welcome, ' + displayName(user));
    text('dashboardSubtitle', role === 'admin'
      ? 'Your platform console and account are one click away.'
      : 'A quick look at your profile, activity and next steps.');
    var badge = byId('dashboardRoleBadge');
    if (badge) {
      badge.textContent = meta.label;
      badge.classList.remove('badge-official', 'badge-neutral');
      badge.classList.add(meta.badge);
    }
    renderActions(role);
    renderCompletion(role);
    renderAccountSummary();

    Promise.allSettled([
      App.api('/api/account/profile', { method: 'GET' }),
      App.api('/api/account/session', { method: 'GET' })
    ]).then(function (results) {
      var profileResult = results[0];
      var sessionResult = results[1];
      if (profileResult && profileResult.status === 'fulfilled' && profileResult.value) {
        state.profile = profileResult.value.profile || null;
        if (profileResult.value.user) {
          var updated = App.setCurrentUser(profileResult.value.user);
          if (updated) user = updated;
        }
      } else {
        state.profileFailed = true;
      }
      if (sessionResult && sessionResult.status === 'fulfilled' && sessionResult.value && Array.isArray(sessionResult.value.sessions)) {
        state.sessions = sessionResult.value.sessions;
      } else {
        state.sessionsFailed = true;
      }
      renderCompletion(role);
      renderAccountSummary();
    });
  });
  App.onPage('account', function accountPage() {
    var user = currentUser();
    var LIST_KEYS = ['education', 'experience', 'skills', 'languages', 'projects', 'certifications'];
    var LIST_IDS = {
      education: 'eduList', experience: 'experienceList', skills: 'skillsList',
      languages: 'languagesList', projects: 'projectsList', certifications: 'certsList'
    };
    var CV_KEYS = {
      headline: 1, email: 1, phone: 1, city: 1, website: 1, linkedin: 1, summary: 1,
      education: 1, experience: 1, skills: 1, languages: 1, projects: 1, certifications: 1
    };
    var state = { profile: {}, cv: {} };

    function applyRoleFields(role) {
      show('companyGroup', role === 'employer');
      show('contactGroup', role === 'employer');
      show('nameGroup', role !== 'employer');
    }

    function plainProfile(profile) {
      var extra = {};
      var source = profile && typeof profile === 'object' ? profile : {};
      Object.keys(source).forEach(function (key) {
        if (!CV_KEYS[key]) extra[key] = source[key];
      });
      return extra;
    }

    function fillProfile(dataUser, profile) {
      setVal('name', (dataUser && (dataUser.name || dataUser.fullName)) || '');
      setVal('companyName', (dataUser && (dataUser.companyName || dataUser.company)) || '');
      setVal('contactName', (dataUser && dataUser.contactName) || '');
      setVal('phone', (dataUser && dataUser.phone) || (profile && profile.phone) || '');
      setVal('location', (dataUser && dataUser.location) || (profile && profile.location) || '');
      var extra = plainProfile(profile);
      setVal('profileExtra', Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '');
    }

    function normalizeItems(value) {
      if (!Array.isArray(value)) return [];
      return value.map(function (item) {
        if (item && typeof item === 'object' && !Array.isArray(item)) return item;
        return { name: item };
      });
    }

    function fillCv(profile) {
      var source = profile && typeof profile === 'object' ? profile : {};
      state.profile = source;
      state.cv = {
        headline: source.headline || '',
        email: source.email || (user && user.email) || '',
        phone: source.phone || (user && user.phone) || '',
        city: source.city || (user && user.location) || '',
        website: source.website || '',
        linkedin: source.linkedin || '',
        summary: source.summary || '',
        education: normalizeItems(source.education),
        experience: normalizeItems(source.experience),
        skills: normalizeItems(source.skills),
        languages: normalizeItems(source.languages),
        projects: normalizeItems(source.projects),
        certifications: normalizeItems(source.certifications)
      };
      setVal('cvHeadline', state.cv.headline);
      setVal('cvEmail', state.cv.email);
      setVal('cvPhone', state.cv.phone);
      setVal('cvCity', state.cv.city);
      setVal('cvWebsite', state.cv.website);
      setVal('cvLinkedin', state.cv.linkedin);
      setVal('cvSummary', state.cv.summary);
      renderCvRows();
    }

    function field(label, name, value, type) {
      return '<label class="cv-row-field"><span>' + esc(label) + '</span>' +
        '<input type="' + esc(type || 'text') + '" class="form-control" data-cv-field="' + esc(name) + '" value="' + esc(value) + '"></label>';
    }

    function textarea(label, name, value) {
      return '<label class="cv-row-field"><span>' + esc(label) + '</span>' +
        '<textarea class="form-control" rows="2" data-cv-field="' + esc(name) + '">' + esc(value) + '</textarea></label>';
    }

    function checkbox(label, name, checked) {
      return '<label class="cv-row-check"><input type="checkbox" data-cv-field="' + esc(name) + '"' +
        (checked ? ' checked' : '') + '> <span>' + esc(label) + '</span></label>';
    }

    function rowHtml(kind, item, index) {
      var data = item && typeof item === 'object' ? item : { name: item };
      var body = '';
      if (kind === 'education') {
        body = field('Institution', 'institution', data.institution) +
          field('Degree', 'degree', data.degree) +
          field('Field of study', 'field', data.field) +
          field('Grade / GPA', 'grade', data.grade) +
          field('Start date', 'startDate', data.startDate, 'month') +
          field('End date', 'endDate', data.endDate, 'month');
      } else if (kind === 'experience') {
        body = field('Position', 'position', data.position) +
          field('Organisation', 'company', data.company) +
          field('Location', 'location', data.location) +
          field('Start date', 'startDate', data.startDate, 'month') +
          field('End date', 'endDate', data.endDate, 'month') +
          checkbox('I currently work here', 'current', !!data.current) +
          textarea('Description', 'description', data.description);
      } else if (kind === 'skills') {
        body = field('Skill', 'name', data.name || data.skill || data.value);
      } else if (kind === 'languages') {
        body = field('Language', 'language', data.language || data.name) +
          field('Proficiency', 'proficiency', data.proficiency);
      } else if (kind === 'projects') {
        body = field('Project name', 'name', data.name) +
          field('Date', 'date', data.date, 'month') +
          field('Project URL', 'url', data.url, 'url') +
          textarea('Description', 'description', data.description);
      } else if (kind === 'certifications') {
        body = field('Certification', 'name', data.name) +
          field('Issuing organisation', 'organization', data.organization) +
          field('Issue date', 'date', data.date, 'month') +
          field('Certificate URL', 'url', data.url, 'url') +
          textarea('Description', 'description', data.description);
      }
      return '<div class="cv-row" data-cv-row data-cv-kind="' + esc(kind) + '" data-cv-index="' + Number(index) + '">' +
        body + '<div class="cv-row-actions"><button type="button" class="btn btn-ghost btn-sm" data-cv-action="remove-row">Remove</button></div></div>';
    }

    function renderCvRows() {
      LIST_KEYS.forEach(function (key) {
        var container = byId(LIST_IDS[key]);
        if (!container) return;
        var items = Array.isArray(state.cv[key]) ? state.cv[key] : [];
        container.innerHTML = items.length
          ? items.map(function (item, index) { return rowHtml(key, item, index); }).join('')
          : '<div class="empty-state">Nothing added yet.</div>';
      });
    }

    function collectRows(kind) {
      var container = byId(LIST_IDS[kind]);
      if (!container) return [];
      return qsa('[data-cv-row]', container).map(function (row) {
        var item = {};
        qsa('[data-cv-field]', row).forEach(function (input) {
          var key = input.getAttribute('data-cv-field');
          if (!key) return;
          if (input.type === 'checkbox') item[key] = !!input.checked;
          else item[key] = String(input.value == null ? '' : input.value).trim();
        });
        return item;
      });
    }

    function collectCvForm() {
      var data = {
        headline: val('cvHeadline').trim(),
        email: val('cvEmail').trim(),
        phone: val('cvPhone').trim(),
        city: val('cvCity').trim(),
        website: val('cvWebsite').trim(),
        linkedin: val('cvLinkedin').trim(),
        summary: val('cvSummary').trim()
      };
      LIST_KEYS.forEach(function (key) { data[key] = collectRows(key); });
      return data;
    }

    function safeUrl(value) {
      var raw = String(value || '').trim();
      return /^(https?:\/\/|mailto:)/i.test(raw) ? raw : '';
    }

    function multiline(value) {
      return esc(value).replace(/\r?\n/g, '<br>');
    }

    function cvDate(value) {
      if (!value) return '';
      return esc(String(value).slice(0, 10));
    }

    function initials(name) {
      var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      return parts.slice(0, 2).map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
    }

    function cvSection(title, body) {
      if (!body) return '';
      return '<section class="cv-section"><h3 class="cv-section-title">' + esc(title) + '</h3>' + body + '</section>';
    }

    function linkLine(label, value) {
      var href = safeUrl(value);
      if (!href) return '';
      return '<div><strong>' + esc(label) + ':</strong> <a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(value) + '</a></div>';
    }

    function cvHtml() {
      var data = collectCvForm();
      var name = data.headline || (user && (user.name || user.fullName)) || 'Your Name';
      var contact = [
        data.email ? '<div class="cv-contact-item"><strong>Email:</strong> ' + esc(data.email) + '</div>' : '',
        data.phone ? '<div class="cv-contact-item"><strong>Phone:</strong> ' + esc(data.phone) + '</div>' : '',
        data.city ? '<div class="cv-contact-item"><strong>Location:</strong> ' + esc(data.city) + '</div>' : '',
        linkLine('Website', data.website),
        linkLine('LinkedIn', data.linkedin)
      ].filter(Boolean).join('');

      var education = data.education.filter(function (item) { return item && Object.keys(item).some(function (k) { return item[k]; }); }).map(function (item) {
        return '<div class="cv-entry"><div class="cv-entry-header"><div class="cv-entry-title">' +
          esc([item.degree, item.field].filter(Boolean).join(' in ') || 'Education') + '</div>' +
          '<div class="cv-entry-date">' + cvDate(item.startDate) + (item.startDate || item.endDate ? ' — ' : '') + cvDate(item.endDate) + '</div></div>' +
          (item.institution ? '<div class="cv-entry-subtitle">' + esc(item.institution) + '</div>' : '') +
          (item.grade ? '<div><strong>Grade:</strong> ' + esc(item.grade) + '</div>' : '') + '</div>';
      }).join('');

      var experience = data.experience.filter(function (item) { return item && Object.keys(item).some(function (k) { return item[k]; }); }).map(function (item) {
        return '<div class="cv-entry"><div class="cv-entry-header"><div class="cv-entry-title">' +
          esc(item.position || 'Experience') + '</div><div class="cv-entry-date">' + cvDate(item.startDate) + ' — ' +
          (item.current ? 'Present' : cvDate(item.endDate)) + '</div></div>' +
          (item.company || item.location ? '<div class="cv-entry-subtitle">' + esc([item.company, item.location].filter(Boolean).join(' · ')) + '</div>' : '') +
          (item.description ? '<div class="cv-entry-description">' + multiline(item.description) + '</div>' : '') + '</div>';
      }).join('');

      var skills = data.skills.map(function (item) { return item.name || item.skill || item.value || ''; })
        .filter(Boolean).map(function (skill) { return '<div class="cv-skill-item">' + esc(skill) + '</div>'; }).join('');
      var languageRows = data.languages.map(function (item) {
        return '<div class="cv-language-item"><span class="cv-language-name">' + esc(item.language || item.name || 'Language') +
          '</span><span class="cv-language-level">' + esc(item.proficiency || '') + '</span></div>';
      }).join('');

      var projects = data.projects.filter(function (item) { return item && Object.keys(item).some(function (k) { return item[k]; }); }).map(function (item) {
        return '<div class="cv-entry"><div class="cv-entry-header"><div class="cv-entry-title">' + esc(item.name || 'Project') +
          '</div><div class="cv-entry-date">' + cvDate(item.date) + '</div></div>' +
          (item.description ? '<div class="cv-entry-description">' + multiline(item.description) + '</div>' : '') +
          linkLine('Project URL', item.url) + '</div>';
      }).join('');

      var certs = data.certifications.filter(function (item) { return item && Object.keys(item).some(function (k) { return item[k]; }); }).map(function (item) {
        return '<div class="cv-entry"><div class="cv-entry-header"><div class="cv-entry-title">' + esc(item.name || 'Certification') +
          '</div><div class="cv-entry-date">' + cvDate(item.date) + '</div></div>' +
          (item.organization ? '<div class="cv-entry-subtitle">' + esc(item.organization) + '</div>' : '') +
          (item.description ? '<div class="cv-entry-description">' + multiline(item.description) + '</div>' : '') +
          linkLine('Certificate URL', item.url) + '</div>';
      }).join('');

      return '<div class="cv-document"><header class="cv-header">' +
        '<div class="cv-photo" aria-hidden="true">' + esc(initials(name)) + '</div>' +
        '<div class="cv-header-info"><h1>' + esc(name) + '</h1>' +
        (contact ? '<div class="cv-contact-info">' + contact + '</div>' : '') + '</div></header>' +
        cvSection('Professional summary', data.summary ? '<p>' + multiline(data.summary) + '</p>' : '') +
        cvSection('Work experience', experience) +
        cvSection('Education and training', education) +
        cvSection('Technical skills', skills ? '<div class="cv-skills-grid">' + skills + '</div>' : '') +
        cvSection('Languages', languageRows ? '<div class="cv-language-grid">' + languageRows + '</div>' : '') +
        cvSection('Projects', projects) +
        cvSection('Certifications', certs) +
        '<footer class="cv-footer">Generated with Habesha Careers</footer></div>';
    }

    function printCv(html) {
      var name = val('cvHeadline') || (user && (user.name || user.fullName)) || 'CV';
      var popup = window.open('', '_blank');
      if (!popup || !popup.document) {
        message('cvMessage', 'Your browser blocked the print window. Allow pop-ups to download or print this CV.');
        App.toast('Your browser blocked the print window.', 'error');
        return;
      }
      var doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CV - ' + esc(name) + '</title>' +
        '<style>' +
        'body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1917;margin:0;padding:32px;background:#faf7f2;}' +
        '.cv-document{max-width:820px;margin:0 auto;background:#fff;padding:48px;border-radius:14px;box-shadow:0 10px 30px rgba(28,25,23,.08);}' +
        '.cv-header{display:flex;gap:24px;align-items:center;border-bottom:2px solid #14532d;padding-bottom:20px;margin-bottom:24px;}' +
        '.cv-photo{width:82px;height:82px;flex:0 0 82px;border-radius:50%;background:#14532d;color:#fff;display:grid;place-items:center;font-size:28px;font-weight:700;}' +
        '.cv-header-info h1{margin:0 0 8px;font-size:30px;}.cv-contact-info{display:grid;gap:4px;font-size:13px;color:#6b6259;}' +
        '.cv-section{margin:0 0 24px;}.cv-section-title{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#14532d;border-bottom:1px solid #e7e1d8;padding-bottom:6px;margin:0 0 12px;}' +
        '.cv-entry{margin:0 0 14px;page-break-inside:avoid;}.cv-entry-header{display:flex;justify-content:space-between;gap:16px;font-weight:600;}' +
        '.cv-entry-date{color:#6b6259;font-weight:400;font-size:13px;}.cv-entry-subtitle{color:#6b6259;font-size:14px;margin-top:2px;}' +
        '.cv-entry-description{margin-top:6px;font-size:14px;line-height:1.55;}.cv-skills-grid,.cv-language-grid{display:flex;flex-wrap:wrap;gap:8px;}' +
        '.cv-skill-item,.cv-language-item{background:#faf7f2;border:1px solid #e7e1d8;border-radius:999px;padding:5px 10px;font-size:13px;}' +
        '.cv-language-item{display:flex;gap:8px;}.cv-language-level{color:#6b6259;}.cv-footer{margin-top:32px;border-top:1px solid #e7e1d8;padding-top:12px;font-size:12px;color:#6b6259;text-align:center;}' +
        '@media print{body{background:#fff;padding:0;}.cv-document{box-shadow:none;padding:0;max-width:none;}}' +
        '</style></head><body>' + html + '</body></html>';
      try {
        popup.document.open();
        popup.document.write(doc);
        popup.document.close();
        popup.focus();
        if (popup.document.readyState === 'complete') {
          setTimeout(function () { try { popup.print(); } catch (e) { /* user can print manually */ } }, 250);
        } else {
          popup.onload = function () { try { popup.print(); } catch (e) { /* user can print manually */ } };
        }
      } catch (e) {
        message('cvMessage', 'The CV window could not be opened.');
        App.toast('The CV window could not be opened.', 'error');
      }
    }

    function withButton(form, messageId, work) {
      var button = form ? form.querySelector('button[type="submit"]') : null;
      if (button) App.setLoading(button, true);
      return Promise.resolve().then(work).catch(function (err) {
        message(messageId, errMsg(err));
        App.toast(errMsg(err), 'error');
      }).then(function () {
        if (button) App.setLoading(button, false);
      });
    }

    function parseExtra() {
      var raw = val('profileExtra').trim();
      if (!raw) return {};
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error('More profile details must be valid JSON.');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('More profile details must be a JSON object.');
      }
      return plainProfile(parsed);
    }

    function saveProfile(event) {
      event.preventDefault();
      message('profileMessage', '');
      var role = userRole(user);
      var payload = {
        phone: val('phone').trim(),
        location: val('location').trim()
      };
      if (role === 'employer') {
        payload.companyName = val('companyName').trim();
        payload.contactName = val('contactName').trim();
      } else {
        payload.name = val('name').trim();
      }
      var extra;
      try {
        extra = parseExtra();
      } catch (err) {
        message('profileMessage', err.message);
        return;
      }
      payload.profile = extra;
      withButton(byId('profileForm'), 'profileMessage', function () {
        return App.api('/api/account/profile', { method: 'PATCH', body: payload }).then(function (data) {
          if (data && data.user) user = App.setCurrentUser(data.user) || user;
          if (data && data.profile) {
            state.profile = data.profile;
            fillProfile(user, data.profile);
            fillCv(data.profile);
          }
          message('profileMessage', (data && data.message) || 'Profile saved.', 'success');
          App.toast('Profile saved.', 'success');
        });
      });
    }

    function changePassword(event) {
      event.preventDefault();
      message('securityMessage', '');
      var current = val('currentPassword');
      var next = val('newPassword');
      var confirm = val('confirmPassword');
      if (!current || !next || !confirm) {
        message('securityMessage', 'Fill in all password fields.');
        return;
      }
      if (next.length < 8) {
        message('securityMessage', 'New password must be at least 8 characters.');
        return;
      }
      if (next !== confirm) {
        message('securityMessage', 'New passwords do not match.');
        return;
      }
      withButton(byId('passwordForm'), 'securityMessage', function () {
        return App.api('/api/account/password', {
          method: 'POST',
          body: { currentPassword: current, newPassword: next }
        }).then(function (data) {
          setVal('currentPassword', '');
          setVal('newPassword', '');
          setVal('confirmPassword', '');
          message('securityMessage', (data && data.message) || 'Password changed successfully.', 'success');
          App.toast('Password changed successfully.', 'success');
        }).catch(function (err) {
          setVal('newPassword', '');
          setVal('confirmPassword', '');
          throw err;
        });
      });
    }

    function saveCvProfile(event) {
      event.preventDefault();
      message('cvMessage', '');
      var payload = collectCvForm();
      withButton(byId('cvProfileForm'), 'cvMessage', function () {
        return App.api('/api/account/profile', { method: 'PATCH', body: { profile: payload } }).then(function (data) {
          if (data && data.user) user = App.setCurrentUser(data.user) || user;
          if (data && data.profile) {
            fillProfile(user, data.profile);
            fillCv(data.profile);
          }
          message('cvMessage', 'CV profile saved to your account.', 'success');
          App.toast('CV profile saved.', 'success');
        });
      });
    }

    function addCvRow(kind) {
      var rows = collectCvForm()[kind] || [];
      rows.push({});
      state.cv[kind] = rows;
      renderCvRows();
      var container = byId(LIST_IDS[kind]);
      var last = container ? qsa('[data-cv-row]', container).slice(-1)[0] : null;
      var input = last ? qs('input, textarea', last) : null;
      if (input && typeof input.focus === 'function') input.focus();
    }

    function sessionDate(value) {
      if (!value) return '—';
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return esc(value).slice(0, 10);
      return esc(date.toLocaleString());
    }

    function sessionCard(session) {
      var item = session || {};
      var current = !!item.current;
      return '<div class="card session-card">' +
        '<p><strong>' + esc(item.user_agent || 'Unknown device') + '</strong> ' +
        (current ? '<span class="chip badge-official">This device</span>' : '') + '</p>' +
        '<p>Signed in: ' + sessionDate(item.created_at) + ' · Last seen: ' + sessionDate(item.last_seen_at) + '</p>' +
        (current ? '' : '<p><button type="button" class="btn btn-secondary btn-sm" data-session-id="' + esc(item.id) + '">Sign out</button></p>') +
        '</div>';
    }

    function renderSessions(sessions) {
      var container = byId('sessionsList');
      if (!container) return;
      if (!sessions || !sessions.length) {
        container.innerHTML = '<div class="empty-state">No active sessions found.</div>';
        return;
      }
      container.innerHTML = sessions.map(sessionCard).join('');
    }

    function loadSessions(showLoading) {
      var container = byId('sessionsList');
      if (showLoading && container) container.innerHTML = '<div class="empty-state">Loading sessions…</div>';
      return App.api('/api/account/session', { method: 'GET' }).then(function (data) {
        var sessions = data && Array.isArray(data.sessions) ? data.sessions : [];
        renderSessions(sessions);
        return sessions;
      }).catch(function (err) {
        if (container) container.innerHTML = '<div class="alert alert-error">' + esc(errMsg(err)) + '</div>';
        return null;
      });
    }

    function revokeSession(id) {
      message('sessionsMessage', '');
      return App.api('/api/account/session?id=' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
        message('sessionsMessage', 'That session has been signed out.', 'success');
        App.toast('Session signed out.', 'success');
        return loadSessions(true);
      }).catch(function (err) {
        message('sessionsMessage', errMsg(err));
        App.toast(errMsg(err), 'error');
      });
    }

    function revokeOthers() {
      message('sessionsMessage', '');
      var button = byId('revokeOthersBtn');
      if (button) App.setLoading(button, true);
      return App.api('/api/account/session/revoke-others', { method: 'POST', body: {} }).then(function (data) {
        var count = data && typeof data.revoked === 'number' ? data.revoked : 0;
        message('sessionsMessage', count === 1 ? 'Signed out 1 other session.' : 'Signed out ' + count + ' other sessions.', 'success');
        App.toast('Other sessions signed out.', 'success');
        return loadSessions(true);
      }).catch(function (err) {
        message('sessionsMessage', errMsg(err));
        App.toast(errMsg(err), 'error');
      }).then(function () {
        if (button) App.setLoading(button, false);
      });
    }

    function showPreview() {
      var preview = byId('cvPreviewModal');
      var content = byId('cvPreviewContent');
      if (!preview || !content) return;
      var html = cvHtml();
      content.innerHTML = html;
      preview.hidden = false;
    }

    function hidePreview() {
      var preview = byId('cvPreviewModal');
      if (preview) preview.hidden = true;
    }

    function bindEvents() {
      var profileForm = byId('profileForm');
      if (profileForm) profileForm.addEventListener('submit', saveProfile);
      var passwordForm = byId('passwordForm');
      if (passwordForm) passwordForm.addEventListener('submit', changePassword);
      var cvForm = byId('cvProfileForm');
      if (cvForm) cvForm.addEventListener('submit', saveCvProfile);

      bindClick('addEducation', function () { addCvRow('education'); });
      bindClick('addExperience', function () { addCvRow('experience'); });
      bindClick('addSkill', function () { addCvRow('skills'); });
      bindClick('addLanguage', function () { addCvRow('languages'); });
      bindClick('addProject', function () { addCvRow('projects'); });
      bindClick('addCert', function () { addCvRow('certifications'); });

      if (cvForm) {
        cvForm.addEventListener('click', function (event) {
          var button = event.target && event.target.closest ? event.target.closest('[data-cv-action="remove-row"]') : null;
          if (!button || !cvForm.contains(button)) return;
          var row = button.closest('[data-cv-row]');
          if (!row) return;
          var kind = row.getAttribute('data-cv-kind');
          var index = Number(row.getAttribute('data-cv-index'));
          if (!kind || LIST_KEYS.indexOf(kind) === -1 || !Number.isFinite(index)) return;
          var all = collectCvForm();
          var rows = Array.isArray(all[kind]) ? all[kind] : [];
          if (index >= 0 && index < rows.length) rows.splice(index, 1);
          state.cv[kind] = rows;
          renderCvRows();
        });
      }

      bindClick('cvPreview', showPreview);
      bindClick('cvDownload', function () { printCv(cvHtml()); });
      bindClick('cvPreviewClose', hidePreview);
      bindClick('cvPrint', function () {
        var content = byId('cvPreviewContent');
        printCv(content && content.innerHTML.trim() ? content.innerHTML : cvHtml());
      });
      qsa('[data-cv-close]').forEach(function (button) { button.addEventListener('click', hidePreview); });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' || event.key === 'Esc') hidePreview();
      });

      var sessionsList = byId('sessionsList');
      if (sessionsList) {
        sessionsList.addEventListener('click', function (event) {
          var button = event.target && event.target.closest ? event.target.closest('[data-session-id]') : null;
          if (!button || !sessionsList.contains(button)) return;
          var id = button.getAttribute('data-session-id');
          if (id) revokeSession(id);
        });
      }
      bindClick('revokeOthersBtn', revokeOthers);
    }

    function fail(text) {
      var loading = byId('accountLoading');
      var error = byId('accountError');
      if (loading) loading.hidden = true;
      if (error) {
        error.textContent = text;
        error.hidden = false;
      }
    }

    if (!user) {
      fail('We could not confirm your session. Redirecting you to sign in…');
      return;
    }

    var loading = byId('accountLoading');
    if (loading) loading.hidden = true;
    var content = byId('accountContent');
    if (content) content.hidden = false;

    applyRoleFields(userRole(user));
    fillProfile(user, null);
    fillCv(user.profile || {});
    bindEvents();

    Promise.allSettled([
      App.api('/api/account/profile', { method: 'GET' }),
      App.api('/api/account/session', { method: 'GET' })
    ]).then(function (results) {
      var profileResult = results[0];
      var sessionResult = results[1];
      if (profileResult && profileResult.status === 'fulfilled' && profileResult.value) {
        if (profileResult.value.user) user = App.setCurrentUser(profileResult.value.user) || user;
        var profile = profileResult.value.profile || {};
        fillProfile(user, profile);
        fillCv(profile);
      } else {
        message('profileMessage', errMsg(profileResult && profileResult.reason));
      }
      if (sessionResult && sessionResult.status === 'fulfilled' && sessionResult.value && Array.isArray(sessionResult.value.sessions)) {
        renderSessions(sessionResult.value.sessions);
      } else {
        var sessionsList = byId('sessionsList');
        if (sessionsList) sessionsList.innerHTML = '<div class="alert alert-error">Session activity is unavailable right now.</div>';
      }
    });
  });
  App.onPage('post-job', function postJobPage() {
    var form = byId('postJobForm');
    var deadline = byId('deadline');

    if (deadline) {
      try {
        var today = new Date();
        var offset = today.getTimezoneOffset();
        var localToday = new Date(today.getTime() - offset * 60000).toISOString().slice(0, 10);
        deadline.setAttribute('min', localToday);
      } catch (e) {
        /* the server validates the deadline too */
      }
    }

    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      message('postJobMessage', '');

      var jobData = {
        title: val('jobTitle').trim(),
        company: val('company').trim(),
        category: val('category'),
        type: val('jobType'),
        location: val('location').trim(),
        vacancies: val('vacancies').trim(),
        description: val('description').trim(),
        requirements: val('requirements').trim(),
        deadline: val('deadline'),
        contactEmail: val('contactEmail').trim()
      };

      if (!jobData.title || !jobData.company || !jobData.category || !jobData.type ||
          !jobData.location || !jobData.description || !jobData.requirements ||
          !jobData.deadline || !jobData.contactEmail) {
        message('postJobMessage', 'Please complete every required field.');
        return;
      }
      if (!(Number(jobData.vacancies) > 0)) {
        message('postJobMessage', 'Enter at least one open position.');
        return;
      }
      var due = new Date(jobData.deadline + 'T00:00:00');
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      if (Number.isNaN(due.getTime()) || due < today) {
        message('postJobMessage', 'Deadline must be in the future.');
        return;
      }

      var submitter = currentUser();
      var payload = Object.assign({}, jobData, {
        vacancies: Number(jobData.vacancies),
        submitterRef: (submitter && (submitter.email || submitter.companyName || submitter.company || submitter.name)) || null
      });
      var button = form.querySelector('button[type="submit"]');
      if (button) App.setLoading(button, true);
      App.api('/api/employer/submit', { method: 'POST', body: payload }).then(function (data) {
        var successParagraph = qs('#successMessage p');
        if (successParagraph) {
          successParagraph.textContent = (data && data.message) || 'Your vacancy was submitted and is pending administrator approval.';
        }
        form.hidden = true;
        show('successMessage', true);
        App.toast('Job submitted for review.', 'success');
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
          window.scrollTo(0, 0);
        }
      }).catch(function (err) {
        message('postJobMessage', errMsg(err));
        App.toast(errMsg(err), 'error');
      }).then(function () {
        if (button) App.setLoading(button, false);
      });
    });
  });
  App.onPage('admin', function adminPage() {
    function setTbody(tableId, rows, colspan, emptyText) {
      var body = qs('#' + tableId + ' tbody');
      if (!body) return;
      body.innerHTML = rows || '<tr><td colspan="' + Number(colspan) + '" class="admin-empty">' + esc(emptyText) + '</td></tr>';
    }

    var admin = {
      currentReviewId: null,
      candidatesById: {},

      key: function () {
        try {
          return sessionStorage.getItem('habesha_admin_key') || '';
        } catch (e) {
          return '';
        }
      },

      saveKey: function () {
        var value = val('adminKey').trim();
        try {
          if (value) sessionStorage.setItem('habesha_admin_key', value);
          else sessionStorage.removeItem('habesha_admin_key');
        } catch (e) {
          /* session storage may be disabled; session auth still works */
        }
        this.msg(value ? 'Admin key saved for this tab.' : 'Admin key cleared.', false);
        App.toast(value ? 'Admin key saved for this tab.' : 'Admin key cleared.', 'success');
        this.refreshAll();
      },

      msg: function (content, isError) {
        var node = byId('adminMsg');
        if (!node) {
          if (content && isError) App.toast(content, 'error');
          return;
        }
        node.textContent = content == null ? '' : String(content);
        node.className = isError ? 'alert alert-error' : 'muted';
      },

      api: function (path, options) {
        var opts = Object.assign({}, options || {});
        var headers = Object.assign({}, opts.headers || {});
        var key = this.key();
        if (key) headers['x-admin-key'] = key;
        opts.headers = headers;
        return App.api(path, opts);
      },

      esc: function (value) {
        return esc(value);
      },

      fmtDate: function (value) {
        if (!value) return '—';
        var date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
        try {
          return date.toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
          });
        } catch (e) {
          return String(value).slice(0, 10);
        }
      },

      num: function (value) {
        if (value == null || value === '') return 0;
        var number = Number(value);
        return Number.isFinite(number) ? number : 0;
      },

      pill: function (value) {
        var raw = String(value || '').toLowerCase().replace(/\s+/g, '_');
        return '<span class="pill status-' + esc(raw) + '">' + esc(value || '') + '</span>';
      },

      short: function (value, length) {
        var text = String(value == null ? '' : value);
        var limit = Number(length) || 60;
        return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
      },

      showTab: function (name) {
        var tab = String(name || 'overview');
        qsa('.admin-panel').forEach(function (panel) {
          panel.hidden = (panel.getAttribute('data-panel') || panel.getAttribute('data-admin-tab')) !== tab;
        });
        qsa('.admin-tab').forEach(function (button) {
          var active = button.getAttribute('data-admin-tab') === tab;
          button.classList.toggle('active', active);
          button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (tab === 'review') this.loadReview();
        else if (tab === 'audit') this.loadAudit();
        else if (tab === 'sources') this.loadSources();
        else if (tab === 'monitoring') this.loadMonitoring();
        else if (tab === 'employers') this.loadEmployers();
        else if (tab === 'runs') { this.loadRuns(); this.loadSubs(); }
        else if (tab === 'jobs') this.loadJobs();
        else { this.loadStats(); this.loadExtraction(); }
      },

      refreshAll: function () {
        var self = this;
        return Promise.allSettled([
          self.loadStats(), self.loadSources(), self.loadMonitoring(), self.loadRuns(),
          self.loadSubs(), self.loadJobs(), self.loadReview(), self.loadExtraction(),
          self.loadEmployers(), self.loadAudit()
        ]);
      },

      loadStats: function () {
        var self = this;
        return this.api('/api/admin/stats').then(function (data) {
          var stats = (data && data.stats) || {};
          var totals = stats.totals || {};
          var queue = stats.queue || {};
          var extraction = stats.extraction || {};
          var sources = stats.sources || {};
          var runs = stats.runs24h || {};
          var apply = stats.apply || {};
          var cards = [
            ['Total listings', totals.total, (stats.newToday || 0) + ' new today'],
            ['Active vacancies', totals.active, (stats.newThisWeek || 0) + ' this week'],
            ['Pending', totals.pending, 'awaiting publication'],
            ['Needs review', totals.needs_review, 'quality flags'],
            ['Expired', totals.expired, 'not publicly listed'],
            ['Missing apply link', totals.missing_apply, 'needs correction'],
            ['Verified apply links', totals.apply_verified, 'avg confidence ' + (apply.avg_confidence == null ? 0 : apply.avg_confidence) + '%'],
            ['Organizations', totals.organizations, (totals.org_unverified || 0) + ' unverified'],
            ['Duplicates queued', stats.duplicates, 'merge queue'],
            ['Sources enabled', (sources.enabled == null ? 0 : sources.enabled) + '/' + (sources.total == null ? 0 : sources.total), (sources.stale || 0) + ' stale >24h'],
            ['Failed sources', sources.failed, 'error / blocked'],
            ['Sync success 24h', runs.successRate == null ? '—' : runs.successRate + '%', (runs.ok || 0) + ' ok / ' + (runs.failed || 0) + ' failed'],
            ['Queue pending', queue.pending, (queue.failed || 0) + ' failed'],
            ['Extraction failed', extraction.failed, (extraction.needs_manual_review || 0) + ' manual review']
          ];
          var holder = byId('statsCards');
          if (holder) {
            holder.innerHTML = cards.map(function (card) {
              return '<div class="admin-card"><h4>' + esc(card[0]) + '</h4><div class="n">' + esc(card[1] == null ? 0 : card[1]) +
                '</div>' + (card[2] ? '<div class="sub">' + esc(card[2]) + '</div>' : '') + '</div>';
            }).join('');
          }
        }).catch(function (err) {
          self.msg('Stats: ' + errMsg(err), true);
        });
      },

      loadExtraction: function () {
        var self = this;
        return this.api('/api/admin/extraction').then(function (data) {
          var queue = (data && data.queue) || {};
          var locks = (data && data.locks) || [];
          var cards = [
            ['Pending', queue.pending], ['Extracting', queue.extracting], ['Extracted', queue.extracted],
            ['Failed', queue.failed], ['Skipped', queue.skipped], ['Duplicates', queue.duplicate], ['Queue total', queue.total]
          ];
          var holder = byId('queueCards');
          if (holder) {
            holder.innerHTML = cards.map(function (card) {
              return '<div class="admin-card"><h4>' + esc(card[0]) + '</h4><div class="n">' + self.num(card[1]) + '</div></div>';
            }).join('');
          }
          setTbody('locksTable', locks.map(function (lock) {
            return '<tr><td><code>' + esc(lock.lock_key) + '</code></td><td>' + esc(lock.owner || '—') +
              '</td><td>' + esc(self.fmtDate(lock.locked_at)) + '</td><td>' + esc(self.fmtDate(lock.expires_at)) + '</td></tr>';
          }).join(''), 4, 'No active locks.');
        }).catch(function (err) {
          self.msg('Extraction: ' + errMsg(err), true);
        });
      },

      requeueFailed: function () {
        var self = this;
        this.msg('Requeueing failed discovery items…');
        return this.api('/api/admin/extraction', {
          method: 'POST', body: { action: 'requeue', limit: 200 }
        }).then(function (data) {
          self.msg('Requeued ' + self.num(data && data.requeued) + ' failed items.');
          App.toast('Failed items requeued.', 'success');
          return self.loadExtraction();
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      runExtraction: function () {
        var self = this;
        this.msg('Running extraction batch…');
        return this.api('/api/admin/extraction', { method: 'POST', body: { action: 'run' } }).then(function (data) {
          self.msg('Extraction finished: ' + JSON.stringify((data && data.result) || {}));
          App.toast('Extraction finished.', 'success');
          return self.refreshAll();
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      loadSources: function () {
        var self = this;
        return this.api('/api/admin/sources').then(function (data) {
          var sources = (data && data.sources) || [];
          setTbody('sourcesTable', sources.map(function (source) {
            var slug = esc(source.slug);
            var enabled = !!source.enabled;
            var queue = self.num(source.queue_pending) + 'p / ' + self.num(source.queue_failed) + 'f / ' + self.num(source.queue_total) + ' total';
            return '<tr><td><strong>' + esc(source.name) + '</strong><br><small class="muted">' + slug +
              '</small><br><small class="muted">' + esc(self.short(source.base_url || source.listing_url || '', 90)) + '</small></td>' +
              '<td><code>' + esc(source.adapter_key || 'legacy') + '</code></td>' +
              '<td>' + self.pill(source.integration_status) + '<br><small class="muted">' + esc(self.short(source.status_note || source.last_error || '', 90)) + '</small></td>' +
              '<td>' + (enabled ? 'Yes' : 'No') + '</td><td>' + esc(queue) + '</td>' +
              '<td>' + self.num(source.listing_count) + ' <small class="muted">(' + self.num(source.pending_count) + ' pending, ' + self.num(source.missing_apply) + ' no apply)</small></td>' +
              '<td>' + esc(self.fmtDate(source.last_discovery_at || source.last_sync_at)) + '</td>' +
              '<td class="admin-actions"><button class="btn btn-secondary" data-admin-action="toggle-source" data-slug="' + slug + '" data-enabled="' + (enabled ? 'true' : 'false') + '">' +
              (enabled ? 'Disable' : 'Enable') + '</button> <button class="btn btn-primary" data-admin-action="sync-source" data-slug="' + slug + '">Sync</button></td></tr>';
          }).join(''), 8, 'No sources configured.');
        }).catch(function (err) {
          self.msg('Sources: ' + errMsg(err), true);
        });
      },

      loadMonitoring: function () {
        var self = this;
        return this.api('/api/admin/sources?view=monitoring').then(function (data) {
          var sources = (data && data.sources) || [];
          setTbody('monitoringTable', sources.map(function (source) {
            return '<tr><td><strong>' + esc(source.name) + '</strong><br><small class="muted">' + esc(source.slug) + '</small></td>' +
              '<td>' + self.pill(source.status) + '<br><small class="muted">' + esc(self.short(source.status_note || source.last_run_message || source.last_error || '', 80)) + '</small></td>' +
              '<td>' + esc(self.fmtDate(source.last_fetch)) + '</td><td>' + self.num(source.jobs_found) + '</td>' +
              '<td>' + self.num(source.new_jobs) + '</td><td>' + self.num(source.updated) + '</td>' +
              '<td>' + self.num(source.errors) + '</td></tr>';
          }).join(''), 7, 'No sources configured.');
        }).catch(function (err) {
          self.msg('Source monitoring: ' + errMsg(err), true);
        });
      },

      toggleSource: function (slug, enabled) {
        var self = this;
        if (!slug) return;
        return this.api('/api/admin/sources', {
          method: 'POST', body: { action: 'setEnabled', slug: slug, enabled: enabled === true || enabled === 'true' }
        }).then(function () {
          self.msg('Source updated.');
          App.toast('Source updated.', 'success');
          return self.loadSources();
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      syncSource: function (slug) {
        var self = this;
        if (!slug) return;
        this.msg('Syncing ' + slug + '…');
        return this.api('/api/admin/sync', { method: 'POST', body: { slug: slug } }).then(function (data) {
          self.msg('Sync result: ' + JSON.stringify((data && data.result) || {}));
          App.toast('Source sync finished.', 'success');
          return self.refreshAll();
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      syncAll: function () {
        var self = this;
        this.msg('Syncing enabled sources…');
        return this.api('/api/admin/sync', { method: 'POST', body: {} }).then(function (data) {
          self.msg('Sync result: ' + JSON.stringify((data && data.result) || {}));
          App.toast('Source sync finished.', 'success');
          return self.refreshAll();
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      loadRuns: function () {
        var self = this;
        return this.api('/api/admin/runs').then(function (data) {
          var runs = (data && data.runs) || [];
          setTbody('runsTable', runs.map(function (run) {
            return '<tr><td>' + esc(self.fmtDate(run.started_at)) + '</td><td>' + esc(run.source_name || run.source_slug || 'all') +
              '</td><td>' + esc(run.trigger_type) + '</td><td>' + self.pill(run.status) + '</td>' +
              '<td>' + self.num(run.discovered_count) + '</td><td>' + self.num(run.extracted_count) + '</td>' +
              '<td>' + self.num(run.apply_found_count) + '</td><td>' + self.num(run.needs_review_count) + '</td>' +
              '<td>' + self.num(run.duplicate_count) + '</td><td>' + self.num(run.error_count) + '</td>' +
              '<td>' + (run.duration_ms == null ? '—' : esc((run.duration_ms / 1000).toFixed(1) + 's')) + '</td>' +
              '<td>' + esc(self.short(run.message || run.last_error || '', 80)) + '</td></tr>';
          }).join(''), 12, 'No sync runs recorded.');
        }).catch(function () { /* silent until a key or session is present */ });
      },

      loadSubs: function () {
        var self = this;
        return this.api('/api/admin/submissions').then(function (data) {
          var submissions = (data && data.submissions) || [];
          setTbody('subsTable', submissions.map(function (submission) {
            var payload = submission.payload || {};
            var id = esc(submission.id);
            var pending = submission.approval_status === 'pending';
            return '<tr><td>' + id + '</td><td>' + esc(payload.company || submission.organization_name) + '</td>' +
              '<td>' + esc(payload.title) + '</td><td>' + self.pill(submission.approval_status) + '</td>' +
              '<td>' + esc(String(submission.created_at || '').slice(0, 10)) + '</td>' +
              '<td class="admin-actions">' + (pending
                ? '<button class="btn btn-primary" data-admin-action="approve-sub" data-id="' + id + '">Approve</button> <button class="btn btn-secondary" data-admin-action="reject-sub" data-id="' + id + '">Reject</button>'
                : '') + '</td></tr>';
          }).join(''), 6, 'No submissions.');
        }).catch(function () { /* silent until a key or session is present */ });
      },

      approveSub: function (id) {
        var self = this;
        if (!id) return;
        return this.api('/api/admin/submissions', { method: 'POST', body: { action: 'approve', id: id } }).then(function () {
          self.msg('Submission approved.');
          App.toast('Submission approved.', 'success');
          return self.refreshAll();
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      rejectSub: function (id) {
        var self = this;
        if (!id) return;
        var note = window.prompt('Reviewer note (optional)') || '';
        return this.api('/api/admin/submissions', { method: 'POST', body: { action: 'reject', id: id, note: note } }).then(function () {
          self.msg('Submission rejected.');
          App.toast('Submission rejected.', 'success');
          return self.refreshAll();
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      loadJobs: function () {
        var self = this;
        var status = val('jobStatusFilter');
        return this.api('/api/admin/jobs' + (status ? '?status=' + encodeURIComponent(status) : '')).then(function (data) {
          var jobs = (data && data.jobs) || [];
          setTbody('jobsTable', jobs.map(function (job) {
            var id = esc(job.id);
            var jobStatus = job.status;
            var action = jobStatus === 'active' ? 'archive' : 'activate';
            var featured = !!job.featured;
            var applyHtml = job.apply_url
              ? self.pill(job.apply_url_verified ? 'verified' : 'unverified') + '<br><small class="muted">' + self.num(job.apply_url_confidence) + '%</small>'
              : self.pill('missing');
            return '<tr><td>' + id + '</td><td><strong>' + esc(job.title) + '</strong><br><small class="muted">' + esc(job.category || '') + '</small></td>' +
              '<td>' + esc(job.company) + '</td><td>' + esc(job.source_name || '—') + '</td><td>' + self.pill(jobStatus) + '</td>' +
              '<td>' + self.pill(job.review_status || 'unreviewed') + '<br><small class="muted">' + esc(job.extraction_status || '') + '</small></td>' +
              '<td>' + applyHtml + '</td><td>' + esc(String(job.deadline || '').slice(0, 10)) + '</td>' +
              '<td class="admin-actions"><button class="btn btn-secondary" data-admin-action="open-review" data-id="' + id + '">Review</button> ' +
              '<button class="btn btn-secondary" data-admin-action="job-action" data-id="' + id + '" data-action="' + esc(action) + '">' + (jobStatus === 'active' ? 'Archive' : 'Activate') + '</button> ' +
              '<button class="btn btn-secondary" data-admin-action="job-action" data-id="' + id + '" data-action="feature" data-featured="' + (featured ? 'true' : 'false') + '">' +
              (featured ? 'Unfeature' : 'Feature') + '</button></td></tr>';
          }).join(''), 9, 'No jobs match this filter.');
        }).catch(function () { /* silent until a key or session is present */ });
      },

      jobAction: function (id, action, featured) {
        var self = this;
        if (!id || !action) return;
        return this.api('/api/admin/jobs', {
          method: 'POST',
          body: { id: id, action: action, featured: featured === true || featured === 'true' }
        }).then(function () {
          self.msg('Job updated.');
          App.toast('Job updated.', 'success');
          return Promise.all([self.loadJobs(), self.loadStats()]);
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      loadReview: function () {
        var self = this;
        var status = val('reviewFilter');
        return this.api('/api/admin/review' + (status ? '?reviewStatus=' + encodeURIComponent(status) : '')).then(function (data) {
          var jobs = (data && data.jobs) || [];
          var badge = byId('reviewCountBadge');
          if (badge) badge.textContent = String(jobs.length);
          setTbody('reviewTable', jobs.map(function (job) {
            var id = esc(job.id);
            var applyHtml = job.apply_url
              ? self.pill(job.apply_url_verified ? 'verified' : 'unverified') + '<br><small class="muted">' + esc(job.apply_url_type || '') + ' · ' + self.num(job.apply_url_confidence) + '%</small>'
              : self.pill('missing');
            return '<tr><td>' + id + '</td><td><strong>' + esc(job.title) + '</strong><br><small class="muted">' + esc(job.company || 'Organization not verified') + '</small></td>' +
              '<td>' + esc(job.source_name || '—') + '</td><td>' + self.pill(job.status) + '<br><small class="muted">' + esc(job.review_status || '') + '</small></td>' +
              '<td>' + self.pill(job.extraction_status || 'unknown') + '<br><small class="muted">quality ' + self.num(job.quality_score) + '</small></td>' +
              '<td>' + applyHtml + '</td><td>' + self.num(job.candidate_count) + '</td>' +
              '<td class="admin-actions"><button class="btn btn-primary" data-admin-action="open-review" data-id="' + id + '">Open</button> ' +
              '<button class="btn btn-secondary" data-admin-action="retry-review" data-id="' + id + '">Retry</button></td></tr>';
          }).join(''), 8, 'Nothing needs review.');
        }).catch(function (err) {
          self.msg('Review: ' + errMsg(err), true);
        });
      },

      openReview: function (id) {
        var self = this;
        if (!id) return;
        this.currentReviewId = id;
        var box = byId('reviewDetail');
        if (!box) return;
        box.hidden = false;
        box.innerHTML = '<p class="muted">Loading review detail…</p>';
        return this.api('/api/admin/jobs?id=' + encodeURIComponent(id)).then(function (data) {
          var job = (data && data.job) || {};
          var candidates = (data && data.candidates) || [];
          var auditRows = (data && data.audit) || [];
          var pairs = [
            ['Listing ID', job.id], ['Status', job.status], ['Review status', job.review_status || 'unreviewed'],
            ['Extraction', job.extraction_status || '—'], ['Employer', job.company || 'Organization not verified'],
            ['Organization verified', job.organization_verified ? 'Yes' : 'No'],
            ['Source (admin only)', (job.source_name || '—') + ' (' + (job.source_slug || '—') + ')'],
            ['Listing page URL', job.listing_page_url], ['Original job URL', job.original_job_url || job.original_url],
            ['Canonical job URL', job.canonical_job_url], ['Apply URL', job.apply_url],
            ['Apply type', job.apply_url_type], ['Apply verified', job.apply_url_verified ? 'Yes' : 'No'],
            ['Apply confidence', job.apply_url_confidence == null ? '—' : job.apply_url_confidence + '%'],
            ['Quality score', job.quality_score], ['Deadline', job.deadline ? String(job.deadline).slice(0, 10) : '—'],
            ['Posted', job.posted_date ? String(job.posted_date).slice(0, 10) : '—'],
            ['Last verified', self.fmtDate(job.last_verified_at)]
          ];
          var urlLabels = { 'Listing page URL': 1, 'Original job URL': 1, 'Canonical job URL': 1, 'Apply URL': 1 };
          var keyHtml = pairs.map(function (pair) {
            var label = String(pair[0]);
            var value = pair[1];
            return '<div><span>' + esc(label) + '</span><strong class="' + (urlLabels[label] ? 'admin-url' : '') + '">' +
              esc(value == null || value === '' ? '—' : value) + '</strong></div>';
          }).join('');
          self.candidatesById = {};
          candidates.forEach(function (candidate) { self.candidatesById[String(candidate.id)] = candidate.url; });
          var candidateRows = candidates.length ? candidates.map(function (candidate) {
            return '<tr><td><span class="admin-url">' + esc(candidate.url) + '</span></td><td>' + self.pill(candidate.url_type || 'unknown') +
              '</td><td>' + self.num(candidate.confidence) + '%</td><td>' + esc(candidate.source || '—') + '</td>' +
              '<td>' + esc(self.short(candidate.label || candidate.context || '', 70)) + '</td><td>' + self.pill(candidate.verified ? 'verified' : 'unverified') +
              '</td><td><button class="btn btn-secondary" data-admin-action="use-candidate" data-id="' + esc(candidate.id) + '">Use</button></td></tr>';
          }).join('') : '<tr><td colspan="7" class="admin-empty">No application candidates captured.</td></tr>';
          var auditHtml = auditRows.length ? auditRows.map(function (entry) {
            return '<tr><td>' + esc(self.fmtDate(entry.created_at)) + '</td><td>' + esc(entry.actor || 'admin') + '</td>' +
              '<td>' + esc(entry.action) + '</td><td>' + esc(entry.field || '—') + '</td>' +
              '<td><span class="admin-url">' + esc(self.short(entry.old_value || '—', 50)) + ' → ' + esc(self.short(entry.new_value || '—', 50)) +
              '</span></td><td>' + esc(entry.note || '') + '</td></tr>';
          }).join('') : '<tr><td colspan="6" class="admin-empty">No audit entries yet.</td></tr>';
          var reviewId = esc(id);
          box.innerHTML = '<div class="admin-toolbar"><h3>Review: ' + esc(job.title || ('#' + id)) + '</h3>' +
            '<button class="btn btn-secondary" data-admin-action="close-review">Close</button></div>' +
            '<div class="admin-kv">' + keyHtml + '</div>' +
            '<div class="admin-apply-row"><input id="manualApplyUrl" type="url" class="form-control" placeholder="https://employer.example/careers/apply/123 or mailto:jobs@employer.example" value="' + esc(job.apply_url || '') + '">' +
            '<button class="btn btn-primary" data-admin-action="save-apply" data-id="' + reviewId + '">Save apply URL</button></div>' +
            '<textarea id="reviewNote" class="form-control admin-note" rows="3" placeholder="Reviewer note (recorded in audit trail)"></textarea>' +
            '<div class="admin-actions" style="margin-bottom:1rem">' +
            '<button class="btn btn-primary" data-admin-action="approve-review" data-id="' + reviewId + '">Approve &amp; publish</button> ' +
            '<button class="btn btn-secondary" data-admin-action="reject-review" data-id="' + reviewId + '">Reject</button> ' +
            '<button class="btn btn-secondary" data-admin-action="retry-review" data-id="' + reviewId + '">Retry extraction</button></div>' +
            '<div class="admin-split"><div class="admin-sub"><h4>Application link candidates</h4><div class="table-responsive"><table class="table admin-table">' +
            '<thead><tr><th>URL</th><th>Type</th><th>Conf.</th><th>Source</th><th>Label</th><th>Verified</th><th></th></tr></thead><tbody>' + candidateRows + '</tbody></table></div></div>' +
            '<div class="admin-sub"><h4>Audit trail for this job</h4><div class="table-responsive"><table class="table admin-table">' +
            '<thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Field</th><th>Change</th><th>Note</th></tr></thead><tbody>' + auditHtml + '</tbody></table></div></div></div>';
          try {
            box.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (e) {
            /* older browsers */
          }
        }).catch(function (err) {
          box.innerHTML = '<p class="alert alert-error">Could not load review detail: ' + esc(errMsg(err)) + '</p>';
        });
      },

      closeReview: function () {
        var box = byId('reviewDetail');
        if (box) {
          box.hidden = true;
          box.innerHTML = '';
        }
        this.currentReviewId = null;
      },

      reviewNote: function () {
        return val('reviewNote').trim();
      },

      saveApply: function (id, explicitUrl) {
        var self = this;
        if (!id) return;
        var url = explicitUrl || val('manualApplyUrl').trim();
        if (!url) {
          this.msg('Enter a valid employer application URL.', true);
          App.toast('Enter a valid employer application URL.', 'error');
          return;
        }
        return this.api('/api/admin/review', {
          method: 'POST', body: { action: 'apply', id: id, url: url, note: self.reviewNote() }
        }).then(function (data) {
          self.msg('Apply URL saved (' + ((data && data.result && data.result.applyUrlType) || 'validated') + ').');
          App.toast('Apply URL saved.', 'success');
          return Promise.all([self.openReview(id), self.loadReview(), self.loadJobs(), self.loadStats()]);
        }).catch(function (err) {
          self.msg('Apply URL: ' + errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      useCandidate: function (candidateId) {
        var url = this.candidatesById[String(candidateId)];
        if (!url) {
          this.msg('Candidate not found — reload the review detail.', true);
          App.toast('Candidate not found.', 'error');
          return;
        }
        setVal('manualApplyUrl', url);
        this.msg('Candidate loaded into the apply URL field. Review it, then save.');
      },

      approveReview: function (id) {
        var self = this;
        if (!id) return;
        return this.api('/api/admin/review', {
          method: 'POST', body: { action: 'approve', id: id, note: self.reviewNote() }
        }).then(function () {
          self.msg('Job approved and published if eligible.');
          App.toast('Review approved.', 'success');
          return Promise.all([self.openReview(id), self.loadReview(), self.loadJobs(), self.loadStats()]);
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      rejectReview: function (id) {
        var self = this;
        if (!id) return;
        var note = self.reviewNote() || window.prompt('Reason for rejection (optional)') || '';
        return this.api('/api/admin/review', {
          method: 'POST', body: { action: 'reject', id: id, note: note }
        }).then(function () {
          self.msg('Job rejected.');
          App.toast('Review rejected.', 'success');
          return Promise.all([self.openReview(id), self.loadReview(), self.loadJobs(), self.loadStats()]);
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      retryReview: function (id) {
        var self = this;
        if (!id) return;
        return this.api('/api/admin/review', { method: 'POST', body: { action: 'retry', id: id } }).then(function () {
          self.msg('Extraction retry queued.');
          App.toast('Extraction retry queued.', 'success');
          return Promise.all([self.openReview(id), self.loadReview(), self.loadExtraction()]);
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      loadEmployers: function () {
        var self = this;
        var query = val('employerSearch').trim();
        return this.api('/api/admin/employers?limit=200' + (query ? '&q=' + encodeURIComponent(query) : '')).then(function (data) {
          var employers = (data && data.employers) || [];
          setTbody('employersTable', employers.map(function (employer) {
            var logo = safeEmployerUrl(employer.logo_public_url);
            var website = safeEmployerUrl(employer.website_url);
            var logoCell = logo
              ? '<img src="' + esc(logo) + '" alt="" width="34" height="34" class="admin-logo">'
              : '<span class="muted">—</span>';
            var id = esc(employer.id);
            return '<tr><td>' + id + '</td><td><strong>' + esc(employer.name) + '</strong><br><small class="muted">' + esc(employer.name_key || '') + '</small></td>' +
              '<td>' + (website ? '<a href="' + esc(website) + '" target="_blank" rel="noopener noreferrer" class="admin-url">' + esc(self.short(website, 46)) + '</a>' : '<span class="muted">—</span>') + '</td>' +
              '<td>' + logoCell + '</td><td>' + self.pill(employer.logo_verified ? 'verified' : 'unverified') + '<br><small class="muted">' + esc(employer.logo_source || 'none') + ' · ' + self.num(employer.logo_confidence) + '%</small></td>' +
              '<td>' + self.num(employer.active_count) + ' <small class="muted">/ ' + self.num(employer.listing_count) + '</small></td>' +
              '<td class="admin-actions"><button class="btn btn-secondary" data-admin-action="edit-employer" data-id="' + id + '">Set logo</button></td></tr>';
          }).join(''), 7, 'No organisations yet.');
        }).catch(function (err) {
          self.msg('Employers: ' + errMsg(err), true);
        });
      },

      editEmployer: function (id) {
        var self = this;
        if (!id) return;
        var logo = window.prompt('Official logo URL for this organisation (https://...):\nLeave empty to clear it.', '');
        if (logo === null) return;
        var website = window.prompt('Official website URL (optional, https://...):', '');
        if (website === null) return;
        var payload = { id: id, logoUrl: logo.trim() || null };
        if (website.trim()) payload.websiteUrl = website.trim();
        return this.api('/api/admin/employers', { method: 'POST', body: payload }).then(function () {
          self.msg('Organisation updated.');
          App.toast('Organisation updated.', 'success');
          return self.loadEmployers();
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      },

      loadAudit: function () {
        var self = this;
        return this.api('/api/admin/audit?limit=150').then(function (data) {
          var audit = (data && data.audit) || [];
          setTbody('auditTable', audit.map(function (entry) {
            return '<tr><td>' + esc(self.fmtDate(entry.created_at)) + '</td><td>' + esc(entry.listing_title || (entry.listing_id ? '#' + entry.listing_id : '—')) +
              '</td><td>' + esc(entry.actor || 'admin') + '</td><td>' + self.pill(entry.action) + '</td>' +
              '<td>' + esc(entry.field || '—') + '</td><td><span class="admin-url">' + esc(self.short(entry.old_value || '—', 50)) + ' → ' +
              esc(self.short(entry.new_value || '—', 50)) + '</span></td><td>' + esc(self.short(entry.note || '', 70)) + '</td></tr>';
          }).join(''), 7, 'No audit entries yet.');
        }).catch(function () { /* silent until a key or session is present */ });
      },

      migrate: function () {
        var self = this;
        return this.api('/api/admin/migrate', { method: 'POST', body: {} }).then(function (data) {
          self.msg('Migration result: ' + JSON.stringify((data && data.result) || {}));
          App.toast('Migration finished.', 'success');
          return self.refreshAll();
        }).catch(function (err) {
          self.msg(errMsg(err), true);
          App.toast(errMsg(err), 'error');
        });
      }
    };

    function safeEmployerUrl(value) {
      var raw = String(value || '').trim();
      return /^(https?:\/\/|\/)/i.test(raw) ? raw : '';
    }

    // Legacy admin scripts exposed this global; keep it as a thin compatibility shim.
    window.AdminApp = admin;

    document.addEventListener('click', function (event) {
      var origin = event && event.target;
      if (!origin || typeof origin.closest !== 'function') return;

      var tab = origin.closest('.admin-tab[data-admin-tab]');
      if (tab) {
        admin.showTab(tab.getAttribute('data-admin-tab') || 'overview');
        return;
      }

      var control = origin.closest('[data-admin-action]');
      if (!control || control.tagName === 'INPUT' || control.tagName === 'SELECT') return;

      var action = control.getAttribute('data-admin-action') || '';
      var id = control.getAttribute('data-id') || '';
      var reviewId = id || admin.currentReviewId || '';
      var slug = control.getAttribute('data-slug') || '';

      switch (action) {
        case 'save-key':
          admin.saveKey();
          break;
        case 'refresh':
          admin.msg('Refreshing…');
          admin.refreshAll();
          break;
        case 'load-extraction':
          admin.loadExtraction();
          break;
        case 'requeue-failed':
          admin.requeueFailed();
          break;
        case 'run-extraction':
          admin.runExtraction();
          break;
        case 'load-review':
          admin.loadReview();
          break;
        case 'load-jobs':
          admin.loadJobs();
          break;
        case 'sync-sources':
          admin.syncAll();
          break;
        case 'load-monitoring':
          admin.loadMonitoring();
          break;
        case 'load-employers':
          admin.loadEmployers();
          break;
        case 'load-runs':
          admin.loadRuns();
          break;
        case 'load-subs':
          admin.loadSubs();
          break;
        case 'load-audit':
          admin.loadAudit();
          break;
        case 'toggle-source':
          admin.toggleSource(slug, control.getAttribute('data-enabled'));
          break;
        case 'sync-source':
          admin.syncSource(slug);
          break;
        case 'approve-sub':
          admin.approveSub(id);
          break;
        case 'reject-sub':
          admin.rejectSub(id);
          break;
        case 'open-review':
          admin.openReview(id);
          break;
        case 'job-action':
          admin.jobAction(id, control.getAttribute('data-action') || '', control.getAttribute('data-featured'));
          break;
        case 'retry-review':
          admin.retryReview(reviewId);
          break;
        case 'close-review':
          admin.closeReview();
          break;
        case 'save-apply':
          admin.saveApply(reviewId);
          break;
        case 'use-candidate':
          admin.useCandidate(id);
          break;
        case 'approve-review':
          admin.approveReview(reviewId);
          break;
        case 'reject-review':
          admin.rejectReview(reviewId);
          break;
        case 'edit-employer':
          admin.editEmployer(id);
          break;
        default:
          break;
      }
    });

    var reviewFilter = byId('reviewFilter');
    if (reviewFilter) reviewFilter.addEventListener('change', function () { admin.loadReview(); });

    var jobStatusFilter = byId('jobStatusFilter');
    if (jobStatusFilter) jobStatusFilter.addEventListener('change', function () { admin.loadJobs(); });

    var employerSearch = byId('employerSearch');
    if (employerSearch) {
      var searchTimer = null;
      employerSearch.addEventListener('input', function () {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { admin.loadEmployers(); }, 250);
      });
      employerSearch.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (searchTimer) clearTimeout(searchTimer);
        admin.loadEmployers();
      });
    }

    setVal('adminKey', admin.key());
    var adminKeyInput = byId('adminKey');
    if (adminKeyInput) {
      adminKeyInput.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        admin.saveKey();
      });
    }

    admin.refreshAll();
  });
  App.onPage('contact', function contactPage() {
    var form = byId('contactForm');
    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var name = val('name').trim();
      var email = val('email').trim();
      var subject = val('subject').trim();
      var messageText = val('message').trim();

      if (!name || !email || !subject || !messageText) {
        message('contactSuccess', 'Please complete every required field.', 'error');
        App.toast('Please complete every required field.', 'error');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        message('contactSuccess', 'Please enter a valid email address.', 'error');
        App.toast('Please enter a valid email address.', 'error');
        return;
      }

      var body = messageText + '\n\nName: ' + name + '\nEmail: ' + email;
      var mailto = 'mailto:info@habeshacareers.com?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);

      var box = byId('contactSuccess');
      if (box) {
        var lead = document.createElement('strong');
        lead.textContent = 'Message ready.';
        var detail = document.createElement('span');
        detail.textContent = ' Your email app will open with these details filled in; nothing is sent until you choose Send there.';
        var link = document.createElement('a');
        link.href = mailto;
        link.textContent = 'Open your email app';

        box.textContent = '';
        box.appendChild(lead);
        box.appendChild(document.createTextNode(' '));
        box.appendChild(detail);
        box.appendChild(document.createTextNode(' '));
        box.appendChild(link);
        box.className = 'alert alert-success';
        box.hidden = false;
        box.setAttribute('role', 'status');
      }

      App.toast('Message prepared for your email app.', 'success');
    });
  });

  // Informational page; the shared shell and navigation are enough.
  App.onPage('about', function aboutPage() {});
})();
