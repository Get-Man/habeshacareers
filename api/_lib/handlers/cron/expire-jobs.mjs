import { json, requireCron, requireAdmin } from "../../http.js";
import { hasDatabase } from "../../../../lib/db.mjs";
import { refreshJobLifecycle } from "../../../../lib/jobs/extract/engine.mjs";

// Dedicated expiry sweep. Vacancies whose application deadline has passed are
// marked expired (and therefore hidden by public_job_listings) for every
// source, including ETCareers. Runs independently of sync/extract so a locked
// or skipped sync can never postpone removal of an expired vacancy.
export const maxDuration = 60;

export default async function handler(req, res) {
  if (!requireCron(req) && !requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    const lifecycle = await refreshJobLifecycle();
    console.log("[expire-jobs]", JSON.stringify(lifecycle));
    return json(res, 200, { ok: true, ...lifecycle });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: String(e.message || e) });
  }
}
