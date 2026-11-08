import { json } from "../_lib/http.js";
import { hasDatabase, query } from "../../lib/db.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });
  try {
    const rows = await query(`select c.id,c.slug,c.name, count(lc.listing_id)::int as active_jobs
      from job_categories c left join job_listing_categories lc on lc.category_id=c.id
      left join job_listings l on l.id=lc.listing_id and l.status='active' and (l.deadline is null or l.deadline>=current_date)
      group by c.id order by c.name`);
    return json(res, 200, { ok: true, categories: rows });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
