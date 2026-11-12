// Standard authentication (server-backed sessions). Falls back gracefully if API/DB is unavailable.

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
}

function isLoggedIn() {
  return getCurrentUser() !== null;
}

async function refreshCurrentUser() {
  try {
    const data = await apiAuth('/api/auth/me', { method: 'GET' });
    setCurrentUser(data && data.user ? data.user : null);
    return getCurrentUser();
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

function updateNavigation() {
  const user = getCurrentUser();
  if (typeof updateNavbar === 'function') {
    try { updateNavbar(); } catch {}
  }
  const postJobLink = document.querySelector('a[href="post-job.html"]');
  if (postJobLink) {
    const isEmployer = user && (user.role === 'employer' || user.type === 'employer');
    postJobLink.parentElement.style.display = isEmployer ? 'block' : 'none';
  }
}

document.addEventListener('DOMContentLoaded', function() {
  refreshCurrentUser().finally(updateNavigation);

  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');
  if (hamburger) {
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
  const email = (emailEl?.value || '').trim();
  const password = passEl?.value || '';
  if (!email || !password) {
    alert('Email and password are required.');
    return;
  }
  try {
    const data = await apiAuth('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setCurrentUser(data.user || null);
    updateNavigation();
    if (data.user?.role === 'admin' || data.user?.type === 'admin') {
      window.location.href = 'admin.html';
    } else if (data.user?.role === 'employer' || data.user?.type === 'employer') {
      window.location.href = 'post-job.html';
    } else {
      window.location.href = 'jobs.html';
    }
  } catch (e) {
    alert(e.message || 'Invalid email or password.');
  }
}

async function handleRegistration(role) {
  try {
    let payload;
    if (role === 'employee') {
      const name = (document.getElementById('jsName')?.value || '').trim();
      const email = (document.getElementById('jsRegEmail')?.value || '').trim();
      const location = (document.getElementById('jsLocation')?.value || '').trim();
      const phone = (document.getElementById('jsPhone')?.value || '').trim();
      const password = document.getElementById('jsRegPassword')?.value || '';
      const confirmPassword = document.getElementById('jsConfirmPassword')?.value || '';
      if (!name || !email || !location || !phone || !password) { alert('Please fill in all required fields.'); return; }
      if (password.length < 8) { alert('Password must be at least 8 characters.'); return; }
      if (password !== confirmPassword) { alert('Passwords do not match.'); return; }
      payload = { role: 'employee', name, email, location, phone, password, confirmPassword };
    } else {
      const companyName = (document.getElementById('empCompany')?.value || '').trim();
      const contactName = (document.getElementById('empContactName')?.value || '').trim();
      const email = (document.getElementById('empRegEmail')?.value || '').trim();
      const location = (document.getElementById('empLocation')?.value || '').trim();
      const phone = (document.getElementById('empPhone')?.value || '').trim();
      const password = document.getElementById('empRegPassword')?.value || '';
      const confirmPassword = document.getElementById('empConfirmPassword')?.value || '';
      if (!companyName || !contactName || !email || !location || !phone || !password) { alert('Please fill in all required fields.'); return; }
      if (password.length < 8) { alert('Password must be at least 8 characters.'); return; }
      if (password !== confirmPassword) { alert('Passwords do not match.'); return; }
      payload = { role: 'employer', companyName, contactName, email, location, phone, password, confirmPassword };
    }

    const data = await apiAuth('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    setCurrentUser(data.user || null);
    updateNavigation();
    alert(data.message || 'Registration successful.');
    if (data.user?.role === 'employer' || data.user?.type === 'employer') window.location.href = 'post-job.html';
    else window.location.href = 'jobs.html';
  } catch (e) {
    alert(e.message || 'Registration failed.');
  }
}
