// Habesha Careers — core runtime.
// One shared shell, one session source of truth (GET /api/auth/me), one job cache.
// No build step, no dependencies, no credentials or passwords ever stored locally.

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Tiny DOM helpers
  // ---------------------------------------------------------------------------

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatDate(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    try {
      return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return String(value);
    }
  }

  function go(url) {
    window.location.href = url;
  }

  function redirectTo(url) {
    window.location.replace(url);
  }

  function setLoading(el, on) {
    if (!el) return;
    if (on) {
      el.classList.add("is-loading");
      el.setAttribute("aria-busy", "true");
      if (el.matches && el.matches("button, input, select, textarea")) el.disabled = true;
    } else {
      el.classList.remove("is-loading");
      el.removeAttribute("aria-busy");
      if (el.matches && el.matches("button, input, select, textarea")) el.disabled = false;
    }
  }

  function currentPageFile() {
    const path = window.location.pathname || "";
    return path.split("/").pop() || "index.html";
  }

  function safeNextPage(raw) {
    if (!raw || typeof raw !== "string") return null;
    try {
      const url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return null;
      const file = decodeURIComponent(url.pathname.split("/").pop() || "");
      if (!/^[A-Za-z0-9._-]+\.html?$/.test(file)) return null;
      if (/^login\.html?$/i.test(file)) return null;
      return file;
    } catch (e) {
      return null;
    }
  }

  function postAuthRedirect(user) {
    const next = safeNextPage(new URLSearchParams(window.location.search).get("next"));
    if (next && nextPageAllowsRole(next, user)) return next;
    return userRole(user) === "admin" ? "admin.html" : "dashboard.html";
  }

  function nextPageAllowsRole(file, user) {
    const role = userRole(user);
    if (file === "admin.html") return role === "admin";
    if (file === "post-job.html") return role === "employer" || role === "admin";
    return true;
  }

  // ---------------------------------------------------------------------------
  // JSON API
  // ---------------------------------------------------------------------------

  async function api(path, options) {
    const opts = Object.assign({}, options || {});
    const body = opts.body;
    if (body && typeof body === "object" && (Array.isArray(body) || Object.prototype.toString.call(body) === "[object Object]")) {
      opts.body = JSON.stringify(body);
    }
    const headers = Object.assign(
      { "Content-Type": "application/json", "Accept": "application/json" },
      opts.headers || {}
    );
    const res = await fetch(path, Object.assign({}, opts, { credentials: "same-origin", headers: headers }));
    const data = await res.json().catch(function () { return {}; });
    const failed = !res.ok || !!(data && data.ok === false);

    if (failed) {
      const status = res.status;
      let code = (data && (data.code || data.error)) || "";
      let message = (data && (data.message || data.error)) || "";
      if (status === 503 || code === "db_unavailable") {
        // Neutral, user-facing wording — no infrastructure details.
        code = "db_unavailable";
        message = "Jobs are temporarily unavailable. Please try again in a moment.";
      }
      if (!message) message = "Request failed (" + status + "). Please try again.";
      const err = new Error(message);
      err.status = status;
      err.code = code;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // Session — server is the source of truth; localStorage is a display cache.
  // ---------------------------------------------------------------------------

  const ADMIN_KEY_NAME = "habesha_admin_key";
  const SENSITIVE_KEY = /^(token|accesstoken|refreshtoken|idtoken|sessiontoken|password|passwordhash|passhash|secret|apikey|authorization|csrf)/i;

  function sanitizeUser(user) {
    if (!user || typeof user !== "object") return user;
    const out = {};
    Object.keys(user).forEach(function (key) {
      if (!SENSITIVE_KEY.test(key)) out[key] = user[key];
    });
    return out;
  }

  function normalizeUser(user) {
    if (!user || typeof user !== "object") return null;
    const clean = sanitizeUser(user);
    const role = clean.role
      || (clean.type === "jobseeker" ? "employee" : clean.type === "employer" ? "employer" : clean.type)
      || null;
    const type = clean.type || (role === "employee" ? "jobseeker" : role);
    const name = clean.name || clean.fullName || clean.contactName || clean.companyName || clean.company || null;
    return Object.assign({}, clean, {
      role: role,
      type: type,
      name: name,
      fullName: clean.fullName || name || null,
      company: clean.company || clean.companyName || null,
      companyName: clean.companyName || clean.company || null
    });
  }

  function userRole(user) {
    const normalized = normalizeUser(user);
    return normalized ? normalized.role : null;
  }

  function readCachedUser() {
    try {
      const raw = localStorage.getItem("currentUser");
      return raw ? normalizeUser(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  function mirrorUser(user) {
    try {
      if (user) localStorage.setItem("currentUser", JSON.stringify(sanitizeUser(user)));
      else localStorage.removeItem("currentUser");
    } catch (e) {
      /* storage may be unavailable — session still lives in memory */
    }
  }

  let currentUser = readCachedUser();

  function getUser() {
    return currentUser;
  }

  // Used after a successful server login/registration response.
  function setCurrentUser(user) {
    currentUser = normalizeUser(user);
    mirrorUser(currentUser);
    applyNavVisibility(currentUser);
    markActiveNav();
    return currentUser;
  }

  function setSessionFromMe(data) {
    if (data && Object.prototype.hasOwnProperty.call(data, "authenticated")) {
      return setCurrentUser(data.authenticated && data.user ? data.user : null);
    }
    return setCurrentUser(data && data.user ? data.user : null);
  }

  async function refreshUser() {
    let controller = null;
    let timer = null;
    const opts = { method: "GET" };
    if (typeof AbortController !== "undefined") {
      controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(function () { controller.abort(); }, 8000);
    }
    try {
      const data = await api("/api/auth/me", opts);
      let user = null;
      if (data && data.authenticated === false) user = null;
      else if (data && data.user) user = normalizeUser(data.user);
      else if (data && data.id) user = normalizeUser(data);
      currentUser = user;
      mirrorUser(user);
      return user;
    } catch (e) {
      // Never touch the local mirror on failure; keep the last known user.
      return currentUser;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function getAdminKey() {
    try {
      return sessionStorage.getItem(ADMIN_KEY_NAME) || "";
    } catch (e) {
      return "";
    }
  }

  function isRoleAllowed(user, roles) {
    const normalized = normalizeUser(user);
    if (!normalized) return false;
    const allowed = Array.isArray(roles) ? roles : [roles];
    return allowed.some(function (role) {
      return role && (role === normalized.role || role === normalized.type);
    });
  }

  async function requireRole(roles, redirect) {
    const user = await refreshUser();
    applyNavVisibility(user);
    markActiveNav();

    if (!user) {
      if (!/login\.html?$/i.test(currentPageFile())) {
        const target = (typeof redirect === "string" && redirect) ? redirect : currentPageFile();
        redirectTo("login.html?next=" + encodeURIComponent(target));
      }
      return null;
    }

    const allowed = Array.isArray(roles)
      ? roles.slice()
      : (typeof roles === "string" ? roles.trim().split(/[\s,]+/).filter(Boolean) : roles ? [roles] : []);

    if (allowed.length && !isRoleAllowed(user, allowed)) {
      redirectTo("dashboard.html");
      return null;
    }
    return user;
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch (e) {
      /* always clear local state, even if the server is unreachable */
    }
    currentUser = null;
    try {
      localStorage.removeItem("currentUser");
      sessionStorage.removeItem(ADMIN_KEY_NAME);
    } catch (e) {
      /* ignore */
    }
    applyNavVisibility(null);
    go("index.html");
  }

  // ---------------------------------------------------------------------------
  // Shared shell
  // ---------------------------------------------------------------------------

  function headerTemplate() {
    return [
      "<header class=\"site-header\">",
      "  <div class=\"container header-inner\">",
      "    <a class=\"brand\" href=\"index.html\" aria-label=\"Habesha Careers home\">",
      "      <img src=\"images/logo.png\" alt=\"\" class=\"brand-logo\">",
      "      <span class=\"brand-name\">Habesha <strong>Careers</strong></span>",
      "    </a>",
      "    <button type=\"button\" id=\"navToggle\" class=\"nav-toggle hamburger\" aria-label=\"Toggle navigation\" aria-expanded=\"false\" aria-controls=\"navMenu\">",
      "      <span></span><span></span><span></span>",
      "    </button>",
      "    <nav id=\"navMenu\" class=\"nav-menu\" aria-label=\"Main navigation\">",
      "      <ul class=\"nav-list\">",
      "        <li id=\"navHome\"><a class=\"nav-link\" href=\"index.html\">Home</a></li>",
      "        <li id=\"navJobs\"><a class=\"nav-link\" href=\"jobs.html\">Browse Jobs</a></li>",
      "        <li id=\"navPostJob\"><a class=\"nav-link\" href=\"post-job.html\">Post a Job</a></li>",
      "        <li id=\"navAbout\"><a class=\"nav-link\" href=\"about.html\">About</a></li>",
      "        <li id=\"navContact\"><a class=\"nav-link\" href=\"contact.html\">Contact</a></li>",
      "        <li id=\"navDashboard\"><a class=\"nav-link\" href=\"dashboard.html\">Dashboard</a></li>",
      "        <li id=\"navAccount\"><a class=\"nav-link\" href=\"account.html\">Account</a></li>",
      "        <li id=\"navAdmin\"><a class=\"nav-link\" href=\"admin.html\">Admin</a></li>",
      "        <li id=\"navUser\"><a class=\"nav-link nav-user-link\" href=\"account.html\" aria-label=\"My account\"><span class=\"nav-avatar\" aria-hidden=\"true\">?</span><span id=\"navUserName\" class=\"nav-user-name\"></span></a></li>",
      "        <li class=\"nav-logout-item\"><button type=\"button\" id=\"navLogout\" class=\"nav-link nav-logout\">Log out</button></li>",
      "        <li id=\"navLogin\"><a class=\"btn btn-primary btn-sm\" href=\"login.html\">Log in</a></li>",
      "      </ul>",
      "    </nav>",
      "  </div>",
      "</header>"
    ].join("\n");
  }

  function footerTemplate() {
    return [
      "<footer class=\"site-footer\">",
      "  <div class=\"container footer-content\">",
      "    <div class=\"footer-section\">",
      "      <a class=\"brand brand-footer\" href=\"index.html\"><span class=\"brand-name\">Habesha <strong>Careers</strong></span></a>",
      "      <p>Connecting talent across Ethiopia and the diaspora with meaningful work.</p>",
      "    </div>",
      "    <div class=\"footer-section\">",
      "      <h4>Explore</h4>",
      "      <a href=\"jobs.html\">Browse jobs</a>",
      "      <a href=\"about.html\">About us</a>",
      "    </div>",
      "    <div class=\"footer-section\">",
      "      <h4>Support</h4>",
      "      <a href=\"contact.html\">Contact</a>",
      "      <a href=\"login.html\">Sign in</a>",
      "    </div>",
      "  </div>",
      "  <div class=\"container footer-bottom\">",
      "    <p>&copy; <span id=\"footerYear\"></span> Habesha Careers. All rights reserved.</p>",
      "  </div>",
      "</footer>"
    ].join("\n");
  }

  function injectShell() {
    const body = document.body;
    if (!body) return;
    let headerHost = qs("#app-header");
    if (!headerHost) {
      headerHost = document.createElement("div");
      headerHost.id = "app-header";
      body.insertBefore(headerHost, body.firstChild);
    }
    headerHost.innerHTML = headerTemplate();

    let footerHost = qs("#app-footer");
    if (!footerHost) {
      footerHost = document.createElement("div");
      footerHost.id = "app-footer";
      body.appendChild(footerHost);
    }
    footerHost.innerHTML = footerTemplate();

    const year = qs("#footerYear");
    if (year) year.textContent = String(new Date().getFullYear());
  }

  function setVisible(el, visible) {
    if (!el) return;
    el.style.display = visible ? "" : "none";
    el.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function applyNavVisibility(user) {
    const role = userRole(user);
    const signedIn = !!user;
    const canPost = signedIn && (role === "employer" || role === "admin");
    const isAdmin = signedIn && role === "admin";

    setVisible(qs("#navDashboard"), signedIn);
    setVisible(qs("#navAccount"), signedIn);
    setVisible(qs("#navUser"), signedIn);
    setVisible(qs("#navLogout"), signedIn);
    setVisible(qs("#navAdmin"), isAdmin || !!getAdminKey());
    setVisible(qs("#navPostJob"), canPost);
    setVisible(qs("#navLogin"), !signedIn);

    const nameEl = qs("#navUserName");
    if (nameEl) nameEl.textContent = user ? (user.name || user.companyName || user.email || "Account") : "";
    const avatar = qs("#navUser .nav-avatar");
    if (avatar) {
      const label = String((user && (user.name || user.companyName)) || "?");
      avatar.textContent = (label.trim()[0] || "?").toUpperCase();
    }
  }

  function markActiveNav() {
    const page = (document.body && document.body.dataset.page) || "home";
    const map = {
      home: "navHome",
      jobs: "navJobs",
      job: "navJobs",
      login: "navLogin",
      dashboard: "navDashboard",
      account: "navAccount",
      "post-job": "navPostJob",
      admin: "navAdmin",
      about: "navAbout",
      contact: "navContact"
    };
    qsa(".nav-menu a, .nav-menu button").forEach(function (el) {
      el.classList.remove("active");
      el.removeAttribute("aria-current");
    });
    const id = map[page];
    if (!id) return;
    const host = document.getElementById(id);
    if (!host) return;
    const target = host.matches && host.matches("a, button") ? host : (host.querySelector("a, button") || host);
    target.classList.add("active");
    target.setAttribute("aria-current", "page");
  }

  function setupNavToggle() {
    const toggle = qs("#navToggle");
    const menu = qs("#navMenu");
    if (!toggle || !menu) return;

    function closeMenu() {
      menu.classList.remove("active");
      toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", function () {
      const open = menu.classList.toggle("active");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", function (e) {
      if (!menu.classList.contains("active")) return;
      if (toggle.contains(e.target) || menu.contains(e.target)) return;
      closeMenu();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.key === "Esc") closeMenu();
    });

    qsa("#navMenu a, #navMenu button").forEach(function (el) {
      el.addEventListener("click", closeMenu);
    });
  }

  function setupLogoutHandler() {
    const btn = qs("#navLogout");
    if (btn) btn.addEventListener("click", function (e) { e.preventDefault(); logout(); });
  }

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------

  function dismissToast(el) {
    if (!el || !el.parentNode) return;
    el.classList.add("is-leaving");
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 200);
  }

  function toast(message, type) {
    const kind = (type === "success" || type === "error" || type === "info") ? type : "info";
    let container = qs("#app-toasts");
    if (!container) {
      container = document.createElement("div");
      container.id = "app-toasts";
      container.className = "toast-container";
      container.setAttribute("aria-live", "polite");
      (document.body || document.documentElement).appendChild(container);
    }
    const el = document.createElement("div");
    el.className = "toast toast-" + kind;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    const text = document.createElement("span");
    text.textContent = String(message == null ? "" : message);
    el.appendChild(text);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "\u00d7";
    close.addEventListener("click", function () { dismissToast(el); });
    el.appendChild(close);
    container.appendChild(el);
    setTimeout(function () { dismissToast(el); }, 4000);
  }

  // ---------------------------------------------------------------------------
  // Organisation marks + application destinations (ported from data.js)
  // ---------------------------------------------------------------------------

  function orgInitials(name) {
    const parts = String(name || "Organization").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "O";
    const letters = parts.slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join("");
    return letters || "O";
  }

  function shade(hex, percent) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || "#0F2C59"));
    if (!m) return hex;
    const shift = function (v) {
      return Math.max(0, Math.min(255, Math.round(parseInt(v, 16) * (1 + percent / 100))));
    };
    return "#" + [shift(m[1]), shift(m[2]), shift(m[3])].map(function (v) {
      return v.toString(16).padStart(2, "0");
    }).join("");
  }

  function orgLogoColor(name) {
    const palette = ["#0F2C59", "#1B9C85", "#1D4ED8", "#7C3AED", "#B45309", "#BE123C", "#15803D", "#0369A1", "#4338CA", "#A16207", "#0E7490", "#9D174D"];
    let h = 0;
    const s = String(name || "");
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    return palette[Math.abs(h) % palette.length];
  }

  function orgLogoDataUri(name) {
    const label = String(name || "").trim();
    const initials = orgInitials(label);
    const bg = orgLogoColor(label);
    const bg2 = shade(bg, -18);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="${esc(label || "Organization")}">`
      + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
      + `<stop offset="0%" stop-color="${bg}"/><stop offset="100%" stop-color="${bg2}"/></linearGradient></defs>`
      + `<rect width="120" height="120" rx="20" fill="url(#g)"/>`
      + `<rect x="0.75" y="0.75" width="118.5" height="118.5" rx="19.25" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>`
      + `<text x="60" y="60" text-anchor="middle" dominant-baseline="central" font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="700" letter-spacing="1" fill="#ffffff">${esc(initials)}</text>`
      + `</svg>`;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  function domainFromUrl(url) {
    try {
      if (!url) return "";
      return new URL(String(url)).hostname.replace(/^www\./i, "");
    } catch (e) {
      return "";
    }
  }

  function faviconLogo(url) {
    const d = domainFromUrl(url);
    return d ? "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(d) + "&sz=128" : "";
  }

  const ORG_DOMAIN_HINTS = [
    [/\bunicef\b/i, "unicef.org"], [/\bundp\b|united nations development programme/i, "undp.org"],
    [/\bwho\b|world health organization/i, "who.int"], [/\bwfp\b|world food programme/i, "wfp.org"],
    [/\bunhcr\b|un refugee agency|refugees\b/i, "unhcr.org"], [/\biom\b|international organization for migration/i, "iom.int"],
    [/\bunfpa\b/i, "unfpa.org"], [/\bun women\b|united nations entity for gender/i, "unwomen.org"],
    [/\bfao\b|food and agriculture organization/i, "fao.org"], [/\bilo\b|international labour/i, "ilo.org"],
    [/\bunesco\b/i, "unesco.org"], [/\bunocha\b|\bocha\b/i, "unocha.org"], [/\bunops\b/i, "unops.org"],
    [/\bworld bank\b|\bifc\b/i, "worldbank.org"], [/\busaid\b/i, "usaid.gov"],
    [/\bethiopian airlines\b/i, "ethiopianairlines.com"], [/\bethio telecom\b|ethiotelecom/i, "ethiotelecom.et"],
    [/\bcommercial bank of ethiopia\b|\bcbe\b/i, "combanketh.et"], [/\bsave the children\b/i, "savethechildren.net"],
    [/\bcare\b/i, "care.org"], [/\bmercy corps\b/i, "mercycorps.org"], [/\boxfam\b/i, "oxfam.org"],
    [/\bplan international\b/i, "plan-international.org"], [/\bworld vision\b/i, "worldvision.org"],
    [/\bgiz\b/i, "giz.de"], [/\birc\b|international rescue committee/i, "rescue.org"],
    [/\bamref\b/i, "amref.org"], [/\bpath\b/i, "path.org"], [/\bjhpiego\b/i, "jhpiego.org"],
    [/\bfhi 360\b|\bfhi360\b/i, "fhi360.org"]
  ];

  function orgDomainHint(company) {
    const n = String(company || "");
    for (let i = 0; i < ORG_DOMAIN_HINTS.length; i++) {
      if (ORG_DOMAIN_HINTS[i][0].test(n)) return ORG_DOMAIN_HINTS[i][1];
    }
    return "";
  }

  function addOrgLogoCandidates(add, domain) {
    if (!domain) return;
    const d = String(domain).toLowerCase().replace(/^www\./, "");
    add("https://logo.clearbit.com/" + encodeURIComponent(d));
    add("https://www.google.com/s2/favicons?domain=" + encodeURIComponent(d) + "&sz=128");
    add("https://icons.duckduckgo.com/ip3/" + encodeURIComponent(d) + ".ico");
    add("https://" + d + "/favicon.ico");
    add("https://" + d + "/apple-touch-icon.png");
  }

  function looksLikeVacancyPoster(url) {
    const s = String(url || "").toLowerCase();
    if (!s) return true;
    return /(?:vacancy|job[-_ ]?poster|advert(?:isement)?|flyer|job[-_ ]?ad|hiring[-_ ]?banner|recruit(?:ment)?[-_ ]?(?:poster|banner|ad)|position[-_ ]?ad|now[-_ ]?hiring)/.test(s);
  }

  function isWeakLogo(url) {
    const s = String(url || "").toLowerCase();
    if (!s) return true;
    if (/default[-_]?logo|placeholder|no[-_]?logo|avatar|sprite|blank/.test(s)) return true;
    return looksLikeVacancyPoster(s);
  }

  function logoCandidates(job) {
    const out = [];
    const seen = new Set();
    const add = function (u) {
      if (!u) return;
      const s = String(u);
      if (seen.has(s)) return;
      if (!/^https?:|^data:|^\//i.test(s)) return;
      seen.add(s);
      out.push(s);
    };
    const stored = job && (job.organizationLogo || job.logo || job.logoUrl || job.companyLogo);
    const orgDomain = job && (job.organizationDomain || job.employerWebsiteDomain || "");
    if (stored && !isWeakLogo(stored)) add(stored);
    addOrgLogoCandidates(add, orgDomain);
    addOrgLogoCandidates(add, orgDomainHint(job && job.company));
    add(orgLogoDataUri(job && job.company));
    return out;
  }

  function jobLogoSrc(job) {
    return logoCandidates(job)[0] || orgLogoDataUri(job && job.company);
  }

  function logoImgAttrs(job) {
    const list = logoCandidates(job);
    const first = esc(list[0] || orgLogoDataUri(job && job.company));
    const json = esc(JSON.stringify(list));
    return "src=\"" + first + "\" data-logos=\"" + json + "\" data-logo-idx=\"0\"";
  }

  function logoImgHtml(job, className, alt) {
    const list = logoCandidates(job);
    const first = list[0] || orgLogoDataUri(job && job.company);
    return "<img src=\"" + esc(first) + "\" data-logos=\"" + esc(JSON.stringify(list)) + "\" data-logo-idx=\"0\" alt=\""
      + esc(alt || (job && job.company) || "") + "\" class=\"" + esc(className || "company-logo") + "\">";
  }

  function nextLogo(img) {
    try {
      const list = JSON.parse(img.getAttribute("data-logos") || "[]");
      let i = (+img.getAttribute("data-logo-idx") || 0) + 1;
      while (i < list.length) {
        img.setAttribute("data-logo-idx", i);
        img.src = list[i];
        return;
      }
    } catch (e) {
      /* ignore */
    }
  }

  const ATS_HOSTS = [
    "greenhouse.io", "lever.co", "workday.com", "myworkdayjobs.com", "bamboohr.com",
    "smartrecruiters.com", "icims.com", "taleo.net", "oraclecloud.com", "successfactors.com",
    "sapsf.com", "jobvite.com", "recruitee.com", "personio.com", "personio.de",
    "zohorecruit.com", "breezy.hr", "ashbyhq.com", "teamtailor.com", "applytojob.com",
    "workable.com", "smartrecruiters.net", "talent.com", "hire.com", "jobs.smartrecruiters.com"
  ];
  const GENERIC_HOSTS = [
    "forms.gle", "docs.google.com", "typeform.com", "jotform.com", "shorturl.at",
    "tinyurl.com", "bit.ly", "rb.gy", "linktr.ee", "t.me", "wa.me", "forms.office.com"
  ];

  function hostOf(url) {
    try {
      return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  function endsWithHost(host, domain) {
    const h = String(host || "");
    const d = String(domain || "");
    return !!h && !!d && (h === d || h.endsWith("." + d));
  }

  function isAtsHost(host) {
    return ATS_HOSTS.some(function (d) { return endsWithHost(host, d); });
  }

  function isGenericHost(host) {
    return GENERIC_HOSTS.some(function (d) { return endsWithHost(host, d); });
  }

  const APPLY_META = {
    official_employer: { badge: "Official employer link", badgeClass: "badge-official", note: "Opens the employer’s own application page.", official: true },
    official_ats: { badge: "Official employer link", badgeClass: "badge-official", note: "Opens the employer’s own recruitment portal.", official: true },
    third_party: { badge: "Third-party application", badgeClass: "badge-third-party", note: "This vacancy was published on another platform. The link opens that application form.", official: false },
    email: { badge: "Application email", badgeClass: "badge-neutral", note: "Sends your application directly to the employer.", official: true },
    employer_careers: { badge: "Official careers page", badgeClass: "badge-official", note: "No direct application link was published, so this opens the employer’s own careers page.", official: true },
    none: { badge: "Application details below", badgeClass: "badge-neutral", note: "This vacancy does not publish an application link. The employer's application details are listed in the vacancy.", official: false }
  };

  // The API-supplied job.apply object is preferred whenever it is present.
  function applyInfo(job) {
    if (job && job.apply && job.apply.url) {
      const meta = APPLY_META[job.apply.kind] || APPLY_META.none;
      return Object.assign({}, job.apply, {
        badge: job.apply.badge || meta.badge,
        badgeClass: job.apply.badgeClass || meta.badgeClass,
        note: job.apply.note || meta.note
      });
    }
    const email = job && (job.applicationEmail || job.contactEmail);
    const rawUrl = job && job.applyUrl ? String(job.applyUrl).trim() : "";
    const hasValidUrl = /^https?:\/\//i.test(rawUrl) || /^mailto:/i.test(rawUrl);
    const url = hasValidUrl ? rawUrl : "";
    const domain = job && job.organizationDomain;

    if (url && /^https?:/i.test(url)) {
      const host = hostOf(url);
      let kind = "third_party";
      if (domain && (endsWithHost(host, domain) || endsWithHost(host, domain.replace(/^www\./, "")))) kind = "official_employer";
      else if (isAtsHost(host)) kind = "official_ats";
      else if (isGenericHost(host)) kind = "third_party";
      const meta = APPLY_META[kind];
      const note = (job && job.applyUrlVerified) ? meta.note : (meta.note + " If the link does not open, use the employer’s application details below.");
      return { kind: kind, url: url, badge: meta.badge, badgeClass: meta.badgeClass, note: note, official: meta.official, verified: !!(job && job.applyUrlVerified) };
    }
    if (url && /^mailto:/i.test(url)) {
      const meta = APPLY_META.email;
      return { kind: "email", url: url, badge: meta.badge, badgeClass: meta.badgeClass, note: meta.note, official: meta.official, verified: false };
    }
    if (email && /@/.test(email)) {
      const subject = encodeURIComponent("Application for " + String((job && job.title) || "this position"));
      const meta = APPLY_META.email;
      return { kind: "email", url: "mailto:" + email + "?subject=" + subject, badge: meta.badge, badgeClass: meta.badgeClass, note: meta.note, official: meta.official, verified: false };
    }
    const careers = job && (job.organizationCareersUrl || job.organizationWebsite);
    if (careers) {
      const meta = APPLY_META.employer_careers;
      return { kind: "employer_careers", url: careers, badge: meta.badge, badgeClass: meta.badgeClass, note: meta.note, official: meta.official, verified: false };
    }
    const meta = APPLY_META.none;
    return { kind: "none", url: null, badge: meta.badge, badgeClass: meta.badgeClass, note: meta.note, official: false, verified: false };
  }

  function applyButtonHtml(job, extraClass) {
    const info = applyInfo(job);
    const cls = ("jd-apply-btn" + (extraClass ? " " + extraClass : "")).trim();
    const badge = info.badge
      ? "<span class=\"jd-apply-origin\"><span class=\"badge " + esc(info.badgeClass || "badge-neutral") + "\">" + esc(info.badge) + "</span></span>"
      : "";
    if (!info.url) {
      return badge + "<a class=\"" + cls + "\" href=\"#how-to-apply\">Apply Now</a>";
    }
    const external = /^https?:/i.test(info.url);
    const attrs = external ? " target=\"_blank\" rel=\"noopener noreferrer nofollow\"" : "";
    const note = info.note ? "<p class=\"jd-apply-note\">" + esc(info.note) + "</p>" : "";
    return badge + "<a class=\"" + cls + "\" href=\"" + esc(info.url) + "\"" + attrs + ">Apply Now</a>" + note;
  }

  const HabeshaUI = {
    escHtml: esc,
    orgInitials: orgInitials,
    orgLogoColor: orgLogoColor,
    orgLogoDataUri: orgLogoDataUri,
    jobLogoSrc: jobLogoSrc,
    faviconLogo: faviconLogo,
    logoCandidates: logoCandidates,
    domainFromUrl: domainFromUrl,
    logoImgAttrs: logoImgAttrs,
    nextLogo: nextLogo,
    applyInfo: applyInfo,
    applyButtonHtml: applyButtonHtml,
    orgDomainHint: orgDomainHint
  };

  // Image fallback without inline JS handlers.
  document.addEventListener("error", function (e) {
    const img = e.target;
    if (img && img.tagName === "IMG" && img.hasAttribute && img.hasAttribute("data-logos")) nextLogo(img);
  }, true);

  // ---------------------------------------------------------------------------
  // Jobs cache (API-backed only — no demo seed, no fabricated local vacancies)
  // ---------------------------------------------------------------------------

  const JobsApi = {
    cache: null,
    lastFetch: 0,
    available: null,
    lastError: null,

    async fetch(path, opts) {
      return api(path, opts);
    },

    async refresh(params) {
      try {
        const entries = Object.entries(params || {}).filter(function (pair) {
          return pair[1] != null && pair[1] !== "";
        });
        const query = new URLSearchParams(entries).toString();
        const data = await this.fetch("/api/jobs" + (query ? "?" + query : ""));
        if (data && data.ok && Array.isArray(data.jobs)) {
          this.cache = data.jobs;
          this.lastFetch = Date.now();
          this.available = true;
          this.lastError = null;
          try {
            localStorage.setItem("habeshaJobsCache", JSON.stringify({ at: this.lastFetch, jobs: data.jobs.slice(0, 300) }));
          } catch (e) {
            /* quota — in-memory cache still works */
          }
          window.dispatchEvent(new CustomEvent("habesha:jobs-updated", { detail: { jobs: data.jobs } }));
          return data;
        }
      } catch (e) {
        this.available = false;
        this.lastError = { message: (e && e.message) || "Unable to load jobs", code: (e && e.code) || "" };
      }
      window.dispatchEvent(new CustomEvent("habesha:jobs-updated", { detail: { jobs: this.cache || [] } }));
      return null;
    },

    async getById(id) {
      try {
        const data = await this.fetch("/api/jobs/" + encodeURIComponent(id));
        if (data && data.ok && data.job) return data.job;
      } catch (e) {
        if (e && e.status === 503) this.available = false;
      }
      return getJobById(id);
    },

    getCached() {
      if (Array.isArray(this.cache)) return this.cache;
      try {
        const raw = localStorage.getItem("habeshaJobsCache");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.jobs)) {
            this.cache = parsed.jobs;
            return this.cache;
          }
        }
      } catch (e) {
        /* ignore */
      }
      return null;
    }
  };

  function getAllJobs() {
    return JobsApi.getCached() || [];
  }

  function getJobById(id) {
    const jobs = getAllJobs();
    return jobs.find(function (job) { return String(job.id) === String(id); }) || null;
  }

  function getDaysUntilDeadline(jobOrDeadline) {
    const deadline = jobOrDeadline && typeof jobOrDeadline === "object"
      ? (jobOrDeadline.deadline || jobOrDeadline.deadlineDate || jobOrDeadline.validThrough)
      : jobOrDeadline;
    if (!deadline) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(deadline);
    if (Number.isNaN(due.getTime())) return null;
    return Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  }

  function jobCard(job) {
    const j = job || {};
    const employer = j.organizationName || j.company || "Organization not verified";
    const path = j.publicPath || ("job-details.html?id=" + encodeURIComponent(j.id || ""));
    const summaryRaw = String(j.summary || j.shortDescription || j.excerpt || j.description || "").replace(/\s+/g, " ").trim();
    const summary = summaryRaw ? (summaryRaw.length > 140 ? summaryRaw.slice(0, 137).trimEnd() + "…" : summaryRaw) : "";
    const verified = j.organizationVerified ? " <span class=\"verified-chip\">✓ Verified</span>" : "";
    const info = applyInfo(j);
    const applyHtml = info.url
      ? "<a class=\"btn btn-outline btn-sm\" href=\"" + esc(info.url) + "\"" + (/^https?:/i.test(info.url) ? " target=\"_blank\" rel=\"noopener noreferrer nofollow\"" : "") + ">Apply now</a>"
      : "";
    const meta = [
      "<span>📍 " + esc(j.location || j.regionCity || "Not specified") + "</span>",
      j.type ? "<span>💼 " + esc(j.type) + "</span>" : "",
      j.postedDate ? "<span>📅 " + esc(formatDate(j.postedDate)) + "</span>" : "",
      info.badge ? "<span class=\"badge badge-neutral\">" + esc(info.badge) + "</span>" : ""
    ].filter(Boolean).join("");

    return [
      "<article class=\"job-card\">",
      "  <div class=\"job-card-header\">",
      "    " + logoImgHtml(j, "company-logo", employer),
      "    <div class=\"job-card-title\">",
      "      <h4><a href=\"" + esc(path) + "\" class=\"job-card-link\">" + esc(j.title || "Untitled vacancy") + "</a>" + verified + "</h4>",
      "      <p class=\"company\">" + esc(employer) + "</p>",
      "    </div>",
      "  </div>",
      "  <div class=\"job-meta\">" + meta + "</div>",
      summary ? "  <p class=\"job-card-excerpt\">" + esc(summary) + "</p>" : "",
      "  <div class=\"job-card-actions\">",
      "    <a href=\"" + esc(path) + "\" class=\"btn btn-primary btn-sm\">View full job</a>",
      "    " + applyHtml,
      "  </div>",
      "</article>"
    ].filter(Boolean).join("\n");
  }

  // ---------------------------------------------------------------------------
  // Page controller registry + initialization
  // ---------------------------------------------------------------------------

  const pageHandlers = Object.create(null);
  const readyCallbacks = [];
  let initialized = false;

  function onPage(name, fn) {
    if (!name || typeof fn !== "function") return;
    if (!pageHandlers[name]) pageHandlers[name] = [];
    pageHandlers[name].push(fn);
  }

  function onReady(fn) {
    if (typeof fn !== "function") return;
    if (domReadyFired) fn();
    else readyCallbacks.push(fn);
  }

  function flushReady() {
    const callbacks = readyCallbacks.splice(0, readyCallbacks.length);
    callbacks.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        if (e && e.message) console.error("Init error:", e.message);
      }
    });
  }

  function runPageController() {
    const page = (document.body && document.body.dataset.page) || "home";
    const handlers = (pageHandlers[page] || []).concat(pageHandlers["*"] || []);
    handlers.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        if (e && e.message) console.error("Page controller error:", e.message);
      }
    });
  }

  function enforceGuards() {
    const body = document.body;
    if (!body) return Promise.resolve(true);
    const rolesRaw = (body.dataset.roles || "").trim();
    const requiresAdmin = Object.prototype.hasOwnProperty.call(body.dataset, "admin");
    const user = currentUser;

    if (requiresAdmin) {
      const ok = (user && userRole(user) === "admin") || !!getAdminKey();
      if (!ok) {
        redirectTo("login.html?next=" + encodeURIComponent(currentPageFile()));
        return Promise.resolve(false);
      }
    }

    if (rolesRaw) {
      if (!user) {
        if (!/login\.html?$/i.test(currentPageFile())) {
          redirectTo("login.html?next=" + encodeURIComponent(currentPageFile()));
        }
        return Promise.resolve(false);
      }
      const allowed = rolesRaw.split(/[\s,]+/).filter(Boolean);
      if (!isRoleAllowed(user, allowed)) {
        redirectTo("dashboard.html");
        return Promise.resolve(false);
      }
    }
    return Promise.resolve(true);
  }

  function initialize() {
    if (initialized) return;
    initialized = true;

    injectShell();
    setupNavToggle();
    setupLogoutHandler();
    applyNavVisibility(currentUser);
    markActiveNav();

    refreshUser().then(function (user) {
      applyNavVisibility(user);
      markActiveNav();
      return enforceGuards();
    }).then(function (allowed) {
      if (allowed) {
        runPageController();
        // Controllers register their jobs-updated listeners during init; re-emit
        // once so a fast initial fetch is never missed.
        window.dispatchEvent(new CustomEvent("habesha:jobs-updated", {
          detail: { jobs: JobsApi.getCached() || [] }
        }));
      }
      flushReady();
    }).catch(function () {
      flushReady();
    });

    JobsApi.refresh({ limit: 100 }).catch(function () { /* rendered via the jobs-updated event */ });
  }

  let domReadyFired = false;
  document.addEventListener("DOMContentLoaded", function () {
    domReadyFired = true;
    initialize();
  });
  if (document.readyState === "complete") {
    setTimeout(function () {
      if (!domReadyFired) {
        domReadyFired = true;
        initialize();
      }
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  window.App = {
    api: api,
    getUser: getUser,
    refreshUser: refreshUser,
    requireRole: requireRole,
    logout: logout,
    toast: toast,
    esc: esc,
    formatDate: formatDate,
    qs: qs,
    qsa: qsa,
    onPage: onPage,
    onReady: onReady,
    go: go,
    jobCard: jobCard,
    markActiveNav: markActiveNav,
    setLoading: setLoading,
    initialize: initialize,

    // compatibility aliases
    JobsApi: JobsApi,
    HabeshaUI: HabeshaUI,
    getAllJobs: getAllJobs,
    getJobById: getJobById,
    getDaysUntilDeadline: getDaysUntilDeadline,

    // extra helpers used by page controllers during the transition
    setCurrentUser: setCurrentUser,
    setSessionFromMe: setSessionFromMe,
    userRole: userRole,
    postAuthRedirect: postAuthRedirect,
    safeNextPage: safeNextPage,
    applyNavVisibility: applyNavVisibility
  };

  // Legacy globals (kept only as aliases; no duplicate implementations).
  window.HabeshaUI = HabeshaUI;
  window.JobsApi = JobsApi;
  window.getAllJobs = getAllJobs;
  window.getJobById = getJobById;
  window.getDaysUntilDeadline = getDaysUntilDeadline;
})();
