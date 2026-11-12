// Public logo proxy for employer logos.
//
// Employer logos are frequently hosted on the job board's CDN (for example
// geezjobs.com/image/logo/<id>.jpeg). Serving that URL directly would expose
// the discovery source to the public, which the privacy contract forbids.
//
// This endpoint serves the image from our own domain instead. The upstream URL
// is resolved server-side from the employer directory, so the source domain
// never reaches the browser, the HTML, the API or the structured data.
//
// GET /api/employer-logo/:id        -> the verified logo for one employer
// GET /api/employer-logo?id=:id     -> same, query form
// GET /api/employer-logo/:id/meta   -> small JSON descriptor (admin/UI use)

import { json } from "./_lib/http.js";
import { hasDatabase, query } from "../lib/db.mjs";

export const maxDuration = 15;

const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;

function safeUpstream(url) {
  const value = String(url || "");
  if (!/^https?:\/\//i.test(value)) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return parsed.toString();
}

async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "HabeshaCareersBot/1.0 (+https://habeshacareers.vercel.app; employer logo proxy)",
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return null;
    return { buffer, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseId(req) {
  const fromQuery = req.query?.id;
  const raw = fromQuery || (Array.isArray(req.query?.slug) ? req.query.slug[0] : null);
  const id = parseInt(String(raw || "").replace(/\D/g, ""), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "method_not_allowed" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable" });

  const id = parseId(req);
  if (!id) return json(res, 400, { ok: false, error: "invalid_id" });

  try {
    const rows = await query(
      `select id, name, logo_url, logo_public_url, logo_verified, logo_host_kind, logo_source
         from employer_directory
        where id = $1
        limit 1`,
      [id]
    );
    const entry = rows[0];
    if (!entry) return json(res, 404, { ok: false, error: "not_found" });

    const wantsMeta = /\/meta$/.test(String(req.query?.__path || req.url || ""));
    if (wantsMeta) {
      return json(res, 200, {
        ok: true,
        id: entry.id,
        name: entry.name,
        logoVerified: !!entry.logo_verified,
        logoKind: entry.logo_host_kind || null,
        logoSource: entry.logo_source || null,
      });
    }

    const upstream = safeUpstream(entry.logo_url);
    if (!upstream) return json(res, 404, { ok: false, error: "no_logo" });

    // The logo may legitimately be hosted on the job board's CDN (employers
    // upload their own logo there). Proxying it keeps the board's domain out
    // of the browser while still showing the organisation's real logo.
    const image = await fetchImage(upstream);
    if (!image) return json(res, 404, { ok: false, error: "logo_unavailable" });

    res.setHeader("Content-Type", image.type);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(image.buffer.length));
    return res.status(200).end(image.buffer);
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
