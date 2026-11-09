import { json } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import { listPublicJobs, listCatalogStats } from "../../lib/jobs/repository.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable", message: "DATABASE_URL not configured" });
  try {
    if (req.query?.meta === "stats") {
      return json(res, 200, { ok: true, stats: await listCatalogStats() });
    }
    const data = await listPublicJobs(req.query || {});
    return json(res, 200, { ok: true, ...data });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
