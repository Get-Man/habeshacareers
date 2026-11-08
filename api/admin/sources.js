import { json, requireAdmin, parseJsonBody } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import { listSources, setSourceEnabled } from "../../lib/jobs/repository.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    if (req.method === "GET") return json(res, 200, { ok: true, sources: await listSources() });
    if (req.method === "POST") {
      const body = await parseJsonBody(req);
      if (body.action === "setEnabled") return json(res, 200, { ok: true, source: (await setSourceEnabled(body.slug, body.enabled))[0] });
    }
    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
