// Cron API dispatcher.
//
// Vercel's Hobby plan caps a deployment at 12 serverless functions, so the
// scheduled jobs share a single catch-all function. The handler modules live
// under api/_lib/handlers/, which is not deployed as a function.
//
// The scheduled URLs are unchanged: /api/cron/sync-jobs and
// /api/cron/extract-jobs.

import { json } from "../_lib/http.js";
import { getUserFromRequest } from "../../lib/auth.mjs";

import extractJobs from "../_lib/handlers/cron/extract-jobs.mjs";
import syncJobs from "../_lib/handlers/cron/sync-jobs.mjs";

const ROUTES = {
  "extract-jobs": extractJobs,
  "sync-jobs": syncJobs,
};

/**
 * Resolve the requested cron route. The catch-all segment is not exposed the
 * same way on every Vercel runtime, so the route is read from the request
 * path first and only then from the query.
 */
function routeName(req) {
  const url = String(req?.url || req?.originalUrl || "");
  const match = /\/api\/cron\/([a-z0-9-]+)/i.exec(url);
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
