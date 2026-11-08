import { json, requireAdmin, parseJsonBody } from "../_lib/http.js";
import { hasDatabase, query } from "../../lib/db.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    if (req.method === "GET") {
      const status = req.query?.status;
      const vals = []; let where = '1=1';
      if (status) { vals.push(status); where = `l.status = $1`; }
      const rows = await query(`select l.id,l.title,l.company,l.category,l.location,l.job_type,l.deadline,l.origin,l.status,l.featured,l.original_url,s.name as source_name,l.created_at,l.posted_date
        from job_listings l left join job_sources s on s.id=l.primary_source_id where ${where} order by l.created_at desc limit 200`, vals);
      return json(res, 200, { ok: true, jobs: rows });
    }
    if (req.method === "POST") {
      const body = await parseJsonBody(req);
      const { id, action } = body;
      if (!id || !action) return json(res, 400, { ok: false, error: "validation" });
      if (action === 'approve' || action === 'activate') await query(`update job_listings set status='active', moderation_note=$2, updated_at=now() where id=$1`, [id, body.note||null]);
      else if (action === 'reject') await query(`update job_listings set status='rejected', moderation_note=$2, updated_at=now() where id=$1`, [id, body.note||null]);
      else if (action === 'archive') await query(`update job_listings set status='archived', updated_at=now() where id=$1`, [id]);
      else if (action === 'feature') await query(`update job_listings set featured=$2, updated_at=now() where id=$1`, [id, !!body.featured]);
      else return json(res, 400, { ok: false, error: "unknown_action" });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
