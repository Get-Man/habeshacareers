function siteUrl() {
  return String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "https://habeshacareers.vercel.app").replace(/\/+$/, "");
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }
  const base = siteUrl();
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin.html",
    "Disallow: /api/admin/",
    "Disallow: /api/cron/",
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(body);
}
