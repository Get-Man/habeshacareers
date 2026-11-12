import { json, requireAdmin, parseJsonBody } from "../../http.js";
import { hasDatabase } from "../../../../lib/db.mjs";
import { listActiveLocks, queueStats, requeueFailed } from "../../../../lib/jobs/extract/engine.mjs";
import { runQueuedExtraction } from "../../../../lib/jobs/sync.mjs";

export const maxDuration = 60;

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    if (req.method === "GET") {
      const [queue, locks] = await Promise.all([queueStats(req.query?.sourceId || null), listActiveLocks()]);
      return json(res, 200, { ok: true, queue, locks });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    const body = await parseJsonBody(req);
    if (body.action === "requeue") {
      const count = await requeueFailed({
        sourceId: body.sourceId || null,
        ids: Array.isArray(body.ids) ? body.ids : null,
        limit: body.limit,
      });
      return json(res, 200, { ok: true, requeued: count });
    }
    if (body.action === "run") {
      return json(res, 200, { ok: true, result: await runQueuedExtraction("manual", { extractionBatch: body.limit, concurrency: body.concurrency }) });
    }
    return json(res, 400, { ok: false, error: "unknown_action" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) });
  }
}
