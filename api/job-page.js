// Server-rendered public job page for clean, crawlable URLs (/job/:id/:slug).
// It uses only the public allowlisted repository view and never exposes a
// discovery source's name, domain or URL.
import { hasDatabase } from "../lib/db.mjs";
import { getPublicJobById, getRelatedJobs } from "../lib/jobs/repository.mjs";

function siteUrl() {
  return String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "https://habeshacareers.vercel.app").replace(/\/+$/, "");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function formatDate(value) {
  if (!value) return "Not specified";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysLeft(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${String(deadline).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target - today) / 86400000);
}

function paragraphs(text) {
  const raw = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!raw) return "";
  const lines = raw.split("\n");
  const blocks = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    blocks.push(`<p>${esc(para.join(" ").replace(/\s+/g, " ").trim())}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(`<ul>${list.map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`);
    list = null;
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    if (/^([•●▪◦*–—-]|\(?\d{1,3}[.)]\)?)\s+/.test(t)) {
      flushPara();
      if (!list) list = [];
      list.push(t.replace(/^([•●▪◦*–—-]|\(?\d{1,3}[.)]\)?)\s+/, "").trim());
      continue;
    }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return blocks.join("\n");
}

function chip(label, value) {
  if (value == null || String(value).trim() === "") return "";
  return `<span class="jd-chip"><span class="jd-chip-label">${esc(label)}</span>${esc(value)}</span>`;
}

function overviewCard(icon, label, value) {
  if (value == null || String(value).trim() === "") return "";
  return `<div class="jd-overview-card"><span class="jd-overview-icon" aria-hidden="true">${icon}</span><div><span class="jd-overview-label">${esc(label)}</span><strong>${esc(value)}</strong></div></div>`;
}

function applyBlock(job) {
  const email = job.applicationEmail || job.contactEmail;
  const url = job.applyUrl;
  const verified = !!job.applyUrlVerified;
  if (url) {
    return `
      <a class="jd-apply-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">Apply for this job</a>
      <p class="jd-apply-note">${verified ? "✓ Application link verified" : "Application link not independently verified — confirm details with the employer."}</p>`;
  }
  if (email) {
    const subject = encodeURIComponent(`Application for ${job.title || "position"}`);
    return `<a class="jd-apply-btn" href="mailto:${esc(email)}?subject=${subject}">Apply by email</a><p class="jd-apply-note">Send your application directly to the employer.</p>`;
  }
  return `<div class="jd-apply-unavailable">Application link is under review. Check the application instructions below.</div>`;
}

function relatedCard(job) {
  const company = job.company || "Organization not verified";
  return `<a class="jd-related-card" href="${esc(job.publicPath || `/job/${job.id}`)}">
    <span class="jd-related-title">${esc(job.title)}</span>
    <span class="jd-related-company">${esc(company)}</span>
    <span class="jd-related-meta">${esc(job.location || job.regionCity || "Ethiopia")} · ${esc(job.type || "Full-time")}</span>
  </a>`;
}

function jsonLd(job, base) {
  if (!job.jsonLdEligible) return "";
  const data = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: String(job.description || "").slice(0, 12000),
    datePosted: job.postedDate || undefined,
    validThrough: job.deadline || undefined,
    employmentType: job.type || undefined,
    hiringOrganization: { "@type": "Organization", name: job.company },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.regionCity || job.location || "Addis Ababa",
        addressCountry: "ET",
      },
    },
    identifier: { "@type": "PropertyValue", name: "Habesha Careers", value: String(job.id) },
    url: `${base}${job.publicPath}`,
    directApply: !!job.applyUrl,
    industry: job.category || undefined,
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function layout({ title, description, canonical, image, body, head = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Habesha Careers">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">
  <link rel="stylesheet" href="/css/style.css">
  ${head}
  <style>
    :root{--navy:#0F2C59;--teal:#1B9C85;--bg:#F8FAFC;--line:#E2E8F0;--ink:#0f172a;--muted:#64748b}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif}
    .jd-header{background:var(--navy);color:#fff;padding:.85rem 0}
    .jd-header .wrap{max-width:1120px;margin:0 auto;padding:0 1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
    .jd-brand{display:flex;align-items:center;gap:.6rem;color:#fff;text-decoration:none;font-weight:700}
    .jd-brand img{width:34px;height:34px;border-radius:8px;background:#fff;object-fit:contain}
    .jd-nav{display:flex;gap:1rem;flex-wrap:wrap}
    .jd-nav a{color:#dbeafe;text-decoration:none;font-size:.92rem}
    .jd-nav a:hover{color:#fff}
    .jd-page{max-width:1120px;margin:0 auto;padding:1.25rem 1rem 3rem}
    .jd-back{display:inline-flex;align-items:center;gap:.35rem;color:var(--navy);text-decoration:none;font-weight:600;font-size:.92rem;margin:.25rem 0 1rem}
    .jd-hero{background:#fff;border:1px solid var(--line);border-radius:18px;padding:1.4rem;box-shadow:0 10px 30px rgba(15,44,89,.06);display:flex;gap:1.25rem;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
    .jd-hero-main{display:flex;gap:1rem;align-items:flex-start;min-width:260px;flex:1}
    .jd-logo{width:72px;height:72px;border-radius:16px;object-fit:contain;border:1px solid var(--line);background:#fff;flex:0 0 auto}
    .jd-title{font-size:clamp(1.35rem,3vw,2rem);line-height:1.2;margin:0 0 .35rem;color:var(--navy)}
    .jd-company{font-size:1.02rem;font-weight:600;color:#334155;margin:0 0 .35rem;display:flex;align-items:center;gap:.45rem;flex-wrap:wrap}
    .jd-verified{display:inline-flex;align-items:center;gap:.25rem;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:999px;padding:.1rem .5rem;font-size:.72rem;font-weight:700}
    .jd-chips{display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.65rem}
    .jd-chip{display:inline-flex;align-items:center;gap:.35rem;background:#f1f5f9;border:1px solid var(--line);border-radius:999px;padding:.28rem .65rem;font-size:.8rem;color:#334155}
    .jd-chip-label{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
    .jd-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:1.25rem;margin-top:1.25rem;align-items:start}
    .jd-main{display:grid;gap:1rem}
    .jd-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:1.25rem;box-shadow:0 6px 20px rgba(15,44,89,.04)}
    .jd-card h2{font-size:1.08rem;margin:0 0 .85rem;color:var(--navy)}
    .jd-overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.7rem}
    .jd-overview-card{display:flex;gap:.6rem;align-items:center;border:1px solid var(--line);border-radius:12px;padding:.7rem;background:#fbfdff}
    .jd-overview-icon{width:34px;height:34px;border-radius:10px;background:#ecfdf5;color:var(--teal);display:grid;place-items:center;font-size:1rem;flex:0 0 auto}
    .jd-overview-label{display:block;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
    .jd-overview-card strong{font-size:.9rem;color:#1e293b}
    .jd-body p{margin:0 0 .8rem;line-height:1.65;color:#334155}
    .jd-body ul{margin:0 0 .9rem;padding-left:1.2rem;color:#334155;line-height:1.65}
    .jd-body li{margin-bottom:.35rem}
    .jd-sidebar{position:sticky;top:1rem;display:grid;gap:1rem}
    .jd-apply-btn{display:block;text-align:center;background:var(--teal);color:#fff;text-decoration:none;font-weight:700;padding:.85rem 1rem;border-radius:12px;transition:.15s ease}
    .jd-apply-btn:hover{filter:brightness(.94)}
    .jd-apply-note{font-size:.78rem;color:var(--muted);margin:.6rem 0 0;text-align:center}
    .jd-apply-unavailable{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:12px;padding:.8rem;font-size:.86rem}
    .jd-facts{list-style:none;margin:0;padding:0;display:grid;gap:.7rem}
    .jd-facts li{display:flex;justify-content:space-between;gap:.75rem;font-size:.88rem;border-bottom:1px dashed var(--line);padding-bottom:.55rem}
    .jd-facts li:last-child{border-bottom:0;padding-bottom:0}
    .jd-facts span{color:var(--muted)}
    .jd-facts strong{text-align:right;color:#1e293b}
    .jd-deadline{font-weight:700;color:var(--navy)}
    .jd-deadline.urgent{color:#b91c1c}
    .jd-related{margin-top:1.5rem}
    .jd-related h2{font-size:1.15rem;color:var(--navy);margin:0 0 .8rem}
    .jd-related-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.8rem}
    .jd-related-card{display:grid;gap:.25rem;background:#fff;border:1px solid var(--line);border-radius:12px;padding:.85rem;text-decoration:none;color:inherit;transition:.15s ease}
    .jd-related-card:hover{border-color:#99f6e4;transform:translateY(-1px)}
    .jd-related-title{font-weight:700;color:var(--navy);font-size:.92rem}
    .jd-related-company{font-size:.82rem;color:#475569}
    .jd-related-meta{font-size:.76rem;color:var(--muted)}
    .jd-footer{background:var(--navy);color:#cbd5e1;text-align:center;padding:1.25rem;font-size:.85rem}
    .jd-mobile-apply{display:none}
    @media(max-width:860px){
      .jd-grid{grid-template-columns:1fr}
      .jd-sidebar{position:static;order:-1}
      .jd-page{padding-bottom:5.5rem}
      .jd-mobile-apply{display:block;position:fixed;left:0;right:0;bottom:0;padding:.7rem 1rem;background:#fff;border-top:1px solid var(--line);box-shadow:0 -6px 20px rgba(15,44,89,.08);z-index:30}
      .jd-mobile-apply .jd-apply-btn{padding:.8rem}
      .jd-hero{padding:1.1rem}
      .jd-logo{width:58px;height:58px}
    }
  </style>
</head>
<body>
<header class="jd-header"><div class="wrap">
  <a class="jd-brand" href="/"><img src="/images/logo.png" alt="Habesha Careers logo">Habesha Careers</a>
  <nav class="jd-nav" aria-label="Primary"><a href="/jobs.html">Browse jobs</a><a href="/about.html">About</a><a href="/contact.html">Contact</a></nav>
</div></header>
${body}
<footer class="jd-footer">© ${new Date().getFullYear()} Habesha Careers · Opportunities across Ethiopia and the Horn of Africa</footer>
</body>
</html>`;
}

function notFoundPage(base) {
  return layout({
    title: "Job not found | Habesha Careers",
    description: "This vacancy is no longer available. Browse current openings on Habesha Careers.",
    canonical: `${base}/jobs.html`,
    image: `${base}/images/logo.png`,
    head: '<meta name="robots" content="noindex,follow">',
    body: `<main class="jd-page"><div class="jd-card"><h1 class="jd-title">Job not found</h1><p>This vacancy may have expired or been removed.</p><p><a class="jd-apply-btn" href="/jobs.html">Browse current jobs</a></p></div></main>`,
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }
  const base = siteUrl();
  if (!hasDatabase()) {
    res.status(503);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(notFoundPage(base));
    return;
  }

  try {
    const job = await getPublicJobById(req.query?.id);
    if (!job) {
      res.status(404);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.end(notFoundPage(base));
      return;
    }
    const related = await getRelatedJobs(job, 4).catch(() => []);
    const canonical = `${base}${job.publicPath}`;
    const description = truncate(
      job.description || `Apply for ${job.title} at ${job.company} on Habesha Careers.`,
      160
    );
    const days = daysLeft(job.deadline);
    const deadlineText = job.deadline ? `${formatDate(job.deadline)}${days != null && days >= 0 ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""}` : "Not specified";
    const logo = job.logo || "/images/logo.png";
    const logoUrl = /^https?:\/\//i.test(logo) ? logo : `${base}${logo.startsWith("/") ? "" : "/"}${logo}`;
    const requirements = String(job.requirements || "").trim();
    const skills = Array.isArray(job.requiredSkills) ? job.requiredSkills.filter(Boolean) : [];
    const verifiedBadge = job.organizationVerified ? '<span class="jd-verified">✓ Verified employer</span>' : "";

    const body = `
<main class="jd-page">
  <a class="jd-back" href="/jobs.html">← Back to jobs</a>
  <article>
    <header class="jd-hero">
      <div class="jd-hero-main">
        <img class="jd-logo" src="${esc(logoUrl)}" alt="${esc(job.company || "Organization")} logo" loading="lazy" referrerpolicy="no-referrer">
        <div>
          <h1 class="jd-title">${esc(job.title)}</h1>
          <p class="jd-company">${esc(job.company || "Organization not verified")} ${verifiedBadge}</p>
          <div class="jd-chips">
            ${chip("Location", job.location || job.regionCity)}
            ${chip("Type", job.type)}
            ${chip("Category", job.category)}
            ${chip("Positions", job.vacancies)}
          </div>
        </div>
      </div>
    </header>

    <div class="jd-grid">
      <div class="jd-main">
        <section class="jd-card">
          <h2>Overview</h2>
          <div class="jd-overview">
            ${overviewCard("📍", "Location", job.location || job.regionCity || "Ethiopia")}
            ${overviewCard("💼", "Employment type", job.type)}
            ${overviewCard("🗓️", "Application deadline", deadlineText)}
            ${overviewCard("💰", "Salary", job.salary)}
            ${overviewCard("🎓", "Education", job.educationRequirements)}
            ${overviewCard("🧭", "Experience", job.experienceRequirements)}
          </div>
        </section>

        <section class="jd-card">
          <h2>Job description</h2>
          <div class="jd-body">${paragraphs(job.description) || "<p>Full description is available from the employer's application page.</p>"}</div>
        </section>

        <section class="jd-card">
          <h2>Requirements &amp; qualifications</h2>
          <div class="jd-body">${requirements ? paragraphs(requirements) : "<p>Not specified in the announcement.</p>"}</div>
          ${skills.length ? `<h2 style="margin-top:1.1rem">Required skills</h2><div class="jd-body"><ul>${skills.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>` : ""}
        </section>

        ${job.applicationInstructions ? `<section class="jd-card"><h2>How to apply</h2><div class="jd-body">${paragraphs(job.applicationInstructions)}</div></section>` : ""}

        <section class="jd-card">
          <h2>Before you apply</h2>
          <div class="jd-body">
            <p>Habesha Careers lists this opportunity for discovery. Always confirm the role, deadline and application requirements with the hiring organization before sending personal information.</p>
            ${job.lastVerifiedAt ? `<p><small>Listing last checked ${esc(formatDate(job.lastVerifiedAt))}.</small></p>` : ""}
          </div>
        </section>
      </div>

      <aside class="jd-sidebar" aria-label="Application">
        <section class="jd-card">
          ${applyBlock(job)}
        </section>
        <section class="jd-card">
          <h2>Job details</h2>
          <ul class="jd-facts">
            <li><span>Deadline</span><strong class="jd-deadline ${days != null && days <= 7 ? "urgent" : ""}">${esc(job.deadline ? formatDate(job.deadline) : "Not specified")}</strong></li>
            <li><span>Posted</span><strong>${esc(job.postedDate ? formatDate(job.postedDate) : "Not specified")}</strong></li>
            <li><span>Job type</span><strong>${esc(job.type || "Not specified")}</strong></li>
            <li><span>Location</span><strong>${esc(job.location || job.regionCity || "Ethiopia")}</strong></li>
            <li><span>Vacancies</span><strong>${esc(job.vacancies || 1)}</strong></li>
            ${job.jobReference ? `<li><span>Reference</span><strong>${esc(job.jobReference)}</strong></li>` : ""}
          </ul>
        </section>
      </aside>
    </div>

    ${related.length ? `<section class="jd-related"><h2>Similar jobs</h2><div class="jd-related-grid">${related.map(relatedCard).join("")}</div></section>` : ""}
  </article>
</main>
<div class="jd-mobile-apply">${applyBlock(job)}</div>
`;

    res.status(200);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=300, stale-while-revalidate=600");
    res.end(
      layout({
        title: `${job.title} at ${job.company || "Habesha Careers"} | Habesha Careers`,
        description,
        canonical,
        image: logoUrl,
        head: jsonLd(job, base),
        body,
      })
    );
  } catch (e) {
    console.error("job_page_failed", e);
    res.status(500);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(notFoundPage(base));
  }
}
