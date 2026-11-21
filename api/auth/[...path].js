// Auth API dispatcher.
//
// Vercel's Hobby plan caps a deployment at 12 serverless functions, so the
// auth endpoints share a single catch-all function instead of one function
// per endpoint. The handler logic lives here, not under api/_lib/, so the
// original URLs stay unchanged:
//   /api/auth/login
//   /api/auth/register
//   /api/auth/me
//   /api/auth/logout

import { json, parseJsonBody, sanitizeText } from "../_lib/http.js";
import { hasDatabase, query } from "../../lib/db.mjs";
import {
  clearSessionCookie,
  createSession,
  createUser,
  destroyCurrentSession,
  ensureBootstrapAdmin,
  findUserByEmail,
  getUserFromRequest,
  isValidEmail,
  normalizeEmail,
  publicUser,
  setSessionCookie,
  verifyPassword,
} from "../../lib/auth.mjs";

async function login(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable", message: "Authentication requires database configuration." });
  try {
    await ensureBootstrapAdmin().catch(() => null);
    const body = await parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    if (!email || !password) return json(res, 400, { ok: false, error: "validation", message: "Email and password are required." });

    const user = await findUserByEmail(email);
    if (!user || !user.is_active) return json(res, 401, { ok: false, error: "invalid_credentials", message: "Invalid email or password." });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return json(res, 401, { ok: false, error: "invalid_credentials", message: "Invalid email or password." });

    await query(`update users set last_login_at = now(), updated_at = now() where id = $1`, [user.id]).catch(() => {});
    const session = await createSession(user.id, req);
    setSessionCookie(res, session.token);
    return json(res, 200, { ok: true, user: publicUser({ ...user, last_login_at: new Date().toISOString() }), message: "Login successful." });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: "Could not log in." });
  }
}

async function register(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable", message: "Authentication requires database configuration." });
  try {
    await ensureBootstrapAdmin().catch(() => null);
    const body = await parseJsonBody(req);
    const role = String(body.role || "").trim().toLowerCase();
    if (!["employee", "employer"].includes(role)) {
      return json(res, 400, { ok: false, error: "invalid_role", message: "Role must be employee or employer." });
    }

    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const confirmPassword = body.confirmPassword == null ? null : String(body.confirmPassword);
    if (!isValidEmail(email)) return json(res, 400, { ok: false, error: "invalid_email", message: "Please provide a valid email address." });
    if (password.length < 8) return json(res, 400, { ok: false, error: "weak_password", message: "Password must be at least 8 characters." });
    if (confirmPassword != null && password !== confirmPassword) return json(res, 400, { ok: false, error: "password_mismatch", message: "Passwords do not match." });

    const existing = await findUserByEmail(email);
    if (existing) return json(res, 409, { ok: false, error: "email_exists", message: "An account with this email already exists." });

    const payload = {
      email,
      password,
      role,
      name: role === "employee" ? sanitizeText(body.name || body.fullName, 200) : sanitizeText(body.contactName || body.name, 200),
      companyName: role === "employer" ? sanitizeText(body.companyName || body.company, 200) : null,
      contactName: role === "employer" ? sanitizeText(body.contactName || body.name, 200) : null,
      phone: sanitizeText(body.phone, 50),
      location: sanitizeText(body.location, 200),
    };

    if (role === "employee" && !payload.name) return json(res, 400, { ok: false, error: "validation", message: "Full name is required." });
    if (role === "employer" && !payload.companyName) return json(res, 400, { ok: false, error: "validation", message: "Company name is required." });
    if (role === "employer" && !payload.contactName) return json(res, 400, { ok: false, error: "validation", message: "Contact person is required." });

    let user;
    try {
      user = await createUser(payload);
    } catch (e) {
      const msg = String(e?.message || e);
      const code = e?.code || "";
      if (msg === "password_too_short") return json(res, 400, { ok: false, error: "weak_password", message: "Password must be at least 8 characters." });
      if (msg === "invalid_email") return json(res, 400, { ok: false, error: "invalid_email", message: "Please provide a valid email address." });
      if (code === "23505" || /unique|duplicate/i.test(msg)) {
        return json(res, 409, { ok: false, error: "email_exists", message: "An account with this email already exists." });
      }
      throw e;
    }
    const session = await createSession(user.id, req);
    setSessionCookie(res, session.token);
    return json(res, 201, { ok: true, user: publicUser(user), message: "Registration successful." });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: "Could not create account." });
  }
}

async function me(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "method_not_allowed" });
  try {
    await ensureBootstrapAdmin().catch(() => null);
    const user = await getUserFromRequest(req);
    if (!user) return json(res, 200, { ok: true, user: null, authenticated: false });
    return json(res, 200, { ok: true, user: publicUser(user), authenticated: true });
  } catch (e) {
    console.error(e);
    return json(res, 200, { ok: true, user: null, authenticated: false });
  }
}

async function logout(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });
  try {
    await destroyCurrentSession(req).catch(() => {});
  } catch {}
  clearSessionCookie(res);
  return json(res, 200, { ok: true, message: "Logged out." });
}

const ROUTES = { login, register, me, logout };

function routeName(req) {
  const url = String(req?.url || req?.originalUrl || "");
  const match = /\/api\/auth\/([a-z0-9-]+)/i.exec(url);
  if (match) return match[1].toLowerCase();
  const raw = req?.query?.path;
  const segments = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
  return String(segments[0] || "").toLowerCase();
}

export default async function handler(req, res) {
  const name = routeName(req);
  const route = ROUTES[name];
  if (!route) {
    return json(res, 404, {
      ok: false,
      error: "not_found",
      available: Object.keys(ROUTES).sort(),
    });
  }
  try {
    return await route(req, res);
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: "Authentication request failed." });
  }
}
