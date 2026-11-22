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
    // Only the public view may be used here: expired, unavailable and demo
    // rows are hidden from it, so an expired vacancy can no longer be reached
    // through a remembered /api/apply link.
    const rows = await query(
      `select l.id, j.apply_url, j.apply_url_type, j.apply_url_verified, l.status,
              j.canonical_job_url, j.original_job_url, j.original_url
         from public_job_listings l
         join job_listings j on j.id = l.id
        where l.id = $1
        limit 1`,
      [id]
    );
    const job = rows[0];
    if (!job) return json(res, 404, { ok: false, error: "not_found" });

    const candidates = [
      job.apply_url,
      job.canonical_job_url,
      job.original_job_url,
      job.original_url,
    ].filter(Boolean);

    let target = null;
    for (const candidate of candidates) {
      const raw = String(candidate || "").trim();
      if (!raw) continue;
      if (/^mailto:/i.test(raw)) {
        target = raw;
        break;
      }
      const dest = classifyDestination(raw, { pageUrl: "" });
      // Accept valid navigable destinations, including source pages, as a
      // fallback so users can reach the original vacancy/application details.
      if (dest.valid || /^https?:\/\//i.test(raw)) {
        target = raw;
        break;
      }
    }

    if (!target) return json(res, 404, { ok: false, error: "no_apply_link" });

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.statusCode = 302;
    res.setHeader("Location", target);
    return res.end();
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
