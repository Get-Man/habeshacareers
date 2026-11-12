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
