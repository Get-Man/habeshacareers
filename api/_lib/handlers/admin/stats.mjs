import { json, requireAdmin } from "../../http.js";
import { hasDatabase } from "../../../../lib/db.mjs";
import { getStats } from "../../../../lib/jobs/repository.mjs";

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    return json(res, 200, { ok: true, stats: await getStats() });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
