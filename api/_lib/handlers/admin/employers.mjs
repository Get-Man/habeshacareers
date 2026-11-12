import { json, requireAdmin, parseJsonBody } from "../../http.js";
import { hasDatabase, query } from "../../../../lib/db.mjs";
import { listEmployerDirectory } from "../../../../lib/jobs/repository.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    if (req.method === "GET") {
      const employers = await listEmployerDirectory({
        limit: req.query?.limit,
        search: req.query?.q || null,
      });
      return json(res, 200, { ok: true, employers });
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
    const body = await parseJsonBody(req);
    const id = parseInt(body.id, 10);
    if (!Number.isFinite(id) || id <= 0) return json(res, 400, { ok: false, error: "validation" });

    // Manual override of an organisation's official logo or website.
    const sets = [];
    const vals = [];
    let i = 1;
    if ("logoUrl" in body) {
      const value = body.logoUrl == null ? null : String(body.logoUrl).trim();
      if (value) {
        if (!/^https?:\/\//i.test(value)) return json(res, 400, { ok: false, error: "invalid_logo_url" });
        sets.push(`logo_url = $${i}`);
        vals.push(value);
        i += 1;
        sets.push(`logo_host_kind = $${i}`);
        vals.push("employer");
        i += 1;
        sets.push(`logo_source = $${i}`);
        vals.push("manual");
        i += 1;
        sets.push(`logo_verified = $${i}`);
        vals.push(true);
        i += 1;
        sets.push(`logo_verified_at = now()`);
        sets.push(`logo_review_note = $${i}`);
        vals.push(body.note ? String(body.note).slice(0, 500) : null);
        i += 1;
        sets.push(`logo_confidence = $${i}`);
        vals.push(100);
        i += 1;
      } else {
        sets.push(`logo_url = null`, `logo_verified = false`, `logo_verified_at = null`, `logo_confidence = 0`);
      }
    }
    if ("websiteUrl" in body) {
      const value = body.websiteUrl == null ? null : String(body.websiteUrl).trim();
      if (value && !/^https?:\/\//i.test(value)) return json(res, 400, { ok: false, error: "invalid_website_url" });
      sets.push(`website_url = $${i}`);
      vals.push(value);
      i += 1;
    }
    if (!sets.length) return json(res, 400, { ok: false, error: "no_fields" });

    vals.push(id);
    const rows = await query(
      `update employer_directory set ${sets.join(", ")}, updated_at = now() where id = $${i} returning *`,
      vals
    );
    if (!rows[0]) return json(res, 404, { ok: false, error: "not_found" });

    // A manual logo replaces the stored URL, so the public URL is recomputed.
    await query(
      `update employer_directory
          set logo_public_url = case
                when logo_verified and logo_url is not null then
                  case when logo_host_kind = 'board_cdn' then '/api/employer-logo?id=' || id else logo_url end
                else null end
        where id = $1`,
      [id]
    );
    const updated = await query(`select * from employer_directory where id = $1`, [id]);
    return json(res, 200, { ok: true, employer: updated[0] || rows[0] });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
