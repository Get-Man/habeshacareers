// Admin API dispatcher.
//
// Vercel's Hobby plan caps a deployment at 12 serverless functions, so the
// admin endpoints share a single catch-all function instead of one function
// per endpoint. The handler modules live under api/_lib/handlers/, which is
// not deployed as a function.
//
// Every route keeps its original URL: /api/admin/stats, /api/admin/jobs,
// /api/admin/review, /api/admin/extraction, /api/admin/audit,
// /api/admin/employers, /api/admin/sources, /api/admin/runs,
// /api/admin/submissions, /api/admin/sync and /api/admin/migrate.

import { json } from "../_lib/http.js";
import { getUserFromRequest } from "../../lib/auth.mjs";

import audit from "../_lib/handlers/admin/audit.mjs";
import employers from "../_lib/handlers/admin/employers.mjs";
import extraction from "../_lib/handlers/admin/extraction.mjs";
import jobs from "../_lib/handlers/admin/jobs.mjs";
import migrate from "../_lib/handlers/admin/migrate.mjs";
import review from "../_lib/handlers/admin/review.mjs";
import runs from "../_lib/handlers/admin/runs.mjs";
import sources from "../_lib/handlers/admin/sources.mjs";
import stats from "../_lib/handlers/admin/stats.mjs";
import submissions from "../_lib/handlers/admin/submissions.mjs";
import sync from "../_lib/handlers/admin/sync.mjs";

const ROUTES = {
  audit,
  employers,
  extraction,
  jobs,
  migrate,
  review,
  runs,
  sources,
  stats,
  submissions,
  sync,
};

/**
 * Resolve the requested admin route.
 *
 * The catch-all segment is not exposed the same way on every Vercel runtime,
 * so the route is read from the request path itself and only then from the
 * query. Both forms are accepted:
 *   /api/admin/stats        -> stats
 *   /api/admin/jobs?id=12   -> jobs
 */
function routeName(req) {
  const url = String(req?.url || req?.originalUrl || "");
  const match = /\/api\/admin\/([a-z0-9-]+)/i.exec(url);
  if (match) return match[1].toLowerCase();
  const raw = req?.query?.path;
  const segments = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
  return String(segments[0] || "").toLowerCase();
}

export default async function handler(req, res) {
  try {
    req.authUser = await getUserFromRequest(req);
  } catch {
    req.authUser = null;
  }
  const name = routeName(req);
  const route = ROUTES[name];
  if (!route) {
    return json(res, 404, {
      ok: false,
      error: "not_found",
      available: Object.keys(ROUTES).sort(),
    });
  }
  return route(req, res);
}
