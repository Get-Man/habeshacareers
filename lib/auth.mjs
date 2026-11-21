import crypto from "node:crypto";
import { query } from "./db.mjs";

const SESSION_COOKIE = "hc_session";
const SESSION_TTL_DAYS = 30;

function now() {
  return new Date();
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  const e = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
}

export async function hashPassword(password) {
  const pw = String(password || "");
  if (pw.length < 8) throw new Error("password_too_short");
  const salt = crypto.randomBytes(16);
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
  return `scrypt$16384$8$1$${base64url(salt)}$${base64url(derived)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, nStr, rStr, pStr, saltB64, hashB64] = String(stored || "").split("$");
    if (algo !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64url");
    const expected = Buffer.from(hashB64, "base64url");
    const derived = await new Promise((resolve, reject) => {
      crypto.scrypt(String(password || ""), salt, expected.length, {
        N: parseInt(nStr, 10) || 16384,
        r: parseInt(rStr, 10) || 8,
        p: parseInt(pStr, 10) || 1,
      }, (err, buf) => {
        if (err) reject(err);
        else resolve(buf);
      });
    });
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers?.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function getSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  const auth = req.headers?.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

export function setSessionCookie(res, token, { maxAgeDays = SESSION_TTL_DAYS } = {}) {
  const secure = String(process.env.NODE_ENV || "").toLowerCase() === "production" || !!process.env.VERCEL;
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeDays * 24 * 60 * 60))}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res) {
  const secure = String(process.env.NODE_ENV || "").toLowerCase() === "production" || !!process.env.VERCEL;
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function publicUser(row) {
  if (!row) return null;
  const role = row.role;
  const name = row.name || row.contact_name || null;
  const companyName = row.company_name || null;
  // Backward-compatible frontend fields (legacy code expects `type` and jobseeker/employer semantics).
  const type = role === "employee" ? "jobseeker" : role === "employer" ? "employer" : role;
  return {
    id: row.id,
    email: row.email,
    role,
    type,
    name,
    fullName: name,
    company: companyName,
    companyName,
    contactName: row.contact_name || null,
    phone: row.phone || null,
    location: row.location || null,
    createdAt: row.created_at || null,
  };
}

export async function createSession(userId, req) {
  const token = base64url(crypto.randomBytes(32));
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const ua = String(req.headers?.["user-agent"] || "").slice(0, 500) || null;
  const ip = String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const ipHash = ip ? sha256Hex(ip) : null;
  await query(
    `insert into user_sessions (user_id, token_hash, expires_at, user_agent, ip_hash) values ($1,$2,$3,$4,$5)`,
    [userId, tokenHash, expiresAt.toISOString(), ua, ipHash]
  );
  return { token, expiresAt };
}

export async function getUserFromRequest(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const rows = await query(
    `select u.*, s.id as session_id
       from user_sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1
        and s.expires_at > now()
        and u.is_active = true
      limit 1`,
    [tokenHash]
  );
  const user = rows[0] || null;
  if (user) {
    query(`update user_sessions set last_seen_at = now() where id = $1`, [user.session_id]).catch(() => {});
  }
  return user;
}

export async function destroyCurrentSession(req) {
  const token = getSessionToken(req);
  if (!token) return false;
  const tokenHash = sha256Hex(token);
  const r = await query(`delete from user_sessions where token_hash = $1 returning id`, [tokenHash]);
  return r.length > 0;
}

export async function findUserByEmail(email) {
  const rows = await query(`select * from users where lower(email)=lower($1) limit 1`, [normalizeEmail(email)]);
  return rows[0] || null;
}

export async function createUser({ email, password, role, name, companyName, contactName, phone, location }) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) throw new Error("invalid_email");
  if (!["admin", "employee", "employer"].includes(role)) throw new Error("invalid_role");
  const passwordHash = await hashPassword(password);
  const rows = await query(
    `insert into users (email, password_hash, role, name, company_name, contact_name, phone, location)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning *`,
    [
      normalized,
      passwordHash,
      role,
      name ? String(name).trim().slice(0, 200) : null,
      companyName ? String(companyName).trim().slice(0, 200) : null,
      contactName ? String(contactName).trim().slice(0, 200) : null,
      phone ? String(phone).trim().slice(0, 50) : null,
      location ? String(location).trim().slice(0, 200) : null,
    ]
  );
  return rows[0];
}

export async function ensureBootstrapAdmin() {
  // Bootstrap first admin from env if none exists (safe for production setup).
  const email = normalizeEmail(process.env.INITIAL_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "");
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "");
  if (!email || !password) return null;
  if (!isValidEmail(email) || password.length < 8) return null;
  const existingAdmin = await query(`select id from users where role='admin' limit 1`);
  if (existingAdmin.length) return null;
  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.role !== "admin") {
      await query(`update users set role='admin', updated_at=now() where id=$1`, [existing.id]);
    }
    return existing.id;
  }
  const user = await createUser({
    email,
    password,
    role: "admin",
    name: "Administrator",
  });
  return user.id;
}

// ---------------------------------------------------------------------------
// Account suite helpers (profile, password reset and session management).
// Everything below is scoped to a single authenticated user id. Pure helpers
// are exported so they can be unit tested without a database.
// ---------------------------------------------------------------------------

const RESET_TTL_MS = 60 * 60 * 1000;
const RESET_TOKEN_BYTES = 32;
const PROFILE_MAX_BYTES = 64 * 1024;
const PROFILE_STRING_LIMIT = 20000;
const PROFILE_DEPTH_LIMIT = 6;
const PROFILE_ARRAY_LIMIT = 200;

const ACCOUNT_FIELD_LIMITS = {
  name: 200,
  phone: 50,
  location: 200,
  company_name: 200,
  contact_name: 200,
};

/** Hash a session/reset token for storage or comparison. */
export function hashSessionToken(value) {
  return sha256Hex(value);
}

function cleanAccountText(value, max) {
  if (value == null) return null;
  const str = String(value).replace(/\u0000/g, "").trim();
  if (!str) return null;
  return str.length > max ? str.slice(0, max) : str;
}

/**
 * Whitelist the editable account columns for a role. Employees and admins may
 * edit their own identity/contact details; only employers own company fields.
 */
export function sanitizeAccountFields(fields, role) {
  const input = fields && typeof fields === "object" ? fields : {};
  const allowed = ["name", "phone", "location"];
  if (role === "employer") allowed.push("company_name", "contact_name");
  const out = {};
  for (const key of allowed) {
    if (!(key in input)) continue;
    const value = cleanAccountText(input[key], ACCOUNT_FIELD_LIMITS[key]);
    if (value !== null) out[key] = value;
  }
  return out;
}

function isPrivateProfileKey(key) {
  const name = String(key).toLowerCase();
  return name.startsWith("_") || name.includes("password") || name.includes("token");
}

function sanitizeProfileValue(value, depth) {
  if (value == null) return null;
  if (typeof value === "string") {
    const str = value.replace(/\u0000/g, "").trim();
    return str.length > PROFILE_STRING_LIMIT ? str.slice(0, PROFILE_STRING_LIMIT) : str;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= PROFILE_DEPTH_LIMIT) return [];
    return value.slice(0, PROFILE_ARRAY_LIMIT).map((item) => sanitizeProfileValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= PROFILE_DEPTH_LIMIT) return {};
    const out = {};
    for (const key of Object.keys(value)) {
      if (isPrivateProfileKey(key)) continue;
      out[key] = sanitizeProfileValue(value[key], depth + 1);
    }
    return out;
  }
  return null;
}

/**
 * Normalise arbitrary JSON profile fields into a bounded, secret-free object.
 * Keys beginning with "_" or containing "password"/"token" are never stored.
 */
export function sanitizeProfileData(data, maxBytes = PROFILE_MAX_BYTES) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const clean = sanitizeProfileValue(data, 0);
  let serialized = JSON.stringify(clean) || "{}";
  const keys = Object.keys(clean);
  for (let i = keys.length - 1; i >= 0 && Buffer.byteLength(serialized, "utf8") > maxBytes; i -= 1) {
    delete clean[keys[i]];
    serialized = JSON.stringify(clean) || "{}";
  }
  try {
    return JSON.parse(serialized);
  } catch {
    return {};
  }
}

/** The password-reset response is intentionally identical for every email. */
export function forgotPasswordResponse() {
  return {
    ok: true,
    message: "If an account exists, reset instructions have been sent.",
  };
}

/** Reset tokens are base64url strings; reject anything else before hashing. */
export function isValidResetToken(token) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(String(token || ""));
}

/** Attach the `current` flag by comparing the stored hash with the caller's token. */
export function withCurrentSessionFlag(rows, currentToken) {
  const currentHash = currentToken ? sha256Hex(currentToken) : null;
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => ({
    id: row.id,
    created_at: row.created_at ?? null,
    last_seen_at: row.last_seen_at ?? null,
    user_agent: row.user_agent ?? null,
    current: !!currentHash && row.token_hash === currentHash,
  }));
}

export async function createPasswordReset(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("invalid_user");
  // One live link per user: retire any previous unconsumed reset.
  await query(
    `update user_password_resets set used_at = now() where user_id = $1 and used_at is null`,
    [id]
  );
  const token = base64url(crypto.randomBytes(RESET_TOKEN_BYTES));
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await query(
    `insert into user_password_resets (user_id, token_hash, expires_at) values ($1,$2,$3)`,
    [id, sha256Hex(token), expiresAt.toISOString()]
  );
  return token;
}

export async function consumePasswordReset(token, newPassword) {
  if (!isValidResetToken(token)) throw new Error("invalid_or_expired_token");
  // Validate the new password before consuming the one-time token.
  const passwordHash = await hashPassword(newPassword);
  // The conditional UPDATE is atomic: a token can only be consumed once.
  const claimed = await query(
    `update user_password_resets set used_at = now()
       where token_hash = $1 and used_at is null and expires_at > now()
      returning user_id`,
    [sha256Hex(token)]
  );
  const userId = claimed[0]?.user_id;
  if (!userId) throw new Error("invalid_or_expired_token");
  const users = await query(
    `update users set password_hash = $2, updated_at = now() where id = $1 returning *`,
    [userId, passwordHash]
  );
  if (!users[0]) throw new Error("invalid_or_expired_token");
  return users[0];
}

export async function changeUserPassword(userId, currentPassword, newPassword) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("invalid_user");
  const rows = await query(`select password_hash from users where id = $1`, [id]);
  const stored = rows[0]?.password_hash;
  if (!stored || !(await verifyPassword(currentPassword, stored))) {
    throw new Error("invalid_current_password");
  }
  const passwordHash = await hashPassword(newPassword);
  await query(`update users set password_hash = $2, updated_at = now() where id = $1`, [id, passwordHash]);
  return true;
}

export async function listUserSessions(userId, currentToken) {
  const rows = await query(
    `select id, token_hash, created_at, last_seen_at, user_agent
       from user_sessions
      where user_id = $1 and expires_at > now()
      order by last_seen_at desc, id desc`,
    [Number(userId)]
  );
  return withCurrentSessionFlag(rows, currentToken);
}

export async function revokeUserSession(userId, sessionId) {
  const id = Number(sessionId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const rows = await query(
    `delete from user_sessions where id = $1 and user_id = $2 returning id`,
    [id, Number(userId)]
  );
  return rows.length;
}

export async function revokeOtherUserSessions(userId, currentToken) {
  if (!currentToken) return 0;
  const rows = await query(
    `delete from user_sessions where user_id = $1 and token_hash <> $2 returning id`,
    [Number(userId), sha256Hex(currentToken)]
  );
  return rows.length;
}

export async function updateUserAccount(userId, fields) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("invalid_user");
  const existing = await query(`select role from users where id = $1`, [id]);
  const role = existing[0]?.role;
  if (!role) throw new Error("user_not_found");
  const clean = sanitizeAccountFields(fields, role);
  const entries = Object.entries(clean);
  if (!entries.length) return null;
  const sets = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
  const rows = await query(
    `update users set ${sets}, updated_at = now() where id = $${entries.length + 1} returning *`,
    [...entries.map(([, value]) => value), id]
  );
  return rows[0] || null;
}

export async function getProfile(userId) {
  const rows = await query(`select data from user_profiles where user_id = $1`, [Number(userId)]);
  return rows[0]?.data || {};
}

export async function saveProfile(userId, data) {
  const clean = sanitizeProfileData(data);
  const rows = await query(
    `insert into user_profiles (user_id, data, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (user_id) do update set data = excluded.data, updated_at = now()
     returning data, updated_at`,
    [Number(userId), JSON.stringify(clean)]
  );
  return rows[0] || { data: clean };
}
