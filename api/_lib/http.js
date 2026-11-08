export function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", status === 200 ? "public, max-age=60" : "no-store");
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
  const key = process.env.ADMIN_API_KEY;
  if (!key) return false;
  const auth = req.headers.authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-admin-key"] || req.query?.key);
  return provided === key;
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
