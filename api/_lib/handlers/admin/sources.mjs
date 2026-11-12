import { json, requireAdmin, parseJsonBody } from "../../http.js";
import { hasDatabase, query } from "../../../../lib/db.mjs";
import { listSources, listSourcesWithStats, setSourceEnabled } from "../../../../lib/jobs/repository.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    if (req.method === "GET") {
      const sources = req.query?.basic === "1" ? await listSources() : await listSourcesWithStats();
      return json(res, 200, { ok: true, sources });
    }
    if (req.method === "POST") {
      const body = await parseJsonBody(req);
      if (body.action === "setEnabled") {
        return json(res, 200, { ok: true, source: (await setSourceEnabled(body.slug, body.enabled))[0] });
      }
      if (body.action === "patch" && body.slug) {
        const allowed = ["enabled", "integration_status", "status_note", "listing_url", "fetch_config", "notes", "adapter_key"];
        const sets = [];
        const vals = [];
        let i = 1;
        for (const k of allowed) {
          if (!(k in body)) continue;
          const v = k === "fetch_config" ? JSON.stringify(body[k] || {}) : body[k];
          sets.push(`${k}=$${i++}${k === "fetch_config" ? "::jsonb" : ""}`);
          vals.push(v);
        }
        if (!sets.length) return json(res, 400, { ok: false, error: "no_fields" });
        vals.push(body.slug);
        const rows = await query(`update job_sources set ${sets.join(", ")}, updated_at=now() where slug=$${i} returning *`, vals);
        return json(res, 200, { ok: true, source: rows[0] || null });
      }
      return json(res, 400, { ok: false, error: "unknown_action" });
    }
    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
