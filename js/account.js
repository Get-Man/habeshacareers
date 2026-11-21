// Account settings: profile, password and session management.
// All endpoint calls use JSON with same-origin credentials via auth.js.
(function () {
  'use strict';

  var ALL_ROLES = ['admin', 'employee', 'employer'];
  var currentUser = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function value(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function setValue(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val == null ? '' : String(val);
  }

  function toggleHidden(id, show) {
    var el = document.getElementById(id);
    if (el) el.hidden = !show;
  }

  function message(id, text, type) {
    if (window.HCAuth && typeof window.HCAuth.showAuthMessage === 'function') {
      window.HCAuth.showAuthMessage(id, text, type);
      return;
    }
    var el = document.getElementById(id);
    if (!el) {
      if (text) alert(text);
      return;
    }
    el.textContent = text || '';
    el.className = 'alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    el.hidden = !text;
  }

  function api(path, options) {
    if (!window.HCAuth || typeof window.HCAuth.apiAuth !== 'function') {
      throw new Error('Account services are unavailable right now.');
    }
    return window.HCAuth.apiAuth(path, options);
  }

  function roleOf(user) {
    return (user && (user.role || user.type)) || 'employee';
  }

  function applyRoleFields(role) {
    var isEmployer = role === 'employer';
    toggleHidden('companyGroup', isEmployer);
    toggleHidden('contactGroup', isEmployer);
    toggleHidden('nameGroup', !isEmployer);
  }

  var SKIP_EXTRA_KEYS = {
    id: 1, user_id: 1, userId: 1, email: 1, role: 1, type: 1,
    name: 1, fullName: 1, company: 1, companyName: 1, contactName: 1,
    phone: 1, location: 1, createdAt: 1, created_at: 1
  };

  function fillProfile(user, profile) {
    setValue('accountName', (user && (user.name || user.fullName)) || '');
    setValue('accountCompany', (user && (user.companyName || user.company)) || '');
    setValue('accountContact', (user && user.contactName) || '');
    setValue('accountPhone', (user && user.phone) || '');
    setValue('accountLocation', (user && user.location) || '');

    var extra = {};
    if (profile && typeof profile === 'object') {
      Object.keys(profile).forEach(function (key) {
        if (!SKIP_EXTRA_KEYS[key]) extra[key] = profile[key];
      });
    }
    setValue('accountProfileJson', Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '');
  }

  function buildProfilePayload(role) {
    var payload = {};
    if (role === 'employer') {
      payload.companyName = value('accountCompany').trim();
      payload.contactName = value('accountContact').trim();
    } else {
      payload.name = value('accountName').trim();
    }
    payload.phone = value('accountPhone').trim();
    payload.location = value('accountLocation').trim();

    var raw = value('accountProfileJson').trim();
    var extra = {};
    if (raw) {
      try {
        extra = JSON.parse(raw);
      } catch (e) {
        message('profileMessage', 'More profile details must be valid JSON.');
        return null;
      }
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
        message('profileMessage', 'More profile details must be a JSON object.');
        return null;
      }
    }
    payload.profile = extra;
    return payload;
  }

  async function saveProfile(event) {
    event.preventDefault();
    message('profileMessage', '');
    var role = roleOf(currentUser);
    var payload = buildProfilePayload(role);
    if (!payload) return;

    var button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      var data = await api('/api/account/profile', { method: 'PATCH', body: JSON.stringify(payload) });
      if (data && data.user && window.HCAuth) {
        window.HCAuth.setCurrentUser(data.user);
        currentUser = window.HCAuth.getCurrentUser();
        try { window.HCAuth.updateNavigation(); } catch {}
      }
      if (data && data.profile) fillProfile(currentUser, data.profile);
      message('profileMessage', (data && data.message) || 'Profile saved.', 'success');
    } catch (err) {
      message('profileMessage', err.message || 'Could not save your profile.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    message('securityMessage', '');
    var current = value('currentPassword');
    var next = value('newPassword');
    var confirm = value('confirmPassword');
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
    var button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      var data = await api('/api/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      });
      // Never display or persist password values — clear the fields immediately.
      setValue('currentPassword', '');
      setValue('newPassword', '');
      setValue('confirmPassword', '');
      message('securityMessage', (data && data.message) || 'Password changed successfully.', 'success');
    } catch (err) {
      setValue('newPassword', '');
      setValue('confirmPassword', '');
      message('securityMessage', err.message || 'Could not change your password.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function formatDate(input) {
    if (!input) return '—';
    var date = new Date(input);
    if (Number.isNaN(date.getTime())) return esc(input);
    return esc(date.toLocaleString());
  }

  function sessionCard(session) {
    var isCurrent = !!session.current;
    return '<div class="card" style="margin-bottom: .75rem; box-shadow: none;">' +
      '<p style="margin: 0 0 .35rem;">' +
        '<strong>' + esc(session.user_agent || 'Unknown device') + '</strong> ' +
        (isCurrent ? '<span class="chip badge-official">This device</span>' : '') +
      '</p>' +
      '<p style="margin: 0 0 .35rem; font-size: .9rem;">Signed in: ' + formatDate(session.created_at) +
        ' · Last seen: ' + formatDate(session.last_seen_at) + '</p>' +
      (isCurrent ? '' : '<p style="margin: 0;"><button type="button" class="btn-secondary btn-sm" data-session-id="' +
        esc(session.id) + '">Sign out</button></p>') +
      '</div>';
  }

  function renderSessions(sessions) {
    var container = document.getElementById('sessionsList');
    if (!container) return;
    if (!sessions || !sessions.length) {
      container.innerHTML = '<div class="empty-state">No active sessions found.</div>';
      return;
    }
    container.innerHTML = sessions.map(sessionCard).join('');
  }

  async function loadSessions(showLoading) {
    var container = document.getElementById('sessionsList');
    if (showLoading && container) container.innerHTML = '<div class="empty-state">Loading sessions…</div>';
    try {
      var data = await api('/api/account/session', { method: 'GET' });
      var sessions = data && Array.isArray(data.sessions) ? data.sessions : [];
      renderSessions(sessions);
      return sessions;
    } catch (err) {
      if (container) {
        container.innerHTML = '<div class="alert alert-error">' + esc(err.message || 'Could not load sessions.') + '</div>';
      }
      return null;
    }
  }

  async function revokeSession(id) {
    message('sessionsMessage', '');
    try {
      await api('/api/account/session?id=' + encodeURIComponent(id), { method: 'DELETE' });
      message('sessionsMessage', 'That session has been signed out.', 'success');
    } catch (err) {
      message('sessionsMessage', err.message || 'Could not sign out that session.');
    }
    await loadSessions(true);
  }

  async function revokeOthers() {
    message('sessionsMessage', '');
    var button = document.getElementById('revokeOthersBtn');
    if (button) button.disabled = true;
    try {
      var data = await api('/api/account/session/revoke-others', { method: 'POST', body: '{}' });
      var count = data && typeof data.revoked === 'number' ? data.revoked : 0;
      message('sessionsMessage', count === 1 ? 'Signed out 1 other session.' : 'Signed out ' + count + ' other sessions.', 'success');
    } catch (err) {
      message('sessionsMessage', err.message || 'Could not sign out other sessions.');
    } finally {
      if (button) button.disabled = false;
    }
    await loadSessions(true);
  }

  function bindEvents() {
    var profileForm = document.getElementById('profileForm');
    if (profileForm) profileForm.addEventListener('submit', saveProfile);
    var passwordForm = document.getElementById('passwordForm');
    if (passwordForm) passwordForm.addEventListener('submit', changePassword);

    var list = document.getElementById('sessionsList');
    if (list) {
      list.addEventListener('click', function (event) {
        var target = event.target.closest('[data-session-id]');
        if (!target) return;
        var id = target.getAttribute('data-session-id');
        if (id) revokeSession(id);
      });
    }
    var revokeButton = document.getElementById('revokeOthersBtn');
    if (revokeButton) revokeButton.addEventListener('click', revokeOthers);
  }

  function showError(text) {
    var loading = document.getElementById('accountLoading');
    var error = document.getElementById('accountError');
    if (loading) loading.hidden = true;
    if (error) {
      error.textContent = text;
      error.hidden = false;
    }
  }

  async function init() {
    var guard = window.HCGuards && window.HCGuards.lastCheck;
    var user = null;
    try {
      user = guard ? await guard : (window.HCAuth ? await window.HCAuth.requireRole(ALL_ROLES) : null);
    } catch (e) {
      user = null;
    }
    if (!user) {
      showError('We could not confirm your session. Redirecting you to sign in…');
      return;
    }
    currentUser = user;

    var loading = document.getElementById('accountLoading');
    if (loading) loading.hidden = true;
    var content = document.getElementById('accountContent');
    if (content) content.hidden = false;

    applyRoleFields(roleOf(user));
    fillProfile(user, null);
    bindEvents();

    try {
      var data = await api('/api/account/profile', { method: 'GET' });
      if (data && data.user && window.HCAuth) {
        window.HCAuth.setCurrentUser(data.user);
        currentUser = window.HCAuth.getCurrentUser();
        try { window.HCAuth.updateNavigation(); } catch {}
      }
      fillProfile(currentUser, data && data.profile);
    } catch (err) {
      message('profileMessage', err.message || 'Could not load your profile details.');
    }

    await loadSessions(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
