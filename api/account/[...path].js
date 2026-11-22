// Account API dispatcher.
//
// One serverless function serves the whole account suite:
//   GET    /api/account/profile
//   PATCH  /api/account/profile
//   POST   /api/account/password
//   POST   /api/account/forgot-password
//   POST   /api/account/reset-password
//   GET    /api/account/session
//   DELETE /api/account/session?id=<id>
//   POST   /api/account/session/revoke-others
//
// The catch-all segment is not exposed the same way on every Vercel runtime,
// so routes are read from the request path first, then from the query.

import { json, parseJsonBody, requireRole, sanitizeText } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import {
  changeUserPassword,
  consumePasswordReset,
  createPasswordReset,
  findUserByEmail,
  forgotPasswordResponse,
  getProfile,
  getSessionToken,
  isValidEmail,
  isValidResetToken,
  listUserSessions,
  normalizeEmail,
  publicUser,
  revokeOtherUserSessions,
  revokeUserSession,
  sanitizeAccountFields,
  sanitizeProfileData,
  saveProfile,
  updateUserAccount,
} from "../../lib/auth.mjs";

const EMPLOYER_FIELDS = ["companyName", "company_name", "company", "contactName", "contact_name"];
const DB_MESSAGE = "Account settings require database configuration.";

// Never let a CDN or browser cache one user's account data for another.
function accountJson(res, status, body) {
  return json(res, status, body, { private: true });
}

function accountSegments(req) {
  const url = String(req?.url || req?.originalUrl || "");
  const match = /\/api\/account\/([^?]+)/i.exec(url);
  let parts = [];
  if (match) parts = String(match[1]).split("/").filter(Boolean);
  if (!parts.length) {
    const raw = req?.query?.path;
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    parts = values.flatMap((value) => String(value).split("/")).filter(Boolean);
  }
  return parts.map((part) => part.toLowerCase());
}

function queryParam(req, name) {
  const direct = req?.query?.[name];
  if (direct != null) return direct;
  const url = String(req?.url || req?.originalUrl || "");
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(query).get(name);
}

function onlyEmployerFields(body) {
  return EMPLOYER_FIELDS.some((key) => body?.[key] != null && String(body[key]).trim() !== "");
}

function methodNotAllowed(res) {
  return accountJson(res, 405, { ok: false, error: "method_not_allowed" });
}

function isProduction() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production" || !!process.env.VERCEL;
}

function hasEmailProvider() {
  return !!String(process.env.EMAIL_WEBHOOK_URL || "").trim();
}

function buildResetUrl(token) {
  const base = String(process.env.PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  // The reset panel lives in the canonical React app; it opens from ?reset=.
  const path = `/login?reset=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

async function sendResetInstructions(to, resetUrl) {
  const webhook = String(process.env.EMAIL_WEBHOOK_URL || "").trim();
  if (!webhook) {
    // Never log a token or a reset link, in production or elsewhere.
    if (isProduction()) console.info("[account] password reset requested; no email provider configured");
    return false;
  }
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, resetUrl }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error("[account] reset email provider rejected the request", response.status);
      return false;
    }
    return true;
  } catch (error) {
    // Keep the event visible to operators without leaking the URL/token.
    console.error("[account] reset email provider failed", error?.name || "Error");
    return false;
  }
}

async function getProfileHandler(req, res, user) {
  if (!hasDatabase()) return accountJson(res, 503, { ok: false, error: "db_unavailable", message: DB_MESSAGE });
  try {
    const profile = await getProfile(user.id);
    return accountJson(res, 200, { ok: true, user: publicUser(user), profile });
  } catch (error) {
    console.error(error);
    return accountJson(res, 500, { ok: false, error: "server_error", message: "Could not load your profile." });
  }
}

async function patchProfileHandler(req, res, user, body) {
  if (!hasDatabase()) return accountJson(res, 503, { ok: false, error: "db_unavailable", message: DB_MESSAGE });
  if (Object.prototype.hasOwnProperty.call(body, "profile")) {
    if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
      return accountJson(res, 400, { ok: false, error: "validation", message: "profile must be an object." });
    }
  }
  try {
    const fields = sanitizeAccountFields(
      {
        name: sanitizeText(body.name ?? body.fullName, 200),
        phone: sanitizeText(body.phone, 50),
        location: sanitizeText(body.location, 200),
        company_name: sanitizeText(body.companyName ?? body.company_name ?? body.company, 200),
        contact_name: sanitizeText(body.contactName ?? body.contact_name, 200),
      },
      user.role
    );
    let updated = user;
    if (Object.keys(fields).length) updated = (await updateUserAccount(user.id, fields)) || user;

    if (Object.prototype.hasOwnProperty.call(body, "profile")) {
      // Shallow merge: a partial profile update keeps the remaining fields.
      const existing = await getProfile(user.id);
      await saveProfile(user.id, { ...existing, ...sanitizeProfileData(body.profile) });
    }
    const profile = await getProfile(user.id);
    return accountJson(res, 200, { ok: true, user: publicUser(updated), profile });
  } catch (error) {
    console.error(error);
    return accountJson(res, 500, { ok: false, error: "server_error", message: "Could not save your profile." });
  }
}

async function changePasswordHandler(req, res, user) {
  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    return accountJson(res, 400, { ok: false, error: "invalid_json", message: "Invalid request body." });
  }
  const currentPassword = String(body?.currentPassword || "");
  const newPassword = String(body?.newPassword || "");
  if (!currentPassword || !newPassword) {
    return accountJson(res, 400, { ok: false, error: "validation", message: "Both passwords are required." });
  }
  if (newPassword.length < 8) {
    return accountJson(res, 400, { ok: false, error: "weak_password", message: "Password must be at least 8 characters." });
  }
  if (!hasDatabase()) return accountJson(res, 503, { ok: false, error: "db_unavailable", message: DB_MESSAGE });
  try {
    await changeUserPassword(user.id, currentPassword, newPassword);
    return accountJson(res, 200, { ok: true, message: "Password updated successfully." });
  } catch (error) {
    const code = String(error?.message || error);
    if (code === "invalid_current_password") {
      return accountJson(res, 400, { ok: false, error: "invalid_current_password", message: "Your current password is incorrect." });
    }
    if (code === "password_too_short") {
      return accountJson(res, 400, { ok: false, error: "weak_password", message: "Password must be at least 8 characters." });
    }
    console.error(error);
    return accountJson(res, 500, { ok: false, error: "server_error", message: "Could not update your password." });
  }
}

async function forgotPasswordHandler(req, res) {
  let body = {};
  try {
    body = await parseJsonBody(req);
  } catch {
    body = {};
  }
  // The response is identical whether the email exists, is invalid, or the
  // database is unavailable.
  const response = forgotPasswordResponse();
  try {
    const email = normalizeEmail(body?.email);
    if (email && isValidEmail(email) && hasDatabase()) {
      const user = await findUserByEmail(email);
      if (user?.is_active) {
        const token = await createPasswordReset(user.id);
        const resetUrl = buildResetUrl(token);
        await sendResetInstructions(user.email, resetUrl);
        // Local convenience only: never expose a token/link in production.
        if (!isProduction() && !hasEmailProvider()) response.devResetUrl = resetUrl;
      }
    }
  } catch (error) {
    console.error("[account] password reset request failed", error?.name || "Error");
  }
  return accountJson(res, 200, response);
}

function invalidResetToken(res) {
  return accountJson(res, 400, {
    ok: false,
    error: "invalid_or_expired_token",
    message: "This reset link is invalid or has expired.",
  });
}

async function resetPasswordHandler(req, res) {
  let body = {};
  try {
    body = await parseJsonBody(req);
  } catch {
    body = {};
  }
  const token = String(body?.token || "").trim();
  const password = String(body?.password || "");
  if (!isValidResetToken(token)) return invalidResetToken(res);
  if (password.length < 8) {
    return accountJson(res, 400, { ok: false, error: "weak_password", message: "Password must be at least 8 characters." });
  }
  if (!hasDatabase()) return accountJson(res, 503, { ok: false, error: "db_unavailable", message: DB_MESSAGE });
  try {
    await consumePasswordReset(token, password);
    return accountJson(res, 200, { ok: true, message: "Password has been reset. You can now sign in." });
  } catch (error) {
    const code = String(error?.message || error);
    if (code === "invalid_or_expired_token") return invalidResetToken(res);
    if (code === "password_too_short") {
      return accountJson(res, 400, { ok: false, error: "weak_password", message: "Password must be at least 8 characters." });
    }
    console.error(error);
    return accountJson(res, 500, { ok: false, error: "server_error", message: "Could not reset your password." });
  }
}

async function sessionHandler(req, res, user, parts) {
  const action = String(queryParam(req, "action") || parts[1] || "").toLowerCase();
  if (!hasDatabase()) return accountJson(res, 503, { ok: false, error: "db_unavailable", message: DB_MESSAGE });
  try {
    if (req.method === "GET" && !action) {
      const sessions = await listUserSessions(user.id, getSessionToken(req));
      return accountJson(res, 200, { ok: true, sessions });
    }
    if (req.method === "POST" && action === "revoke-others") {
      const revoked = await revokeOtherUserSessions(user.id, getSessionToken(req));
      return accountJson(res, 200, { ok: true, revoked });
    }
    if (req.method === "DELETE" && !action) {
      const id = queryParam(req, "id");
      if (!id) return accountJson(res, 400, { ok: false, error: "validation", message: "A session id is required." });
      // A session that belongs to someone else simply does not match this user.
      const removed = await revokeUserSession(user.id, id);
      if (!removed) return accountJson(res, 404, { ok: false, error: "not_found", message: "Session not found." });
      return accountJson(res, 200, { ok: true });
    }
    return methodNotAllowed(res);
  } catch (error) {
    console.error(error);
    return accountJson(res, 500, { ok: false, error: "server_error", message: "Could not update your sessions." });
  }
}

export default async function handler(req, res) {
  try {
    const parts = accountSegments(req);
    const route = parts[0] || "";

    // Password recovery must work without a session; every other route is
    // authenticated before the method is even considered.
    if (route === "forgot-password") {
      if (req.method !== "POST") return methodNotAllowed(res);
      return forgotPasswordHandler(req, res);
    }
    if (route === "reset-password") {
      if (req.method !== "POST") return methodNotAllowed(res);
      return resetPasswordHandler(req, res);
    }
    if (!["profile", "password", "session"].includes(route)) {
      return accountJson(res, 404, {
        ok: false,
        error: "not_found",
        available: ["profile", "password", "forgot-password", "reset-password", "session"],
      });
    }

    let body = null;
    if (route === "profile" && req.method === "PATCH") {
      try {
        body = await parseJsonBody(req);
      } catch {
        return accountJson(res, 400, { ok: false, error: "invalid_json", message: "Invalid request body." });
      }
    }
    const user = await requireRole(req, res, route === "profile" && req.method === "PATCH" && onlyEmployerFields(body) ? ["employer"] : []);
    if (!user) return;

    if (route === "profile") {
      if (req.method === "GET") return getProfileHandler(req, res, user);
      if (req.method === "PATCH") return patchProfileHandler(req, res, user, body);
      return methodNotAllowed(res);
    }
    if (route === "password") {
      if (req.method !== "POST") return methodNotAllowed(res);
      return changePasswordHandler(req, res, user);
    }
    if (route === "session") return sessionHandler(req, res, user, parts);
    return methodNotAllowed(res);
  } catch (error) {
    console.error(error);
    return accountJson(res, 500, { ok: false, error: "server_error", message: "Account request failed." });
  }
}
