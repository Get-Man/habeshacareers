import { json, requireAdmin, parseJsonBody } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import { syncSourceBySlug, syncEnabledSources } from "../../lib/jobs/sync.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  try {
    const body = await parseJsonBody(req).catch(() => ({}));
    if (body.slug) return json(res, 200, { ok: true, result: await syncSourceBySlug(body.slug, 'manual') });
    return json(res, 200, { ok: true, result: await syncEnabledSources('manual', 5) });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: String(e.message || e) });
  }
}
