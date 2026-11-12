import { json, requireCron, requireAdmin } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import { syncEnabledSources } from "../../lib/jobs/sync.mjs";

// Catalog batches (listing page + many detail fetches) exceed the 10s default.
export const maxDuration = 60;

export default async function handler(req, res) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when configured; allow admin key for manual tests.
  if (!requireCron(req) && !requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    // Bounded batches keep each invocation within serverless limits.
    const out = await syncEnabledSources(req.query?.source ? "manual" : "cron", parseInt(req.query?.max || "3", 10) || 3, {
      discoveryLimit: parseInt(req.query?.discover || "12", 10) || 12,
      extractionBatch: parseInt(req.query?.extract || "8", 10) || 8,
      concurrency: parseInt(req.query?.concurrency || "3", 10) || 3,
    });
    return json(res, 200, { ok: true, ...out });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: String(e.message || e) });
  }
}
