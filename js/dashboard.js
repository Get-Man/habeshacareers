// Role-aware dashboard. Rendered only after the shared guard confirms a session.
(function () {
  'use strict';

  var ALL_ROLES = ['admin', 'employee', 'employer'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function roleOf(user) {
    return (user && (user.role || user.type)) || 'employee';
  }

  function roleMeta(role) {
    if (role === 'admin') return { label: 'Administrator', badge: 'badge-official' };
    if (role === 'employer') return { label: 'Employer', badge: 'badge-neutral' };
    return { label: 'Job Seeker', badge: 'badge-neutral' };
  }

  function displayName(user) {
    return user && (user.name || user.fullName || user.contactName || user.companyName || user.email) || 'there';
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return esc(value);
    return esc(date.toLocaleString());
  }

  function quickActions(role) {
    if (role === 'employer') {
      return [
        { icon: '➕', title: 'Post a job', desc: 'Publish a new vacancy for review.', href: 'post-job.html' },
        { icon: '🏢', title: 'Company profile', desc: 'Keep your organisation details current.', href: 'profile.html' },
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
      { icon: '🔎', title: 'Browse jobs', desc: 'Discover roles matched to your profile.', href: 'jobs.html' },
      { icon: '📝', title: 'Complete profile', desc: 'Strengthen your CV and application profile.', href: 'profile.html' },
      { icon: '⚙️', title: 'Account settings', desc: 'Update contact details and security.', href: 'account.html' }
    ];
  }

  function renderActions(role) {
    var container = document.getElementById('quickActions');
    if (!container) return;
    container.innerHTML = quickActions(role).map(function (action) {
      return '<div class="card card-hover">' +
        '<div style="font-size: 1.6rem; line-height: 1; margin-bottom: .5rem;">' + action.icon + '</div>' +
        '<h4 class="card-title">' + esc(action.title) + '</h4>' +
        '<p>' + esc(action.desc) + '</p>' +
        '<p><a href="' + esc(action.href) + '" class="btn btn-primary btn-sm">Open</a></p>' +
        '</div>';
    }).join('');
  }

  function completionFields(role, user, profile) {
    function pick(key) {
      if (user && user[key]) return user[key];
      return profile && profile[key] ? profile[key] : null;
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

  function renderCompletion(role, user, profile, profileFailed) {
    var container = document.getElementById('completionContent');
    if (!container) return;
    var fields = completionFields(role, user, profile);
    var done = fields.filter(function (f) { return !!f.value; }).length;
    var percent = fields.length ? Math.round((done / fields.length) * 100) : 0;
    var missing = fields.filter(function (f) { return !f.value; });

    var html = '<p><strong>' + percent + '%</strong> complete — ' + done + ' of ' + fields.length + ' key details filled in.</p>' +
      '<progress max="100" value="' + percent + '" style="width: 100%; max-width: 100%;"></progress>';
    if (missing.length) {
      html += '<p class="chip-label" style="margin-top: .75rem;">Still missing</p><p>' +
        missing.map(function (f) { return '<span class="chip badge-neutral">' + esc(f.label) + '</span>'; }).join(' ') + '</p>';
    } else {
      html += '<p style="margin-top: .75rem;"><span class="chip badge-official">✓ Looking good</span></p>';
    }
    if (profileFailed) {
      html += '<p class="alert alert-warning" style="margin-top: .75rem;">Extra profile details are unavailable right now — showing basic account info only.</p>';
    }
    container.innerHTML = html;
  }

  function renderAccountSummary(user, sessions, sessionsFailed) {
    var container = document.getElementById('accountSummary');
    if (!container) return;
    var html = '<div class="profile-details-grid">' +
      '<div class="profile-detail-item"><span class="detail-label">Email</span><span class="detail-value">' + esc(user.email || '—') + '</span></div>' +
      '<div class="profile-detail-item"><span class="detail-label">Member since</span><span class="detail-value">' + formatDate(user.createdAt) + '</span></div>' +
      '</div>';

    if (sessionsFailed) {
      html += '<p class="alert alert-warning" style="margin-top: .75rem;">Session activity is unavailable right now.</p>';
    } else if (!sessions || !sessions.length) {
      html += '<p style="margin-top: .75rem;">No active sessions recorded.</p>';
    } else {
      var current = sessions.find(function (s) { return s.current; });
      html += '<p style="margin-top: .75rem;"><span class="chip badge-neutral">' + sessions.length +
        ' active ' + (sessions.length === 1 ? 'session' : 'sessions') + '</span></p>';
      if (current) {
        html += '<p>Last seen on this session: <strong>' + formatDate(current.last_seen_at || current.created_at) + '</strong></p>';
      }
    }
    container.innerHTML = html;
  }

  function showError(message) {
    var loading = document.getElementById('dashboardLoading');
    var error = document.getElementById('dashboardError');
    if (loading) loading.hidden = true;
    if (error) {
      error.textContent = message;
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

    var loading = document.getElementById('dashboardLoading');
    if (loading) loading.hidden = true;

    var role = roleOf(user);
    var meta = roleMeta(role);
    var welcome = document.getElementById('dashboardWelcome');
    if (welcome) welcome.textContent = 'Welcome, ' + displayName(user);
    var subtitle = document.getElementById('dashboardSubtitle');
    if (subtitle) {
      subtitle.textContent = role === 'admin'
        ? 'Your platform console and account are one click away.'
        : 'A quick look at your profile, activity and next steps.';
    }
    var badge = document.getElementById('dashboardRoleBadge');
    if (badge) {
      badge.textContent = meta.label;
      badge.classList.remove('badge-official', 'badge-neutral');
      badge.classList.add(meta.badge);
    }
    renderActions(role);

    var content = document.getElementById('dashboardContent');
    if (content) content.hidden = false;

    if (!window.HCAuth || typeof window.HCAuth.apiAuth !== 'function') {
      renderCompletion(role, user, null, true);
      renderAccountSummary(user, null, true);
      return;
    }

    var results = await Promise.allSettled([
      window.HCAuth.apiAuth('/api/account/profile', { method: 'GET' }),
      window.HCAuth.apiAuth('/api/account/session', { method: 'GET' })
    ]);

    var profile = null;
    var profileFailed = results[0].status !== 'fulfilled';
    if (!profileFailed && results[0].value && results[0].value.profile) {
      profile = results[0].value.profile;
      if (results[0].value.user) {
        try { window.HCAuth.setCurrentUser(results[0].value.user); } catch {}
      }
    }
    var sessions = [];
    var sessionsFailed = results[1].status !== 'fulfilled';
    if (!sessionsFailed && results[1].value && Array.isArray(results[1].value.sessions)) {
      sessions = results[1].value.sessions;
    }

    var latestUser = (results[0].value && results[0].value.user) || user;
    renderCompletion(role, latestUser, profile, profileFailed);
    renderAccountSummary(user, sessions, sessionsFailed);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
