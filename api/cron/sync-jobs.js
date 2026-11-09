import { json, requireCron, requireAdmin } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import { syncEnabledSources } from "../../lib/jobs/sync.mjs";

// Same rationale as /api/admin/sync: catalog batches need more than the 10s default.
export const maxDuration = 60;

export default async function handler(req, res) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when configured; allow admin key for manual tests.
  if (!requireCron(req) && !requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    // Batch to stay within serverless limits.
    const out = await syncEnabledSources(req.query?.source ? 'manual' : 'cron', parseInt(req.query?.max || '3', 10) || 3);
    return json(res, 200, { ok: true, ...out });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: String(e.message || e) });
  }
}
