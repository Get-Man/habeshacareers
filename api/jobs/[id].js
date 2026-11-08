import { json } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import { getPublicJobById } from "../../lib/jobs/repository.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    const job = await getPublicJobById(req.query.id);
    if (!job) return json(res, 404, { ok: false, error: "not_found" });
    return json(res, 200, { ok: true, job });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
