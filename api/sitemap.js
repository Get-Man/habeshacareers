import { hasDatabase, query } from "../lib/db.mjs";
import { jobPublicPath } from "../lib/jobs/extract/urls.mjs";

function siteUrl() {
  return String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "https://habeshacareers.vercel.app").replace(/\/+$/, "");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }
  const base = siteUrl();
  let rows = [];
  if (hasDatabase()) {
    try {
      rows = await query(
        `select id, title, updated_at, posted_date
           from public_job_listings
          where status = 'active'
            and (deadline is null or deadline >= current_date)
          order by posted_date desc nulls last, id desc
          limit 2000`
      );
    } catch (e) {
      console.error("sitemap_query_failed", e.message);
    }
  }

  const staticPages = ["/", "/jobs.html", "/about.html", "/contact.html", "/post-job.html"];
  const urls = staticPages.map((p) => `  <url><loc>${esc(base + p)}</loc></url>`);
  for (const row of rows) {
    const loc = `${base}${jobPublicPath(row.id, row.title)}`;
    const lastmod = row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 10) : null;
    urls.push(`  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  res.status(200);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
  res.end(xml);
}
