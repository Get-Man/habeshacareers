// Public apply redirect.
//
// Some employers apply through a form hosted on the job board itself. The
// real destination must not be published directly, because that would reveal
// the discovery source to the public. This endpoint resolves the stored,
// verified application URL for one vacancy and redirects to it.
//
// GET /api/apply?id=123   -> 302 to the verified application destination

import { json } from "./_lib/http.js";
import { hasDatabase, query } from "../lib/db.mjs";
import { isKnownSourceDomain } from "../lib/jobs/extract/hosts.mjs";
import { classifyDestination } from "../lib/jobs/extract/apply-link.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });

  const id = parseInt(String(req.query?.id || ""), 10);
  if (!Number.isFinite(id) || id <= 0) return json(res, 400, { ok: false, error: "invalid_id" });

  try {
    const rows = await query(
      `select id, apply_url, apply_url_type, apply_url_verified, status
         from job_listings
        where id = $1
        limit 1`,
      [id]
    );
    const job = rows[0];
    if (!job || !job.apply_url) return json(res, 404, { ok: false, error: "no_apply_link" });

    // The destination must still be a valid application target.
    const dest = classifyDestination(job.apply_url, { pageUrl: "" });
    if (!dest.valid) return json(res, 404, { ok: false, error: "invalid_apply_link" });

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.statusCode = 302;
    res.setHeader("Location", job.apply_url);
    return res.end();
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
