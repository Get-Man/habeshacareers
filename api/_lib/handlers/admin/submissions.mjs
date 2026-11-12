import { json, requireAdmin, parseJsonBody } from "../../http.js";
import { hasDatabase, query } from "../../../../lib/db.mjs";
import { approveSubmission } from "../../../../lib/jobs/repository.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    if (req.method === "GET") {
      const rows = await query(`select * from employer_submissions order by created_at desc limit 200`);
      return json(res, 200, { ok: true, submissions: rows });
    }
    if (req.method === "POST") {
      const body = await parseJsonBody(req);
      if (body.action === 'approve') return json(res, 200, { ok: true, result: await approveSubmission(body.id, body.note || null) });
      if (body.action === 'reject') {
        await query(`update employer_submissions set approval_status='rejected', reviewer_note=$2, updated_at=now() where id=$1`, [body.id, body.note || null]);
        return json(res, 200, { ok: true });
      }
    }
    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", message: String(e.message || e) });
  }
}
