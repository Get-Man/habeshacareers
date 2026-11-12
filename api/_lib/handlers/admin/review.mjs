import { json, requireAdmin, parseJsonBody } from "../../http.js";
import { hasDatabase } from "../../../../lib/db.mjs";
import {
  approveJob,
  getJobCandidates,
  listReviewQueue,
  rejectJob,
  retryJobExtraction,
  setManualApplyUrl,
} from "../../../../lib/jobs/repository.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    if (req.method === "GET") {
      if (req.query?.id && req.query?.candidates === "1") {
        return json(res, 200, { ok: true, candidates: await getJobCandidates(req.query.id) });
      }
      return json(res, 200, {
        ok: true,
        jobs: await listReviewQueue({ limit: req.query?.limit, status: req.query?.reviewStatus || null }),
      });
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    const body = await parseJsonBody(req);
    const id = parseInt(body.id, 10);
    if (!Number.isFinite(id) || id <= 0) return json(res, 400, { ok: false, error: "validation" });
    const actor = String(body.actor || "admin").slice(0, 120);
    const note = body.note == null ? null : String(body.note).slice(0, 2000);
    const action = String(body.action || "");

    if (action === "apply") {
      return json(res, 200, { ok: true, result: await setManualApplyUrl(id, body.url, { actor, note }) });
    }
    if (action === "approve") {
      return json(res, 200, { ok: true, result: await approveJob(id, { actor, note }) });
    }
    if (action === "reject") {
      return json(res, 200, { ok: true, result: await rejectJob(id, { actor, note }) });
    }
    if (action === "retry") {
      return json(res, 200, { ok: true, result: await retryJobExtraction(id, { actor }) });
    }
    return json(res, 400, { ok: false, error: "unknown_action" });
  } catch (e) {
    const message = String(e?.message || e);
    if (/^invalid_apply_url|^not_found|missing_source_or_url/.test(message)) {
      return json(res, 400, { ok: false, error: message });
    }
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
