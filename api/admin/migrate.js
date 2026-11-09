import { json, requireAdmin, parseJsonBody } from "../_lib/http.js";
import { hasDatabase, query } from "../../lib/db.mjs";
import fs from "node:fs";
import path from "node:path";

const ALLOWED = new Set(["006_ethiojobs_connector.sql", "007_geezjobs_connector.sql", "008_backfill_job_batches.sql", "009_fetch_entire_catalogs.sql", "010_full_catalog_speed.sql", "011_more_catalog_sources.sql", "012_logo_hygiene.sql", "013_reclassify_categories.sql"]);

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    const body = await parseJsonBody(req);
    const name = String(body?.name || "").trim();
    if (!ALLOWED.has(name)) return json(res, 400, { ok: false, error: "migration_not_allowed" });
    const file = path.resolve(process.cwd(), "migrations", name);
    if (!fs.existsSync(file)) return json(res, 404, { ok: false, error: "migration_not_found" });
    const sql = fs.readFileSync(file, "utf8");
    const result = await query(sql);
    return json(res, 200, { ok: true, name, rowCount: result?.rowCount ?? null });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error", detail: String(e?.message || e).slice(0, 300) });
  }
}
