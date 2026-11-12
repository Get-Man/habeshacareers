import { json } from "../_lib/http.js";
import { ensureBootstrapAdmin, getUserFromRequest, publicUser } from "../../lib/auth.mjs";

export default async function handler(req, res) {
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
