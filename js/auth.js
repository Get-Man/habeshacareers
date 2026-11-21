// Standard authentication (server-backed sessions). Falls back gracefully if API/DB is unavailable.
// Roles: admin, employee (job seeker), employer. Public signup is employee/employer only.

function normalizeCurrentUser(user) {
  if (!user) return null;
  const role = user.role || (user.type === 'jobseeker' ? 'employee' : user.type === 'employer' ? 'employer' : user.type) || null;
  const type = role === 'employee' ? 'jobseeker' : role === 'employer' ? 'employer' : role;
  const name = user.name || user.fullName || user.contactName || user.companyName || user.company || null;
  return {
    ...user,
    role,
    type,
    name,
    fullName: user.fullName || name || null,
    company: user.company || user.companyName || null,
    companyName: user.companyName || user.company || null,
  };
}

function userRole(user) {
  if (!user) return null;
  return normalizeCurrentUser(user).role || null;
}

async function apiAuth(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.message || data.error || ('Request failed (' + res.status + ')'));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function getCurrentUser() {
  try {
    const user = localStorage.getItem('currentUser');
    return user ? normalizeCurrentUser(JSON.parse(user)) : null;
  } catch {
    return null;
  }
}

function setCurrentUser(user) {
  const normalized = normalizeCurrentUser(user);
  if (normalized) localStorage.setItem('currentUser', JSON.stringify(normalized));
  else localStorage.removeItem('currentUser');
  return normalized;
}

// The server is the source of truth. An explicit `authenticated: false` clears the cache.
function setSessionFromMe(data) {
  if (data && Object.prototype.hasOwnProperty.call(data, 'authenticated')) {
    return setCurrentUser(data.authenticated && data.user ? data.user : null);
  }
  return setCurrentUser(data && data.user ? data.user : null);
}

function isLoggedIn() {
  return getCurrentUser() !== null;
}

async function refreshCurrentUser() {
  try {
    const data = await apiAuth('/api/auth/me', { method: 'GET' });
    return setSessionFromMe(data);
  } catch {
    // keep cached user for offline/legacy cases
    return getCurrentUser();
  }
}

async function logout() {
  try {
    await apiAuth('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {}
  setCurrentUser(null);
  window.location.href = 'index.html';
}

// ---------- inline form messaging (alert() stays as a fallback) ----------
function showAuthMessage(elementId, message, type) {
  const el = elementId ? document.getElementById(elementId) : null;
  if (!el) {
    if (message) alert(message);
    return;
  }
  el.textContent = message || '';
  el.classList.remove('alert-error', 'alert-success', 'alert-info');
  el.classList.add(type === 'success' ? 'alert-success' : type === 'info' ? 'alert-info' : 'alert-error');
  el.hidden = !message;
  el.setAttribute('role', type === 'success' ? 'status' : 'alert');
}

function clearAuthMessage(elementId) {
  showAuthMessage(elementId, '', 'info');
}

// ---------- post-authentication navigation ----------
function currentPageFile() {
  const path = window.location.pathname || '';
  return path.split('/').pop() || 'index.html';
}

function safeNextPage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const file = decodeURIComponent(url.pathname.split('/').pop() || '');
    if (!/^[A-Za-z0-9._-]+\.html?$/.test(file)) return null;
    if (file.toLowerCase() === 'login.html') return null;
    return file;
  } catch {
    return null;
  }
}

function nextPageAllowsRole(file, user) {
  const role = userRole(user);
  if (file === 'admin.html') return role === 'admin';
  if (file === 'post-job.html') return role === 'employer' || role === 'admin';
  return true;
}

// Default: dashboard.html for every role except admin (admin console).
// A safe local `?next=` return path is honoured when it suits the signed-in role.
function postAuthRedirect(user) {
  const next = safeNextPage(new URLSearchParams(window.location.search).get('next'));
  if (next && nextPageAllowsRole(next, user)) return next;
  return userRole(user) === 'admin' ? 'admin.html' : 'dashboard.html';
}

// ---------- role guard (UX only; the server enforces access) ----------
async function requireRole(roles, redirect) {
  const allowed = Array.isArray(roles) ? roles.slice() : (roles ? [roles] : []);
  const target = (typeof redirect === 'string' && redirect) ? redirect : currentPageFile();

  let data = null;
  let verified = false;
  try {
    data = await apiAuth('/api/auth/me', { method: 'GET' });
    verified = true;
  } catch {
    // Endpoint not reachable yet (backend still deploying) — fall back to the cached session.
    data = null;
  }

  const user = verified ? setSessionFromMe(data) : getCurrentUser();
  try { updateNavigation(); } catch {}

  if (!user) {
    if (!/login\.html?$/.test(currentPageFile())) {
      window.location.replace('login.html?next=' + encodeURIComponent(target));
    }
    return null;
  }

  const role = userRole(user);
  const alias = user.type;
  if (allowed.length && !allowed.some((r) => r === role || r === alias)) {
    window.location.replace('dashboard.html');
    return null;
  }
  return user;
}

// ---------- navbar ----------
function navSetVisible(el, visible) {
  if (!el) return;
  el.style.display = visible ? '' : 'none';
}

function ensureNavItem(id, href, label, insertBeforeId) {
  let li = document.getElementById(id);
  if (li) return li;
  const nav = document.querySelector('.nav-menu');
  if (!nav) return null;
  // Only the main site pages get the extra links (login.html has a bare nav).
  if (!document.getElementById('loginLink') && !document.getElementById('profileLink') && !document.getElementById('postJobLink')) return null;
  li = document.createElement('li');
  li.id = id;
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  li.appendChild(a);
  const ref = insertBeforeId ? document.getElementById(insertBeforeId) : null;
  if (ref) nav.insertBefore(li, ref);
  else nav.appendChild(li);
  return li;
}

function updateNavigation() {
  const user = getCurrentUser();
  if (typeof updateNavbar === 'function') {
    try { updateNavbar(); } catch {}
  }

  const dashboardLink = ensureNavItem('dashboardLink', 'dashboard.html', 'Dashboard', 'loginLink');
  const accountLink = ensureNavItem('accountLink', 'account.html', 'Account', 'loginLink');
  navSetVisible(dashboardLink, !!user);
  navSetVisible(accountLink, !!user);
  navSetVisible(document.getElementById('profileLink'), !!user);
  navSetVisible(document.getElementById('loginLink'), !user);

  const postJobAnchor = document.getElementById('postJobLink')
    || (function () {
      const a = document.querySelector('a[href="post-job.html"]');
      return a ? a.closest('li') : null;
    })();
  const role = userRole(user);
  const canPost = !!user && (role === 'employer' || role === 'admin');
  navSetVisible(postJobAnchor, canPost);
}

// ---------- account recovery (forgot / reset) ----------
function showForgotPanel(show) {
  const panel = document.getElementById('forgotPanel');
  if (!panel) return;
  panel.hidden = !show;
  if (show) {
    const reset = document.getElementById('resetPanel');
    if (reset) reset.hidden = true;
    try { panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  }
}

function showResetPanel(show) {
  const panel = document.getElementById('resetPanel');
  if (!panel) return;
  panel.hidden = !show;
  if (show) {
    const forgot = document.getElementById('forgotPanel');
    if (forgot) forgot.hidden = true;
    try { panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  }
}

function setupAccountRecovery() {
  document.querySelectorAll('[data-forgot-toggle]').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      clearAuthMessage('forgotMessage');
      showForgotPanel(true);
    });
  });

  const forgotCancel = document.getElementById('forgotCancel');
  if (forgotCancel) forgotCancel.addEventListener('click', () => showForgotPanel(false));

  const forgotForm = document.getElementById('forgotForm');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthMessage('forgotMessage');
      const email = (document.getElementById('forgotEmail')?.value || '').trim();
      if (!email) { showAuthMessage('forgotMessage', 'Enter your email address.'); return; }
      const button = forgotForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const data = await apiAuth('/api/account/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        showAuthMessage('forgotMessage', data.message || 'If that email is registered, a reset link has been sent.', 'success');
        const devLink = document.getElementById('devResetLink');
        if (devLink) {
          if (data.devResetUrl) {
            devLink.href = data.devResetUrl;
            devLink.hidden = false;
          } else {
            devLink.hidden = true;
          }
        }
      } catch (err) {
        showAuthMessage('forgotMessage', err.message || 'Could not request a reset link.');
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  const resetForm = document.getElementById('resetForm');
  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthMessage('resetMessage');
      const token = (document.getElementById('resetToken')?.value || '').trim();
      const password = document.getElementById('resetPassword')?.value || '';
      const confirm = document.getElementById('resetConfirm')?.value || '';
      if (!token) { showAuthMessage('resetMessage', 'A reset token is required.'); return; }
      if (password.length < 8) { showAuthMessage('resetMessage', 'Password must be at least 8 characters.'); return; }
      if (password !== confirm) { showAuthMessage('resetMessage', 'Passwords do not match.'); return; }
      const button = resetForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const data = await apiAuth('/api/account/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token, password }),
        });
        showAuthMessage('resetMessage', data.message || 'Password updated. You can now sign in.', 'success');
        resetForm.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ''; });
        const loginAgain = document.getElementById('resetLoginLink');
        if (loginAgain) loginAgain.hidden = false;
      } catch (err) {
        showAuthMessage('resetMessage', err.message || 'Could not reset the password.');
      } finally {
        if (button) button.disabled = false;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', function() {
  refreshCurrentUser().finally(updateNavigation);
  setupAccountRecovery();

  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');
  if (hamburger && navMenu) {
    hamburger.addEventListener('click', function() {
      navMenu.classList.toggle('active');
    });
  }

  const jobseekerLoginForm = document.getElementById('jobseekerLoginForm');
  const employerLoginForm = document.getElementById('employerLoginForm');
  if (jobseekerLoginForm) jobseekerLoginForm.addEventListener('submit', (e) => { e.preventDefault(); handleLogin('employee'); });
  if (employerLoginForm) employerLoginForm.addEventListener('submit', (e) => { e.preventDefault(); handleLogin('employer'); });

  const jobseekerRegForm = document.getElementById('jobseekerRegForm');
  const employerRegForm = document.getElementById('employerRegForm');
  if (jobseekerRegForm) jobseekerRegForm.addEventListener('submit', (e) => { e.preventDefault(); handleRegistration('employee'); });
  if (employerRegForm) employerRegForm.addEventListener('submit', (e) => { e.preventDefault(); handleRegistration('employer'); });

  // Check URL params for registration type (if register page exists)
  const urlParams = new URLSearchParams(window.location.search);
  const regType = urlParams.get('type');
  if (regType && window.location.pathname.includes('register')) {
    if (typeof switchCardTab === 'function') switchCardTab(regType === 'employer' ? 'employer' : 'jobseeker', 'register');
  }

  // ?reset=<token> opens the reset panel with the token prefilled.
  const resetToken = urlParams.get('reset');
  if (resetToken) {
    const tokenField = document.getElementById('resetToken');
    if (tokenField) tokenField.value = resetToken;
    showResetPanel(true);
  }
});

function switchCardTab(userType, action, evt) {
  const loginContent = document.getElementById(userType + 'Login');
  const registerContent = document.getElementById(userType + 'Register');
  const card = loginContent ? loginContent.closest('.auth-card') : (registerContent ? registerContent.closest('.auth-card') : null);
  if (!card) return;
  const tabs = card.querySelectorAll('.card-tab-btn');
  tabs.forEach(tab => tab.classList.remove('active'));
  const target = evt?.target || (typeof event !== 'undefined' ? event.target : null);
  if (target && target.classList?.contains('card-tab-btn')) target.classList.add('active');
  else {
    const idx = action === 'login' ? 0 : 1;
    if (tabs[idx]) tabs[idx].classList.add('active');
  }
  if (action === 'login') {
    if (loginContent) loginContent.classList.add('active');
    if (registerContent) registerContent.classList.remove('active');
  } else {
    if (loginContent) loginContent.classList.remove('active');
    if (registerContent) registerContent.classList.add('active');
  }
}

async function handleLogin(roleHint) {
  const type = roleHint === 'employee' ? 'jobseeker' : 'employer';
  const emailEl = document.getElementById(type === 'jobseeker' ? 'jsEmail' : 'empEmail');
  const passEl = document.getElementById(type === 'jobseeker' ? 'jsPassword' : 'empPassword');
  const messageId = type === 'jobseeker' ? 'jsLoginMessage' : 'empLoginMessage';
  const email = (emailEl?.value || '').trim();
  const password = passEl?.value || '';
  clearAuthMessage(messageId);
  if (!email || !password) {
    showAuthMessage(messageId, 'Email and password are required.');
    return;
  }
  try {
    const data = await apiAuth('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setCurrentUser(data.user || null);
    updateNavigation();
    window.location.href = postAuthRedirect(getCurrentUser() || data.user);
  } catch (e) {
    showAuthMessage(messageId, e.message || 'Invalid email or password.');
  }
}

async function handleRegistration(role) {
  const messageId = role === 'employee' ? 'jsRegMessage' : 'empRegMessage';
  clearAuthMessage(messageId);
  try {
    let payload;
    if (role === 'employee') {
      const name = (document.getElementById('jsName')?.value || '').trim();
      const email = (document.getElementById('jsRegEmail')?.value || '').trim();
      const location = (document.getElementById('jsLocation')?.value || '').trim();
      const phone = (document.getElementById('jsPhone')?.value || '').trim();
      const password = document.getElementById('jsRegPassword')?.value || '';
      const confirmPassword = document.getElementById('jsConfirmPassword')?.value || '';
      if (!name || !email || !location || !phone || !password) { showAuthMessage(messageId, 'Please fill in all required fields.'); return; }
      if (password.length < 8) { showAuthMessage(messageId, 'Password must be at least 8 characters.'); return; }
      if (password !== confirmPassword) { showAuthMessage(messageId, 'Passwords do not match.'); return; }
      payload = { role: 'employee', name, email, location, phone, password, confirmPassword };
    } else {
      const companyName = (document.getElementById('empCompany')?.value || '').trim();
      const contactName = (document.getElementById('empContactName')?.value || '').trim();
      const email = (document.getElementById('empRegEmail')?.value || '').trim();
      const location = (document.getElementById('empLocation')?.value || '').trim();
      const phone = (document.getElementById('empPhone')?.value || '').trim();
      const password = document.getElementById('empRegPassword')?.value || '';
      const confirmPassword = document.getElementById('empConfirmPassword')?.value || '';
      if (!companyName || !contactName || !email || !location || !phone || !password) { showAuthMessage(messageId, 'Please fill in all required fields.'); return; }
      if (password.length < 8) { showAuthMessage(messageId, 'Password must be at least 8 characters.'); return; }
      if (password !== confirmPassword) { showAuthMessage(messageId, 'Passwords do not match.'); return; }
      payload = { role: 'employer', companyName, contactName, email, location, phone, password, confirmPassword };
    }

    const data = await apiAuth('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    setCurrentUser(data.user || null);
    updateNavigation();
    showAuthMessage(messageId, data.message || 'Registration successful.', 'success');
    window.location.href = postAuthRedirect(getCurrentUser() || data.user);
  } catch (e) {
    showAuthMessage(messageId, e.message || 'Registration failed.');
  }
}

// Shared helpers are exposed for guards.js, dashboard.js and account.js.
window.HCAuth = {
  apiAuth,
  getCurrentUser,
  setCurrentUser,
  setSessionFromMe,
  isLoggedIn,
  refreshCurrentUser,
  updateNavigation,
  requireRole,
  postAuthRedirect,
  showAuthMessage,
  clearAuthMessage,
  logout,
  userRole,
};
window.requireRole = requireRole;
