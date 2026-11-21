import { getUserFromRequest } from "../../lib/auth.mjs";

export function json(res, status, body, options = {}) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Account responses are user-specific: callers pass { private: true }.
  res.setHeader("Cache-Control", status === 200 && !options.private ? "public, max-age=60" : "no-store");
  res.end(JSON.stringify(body));
}

export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

export function requireAdmin(req) {
  const clean = (v) => String(v || "").replace(/^\uFEFF/, "").trim();
  const key = clean(process.env.ADMIN_API_KEY);
  // Optional alternate automation/backfill token (e.g. created via CLI for scripts).
  // No effect unless SYNC_TOKEN is set in the deployment env; falls back to ADMIN_API_KEY-only.
  const token = clean(process.env.SYNC_TOKEN);
  const auth = req.headers.authorization || "";
  const provided = clean(auth.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-admin-key"] || req.query?.key));
  if ((!!key && provided === key) || (!!token && provided === token)) return true;
  // Backward-compatible path: allow logged-in admin session users.
  if (req.authUser && req.authUser.role === "admin") return true;
  return false;
}

/**
 * Resolve the signed-in user and (optionally) restrict to specific roles.
 * Writes the error response itself and returns null when access is denied.
 * No roles means "any authenticated account".
 */
export async function requireRole(req, res, roles) {
  let user = null;
  try {
    user = await getUserFromRequest(req);
  } catch {
    user = null;
  }
  if (!user) {
    json(res, 401, {
      ok: false,
      error: "unauthorized",
      message: "Please sign in.",
    });
    return null;
  }
  const allowed = (Array.isArray(roles) ? roles : roles ? [roles] : []).map((r) => String(r).toLowerCase());
  if (allowed.length && !allowed.includes(String(user.role || "").toLowerCase())) {
    json(res, 403, {
      ok: false,
      error: "forbidden",
      message: "Your account does not have access to this action.",
    });
    return null;
  }
  req.authUser = user;
  return user;
}

export function requireCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : req.headers["x-cron-secret"];
  return provided === secret || req.query?.secret === secret;
}

export function sanitizeText(s, max = 20000) {
  if (s == null) return null;
  const str = String(s).replace(/\u0000/g, "").trim();
  return str.length > max ? str.slice(0, max) : str;
}
