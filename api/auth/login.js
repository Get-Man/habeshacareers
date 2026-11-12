import { json, parseJsonBody } from "../_lib/http.js";
import { hasDatabase, query } from "../../lib/db.mjs";
import { createSession, ensureBootstrapAdmin, findUserByEmail, normalizeEmail, publicUser, setSessionCookie, verifyPassword } from "../../lib/auth.mjs";

export default async function handler(req, res) {
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
