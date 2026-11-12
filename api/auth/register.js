import { json, parseJsonBody, sanitizeText } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import { createSession, createUser, ensureBootstrapAdmin, findUserByEmail, isValidEmail, normalizeEmail, publicUser, setSessionCookie } from "../../lib/auth.mjs";

export default async function handler(req, res) {
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
      // Unique email constraint (race-safe).
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
