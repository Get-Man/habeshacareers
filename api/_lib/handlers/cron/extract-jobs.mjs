import { json, requireCron, requireAdmin } from "../../http.js";
import { hasDatabase } from "../../../../lib/db.mjs";
import { runQueuedExtraction } from "../../../../lib/jobs/sync.mjs";
import { backfillEmployerIdentities } from "../../../../lib/jobs/employer-backfill.mjs";

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

    // Keep the employer identity fresh: an organisation's own website, careers
    // page and official logo are resolved for the organisations that still
    // need them, so every vacancy of that organisation shows the same
    // identity, the same logo and a real Apply button.
    let employers = null;
    try {
      employers = await backfillEmployerIdentities({
        limit: parseInt(req.query?.employers || "8", 10) || 8,
        withCareers: req.query?.careers !== "0",
        // The whole cron invocation is capped at 60s; the employer step gets
        // a slice of it and leaves the rest for the next run.
        budgetMs: 20000,
      });
      employers = {
        processed: employers.processed,
        withDomain: employers.withDomain,
        withLogo: employers.withLogo,
        withCareers: employers.withCareers,
        errors: employers.errors,
      };
    } catch (e) {
      employers = { error: String(e?.message || e) };
    }

    return json(res, 200, { ok: true, ...out, employers });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: String(e.message || e) });
  }
}
