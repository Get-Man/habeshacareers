import { json, requireCron, requireAdmin } from "../../http.js";
import { hasDatabase } from "../../../../lib/db.mjs";
import { runQueuedExtraction } from "../../../../lib/jobs/sync.mjs";

// Stage B extraction batch. The global lock prevents overlap with a running sync.
export const maxDuration = 60;

export default async function handler(req, res) {
  if (!requireCron(req) && !requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    const out = await runQueuedExtraction(req.query?.manual ? "manual" : "cron", {
      extractionBatch: parseInt(req.query?.extract || "10", 10) || 10,
      concurrency: parseInt(req.query?.concurrency || "3", 10) || 3,
    });
    return json(res, 200, { ok: true, ...out });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: String(e.message || e) });
  }
}
