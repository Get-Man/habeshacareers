import { json } from "../_lib/http.js";
import { clearSessionCookie, destroyCurrentSession } from "../../lib/auth.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });
  try {
    await destroyCurrentSession(req).catch(() => {});
  } catch {}
  clearSessionCookie(res);
  return json(res, 200, { ok: true, message: "Logged out." });
}
