import { json, requireAdmin, parseJsonBody } from "../_lib/http.js";
import { hasDatabase, query } from "../../lib/db.mjs";
import { getAdminJob, listReviewQueue } from "../../lib/jobs/repository.mjs";

const ACTIONS = new Set(["approve", "activate", "reject", "archive", "feature", "unfeature"]);

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    if (req.method === "GET") {
      if (req.query?.id) {
        const detail = await getAdminJob(req.query.id);
        if (!detail) return json(res, 404, { ok: false, error: "not_found" });
        return json(res, 200, { ok: true, ...detail });
      }
      if (req.query?.review === "1") {
        return json(res, 200, { ok: true, jobs: await listReviewQueue({ limit: req.query?.limit, status: req.query?.reviewStatus || null }) });
      }
      const status = req.query?.status;
      const vals = [];
      let where = "1=1";
      if (status) {
        vals.push(status);
        where = `l.status = $1`;
      }
      const rows = await query(
        `select l.id, l.title, l.company, l.category, l.location, l.job_type, l.deadline,
                l.origin, l.status, l.job_status, l.featured, l.review_status,
                l.extraction_status, l.apply_url, l.apply_url_type, l.apply_url_verified,
                l.apply_url_confidence, l.quality_score, l.organization_verified,
                l.source_domain, s.name as source_name, l.created_at, l.posted_date
           from job_listings l
           left join job_sources s on s.id = l.primary_source_id
          where ${where}
          order by l.created_at desc
          limit 200`,
        vals
      );
      return json(res, 200, { ok: true, jobs: rows });
    }

    if (req.method === "POST") {
      const body = await parseJsonBody(req);
      const id = parseInt(body.id, 10);
      const action = String(body.action || "");
      if (!Number.isFinite(id) || id <= 0 || !ACTIONS.has(action)) {
        return json(res, 400, { ok: false, error: "validation" });
      }
      if (action === "approve" || action === "activate") {
        await query(
          `update job_listings set status='active', job_status=case when deadline is not null and deadline < current_date then 'expired' else 'open' end,
                  moderation_note=$2, review_status='approved', reviewed_at=now(), updated_at=now()
            where id=$1`,
          [id, body.note || null]
        );
      } else if (action === "reject") {
        await query(
          `update job_listings set status='rejected', job_status='closed', moderation_note=$2,
                  review_status='rejected', reviewed_at=now(), updated_at=now()
            where id=$1`,
          [id, body.note || null]
        );
      } else if (action === "archive") {
        await query(`update job_listings set status='archived', job_status='closed', updated_at=now() where id=$1`, [id]);
      } else if (action === "feature" || action === "unfeature") {
        await query(`update job_listings set featured=$2, updated_at=now() where id=$1`, [id, action === "feature" || !!body.featured]);
      }
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
