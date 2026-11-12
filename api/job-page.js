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

// The icon that introduces each section of the job post.
const SECTION_ICONS = {
  summary: "📝",
  responsibilities: "🎯",
  requirements: "🎓",
  experience: "💼",
  benefits: "🎁",
  location: "📍",
  salary: "💰",
  employmentType: "🗂️",
  howToApply: "📨",
  other: "ℹ️",
};

function chip(label, value) {
  if (value == null || String(value).trim() === "") return "";
  return `<span class="jd-chip"><span class="jd-chip-label">${esc(label)}</span>${esc(value)}</span>`;
}

// A professionally designed monogram, used only when no reliable official
// mark exists. It is never an unrelated organisation's logo.
function monogramDataUri(name) {
  const label = String(name || "Organization").trim();
  const parts = label.split(/\s+/).filter(Boolean);
  const initials = (parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("")) || "O";
  const palette = ["#0F2C59", "#1B9C85", "#1D4ED8", "#7C3AED", "#B45309", "#BE123C", "#15803D", "#0369A1"];
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash << 5) - hash + label.charCodeAt(i);
  const bg = palette[Math.abs(hash) % palette.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="${esc(label)}">` +
    `<rect width="120" height="120" rx="20" fill="${bg}"/>` +
    `<text x="60" y="60" text-anchor="middle" dominant-baseline="central" font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="700" fill="#ffffff">${esc(initials)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * The organisation's official mark, with fallbacks.
 *
 * The official logo comes first, then the organisation's own favicon, then a
 * monogram. If one image cannot be loaded, the next one is tried.
 */
function logoMarkup(job, logoUrl) {
  const candidates = [];
  const add = (value) => {
    if (!value) return;
    const url = String(value);
    if (!/^https?:|^data:|^\//i.test(url)) return;
    if (candidates.includes(url)) return;
    candidates.push(url);
  };
  add(job.logo);
  const domain = String(job.organizationDomain || "").toLowerCase().replace(/^www\./, "");
  if (domain) {
    add(`https://logo.clearbit.com/${encodeURIComponent(domain)}`);
    add(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
    add(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`);
    add(`https://${domain}/favicon.ico`);
    add(`https://${domain}/apple-touch-icon.png`);
  }
  add(monogramDataUri(job.organizationName || job.company));

  const first = candidates[0] || logoUrl;
  const json = JSON.stringify(candidates).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const fallback =
    "var l=this.getAttribute('data-logos')?JSON.parse(this.getAttribute('data-logos')):[];" +
    "var i=(+this.getAttribute('data-logo-idx')||0)+1;" +
    "if(i<l.length){this.setAttribute('data-logo-idx',String(i));this.src=l[i];}else{this.onerror=null;}";
  return `<img class="jd-logo" src="${esc(first)}" data-logos="${json}" data-logo-idx="0" alt="${esc(
    job.organizationName || job.company || "Organization"
  )} logo" loading="lazy" referrerpolicy="no-referrer" onerror="${fallback}">`;
}

function fact(icon, label, value) {
  if (value == null || String(value).trim() === "") return "";
  return `<div class="job-fact">
      <span class="job-fact-icon" aria-hidden="true">${icon}</span>
      <span><span class="job-fact-label">${esc(label)}</span><span class="job-fact-value">${esc(value)}</span></span>
    </div>`;
}

/**
 * Render the structured announcement.
 *
 * Each section becomes a titled block with its own paragraphs and bullet
 * list, so the vacancy reads like a professional job post instead of one
 * scrambled paragraph.
 */
function jobPost(sections) {
  if (!Array.isArray(sections) || !sections.length) return "";
  const blocks = sections
    .map((section) => {
      const title = section.title || "Details";
      const icon = SECTION_ICONS[section.key] || "•";
      const paragraphs = (section.paragraphs || [])
        .map((p) => `<p>${esc(p)}</p>`)
        .join("");
      const items = (section.items || []).length
        ? `<ul>${section.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
        : "";
      return `<section class="job-post-section">
          <h2 class="job-post-title"><span class="job-post-icon" aria-hidden="true">${icon}</span>${esc(title)}</h2>
          <div class="job-post-content">${paragraphs}${items}</div>
        </section>`;
    })
    .join("\n");
  return `<div class="job-post">${blocks}</div>`;
}

/**
 * The Apply Now button.
 *
 * There is always a clearly visible button. The badge underneath says where
 * it actually goes: the employer's own site, the employer's own recruitment
 * portal, an application mailbox, the employer's careers page, or a
 * third-party form published elsewhere.
 */
function applyBlock(job) {
  const apply = job.apply || {};
  const url = apply.url || null;
  const badge = apply.badge
    ? `<span class="jd-apply-origin"><span class="badge ${esc(apply.badgeClass || "badge-neutral")}">${esc(apply.badge)}</span></span>`
    : "";
  const note = apply.note ? `<p class="jd-apply-note">${esc(apply.note)}</p>` : `<p class="jd-apply-note">No reliable application link could be verified for this vacancy. Use the employer’s official contact or application details above.</p>`;
  const verifiedNote = apply.verified && url
    ? `<p class="jd-apply-note">✓ This application link was verified.</p>`
    : "";

  if (!url) {
    // No reliable application link was published/verified for this vacancy.
    // The button leads to the employer's own application details on this page.
    return `
      ${badge}
      <a class="jd-apply-btn" href="#how-to-apply">View application details</a>
      ${note}`;
  }

  const external = /^https?:/i.test(url);
  const attrs = external ? 'target="_blank" rel="noopener noreferrer nofollow"' : "";
  const direct = external ? `<p class="jd-apply-note">Direct link: <a href="${esc(url)}" ${attrs}>${esc(url)}</a></p>` : "";
  return `
    ${badge}
    <a class="jd-apply-btn" href="${esc(url)}" ${attrs}>Apply Now</a>
    ${direct}
    ${note}
    ${verifiedNote}`;
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

// The shared site chrome. The markup and the classes are the same as the
// static pages, so a vacancy looks exactly like the rest of the site.
function siteHeader() {
  return `<header>
    <nav class="navbar">
      <div class="container">
        <a class="logo" href="/">
          <img src="/images/logo.png" alt="Habesha Careers" class="logo-img">
          <h1>Habesha Careers</h1>
        </a>
        <ul class="nav-menu">
          <li><a href="/">Home</a></li>
          <li><a href="/jobs.html">Jobs</a></li>
          <li><a href="/post-job.html">Post Job</a></li>
          <li><a href="/about.html">About</a></li>
          <li><a href="/contact.html">Contact</a></li>
          <li><a href="/login.html" class="login-icon" title="Login" aria-label="Log in">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"/></svg>
          </a></li>
        </ul>
      </div>
    </nav>
  </header>`;
}

function siteFooter() {
  const year = new Date().getFullYear();
  return `<footer>
    <div class="container">
      <div class="footer-content">
        <div class="footer-section">
          <h4>Habesha Careers</h4>
          <p>Empowering careers across Ethiopia and the Horn of Africa</p>
        </div>
        <div class="footer-section">
          <h4>Quick Links</h4>
          <ul>
            <li><a href="/jobs.html">Browse Jobs</a></li>
            <li><a href="/post-job.html">Post a Job</a></li>
            <li><a href="/about.html">About Us</a></li>
            <li><a href="/contact.html">Contact</a></li>
          </ul>
        </div>
        <div class="footer-section">
          <h4>Contact</h4>
          <p>Email: info@habeshacareers.com</p>
          <p>Phone: +251 910 804 879</p>
          <p>Addis Ababa, Ethiopia</p>
        </div>
      </div>
      <div class="footer-bottom">
        <p>© ${year} Habesha Careers. All rights reserved.</p>
      </div>
    </div>
  </footer>`;
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
  <link rel="icon" type="image/png" href="/images/logo.png">
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
  <link rel="stylesheet" href="/css/design-system.css">
  ${head}
</head>
<body>
${siteHeader()}
${body}
${siteFooter()}
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
    body: `<main class="jd-page"><div class="jd-card"><h1 class="jd-title">Job not found</h1><p>This vacancy may have expired or been removed.</p><p style="margin-top:1rem"><a class="jd-apply-btn" href="/jobs.html">Browse current jobs</a></p></div></main>`,
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
    const deadlineText = job.deadline
      ? `${formatDate(job.deadline)}${days != null && days >= 0 ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""}`
      : "Not specified";
    const logo = job.logo || "/images/logo.png";
    const logoUrl = /^https?:\/\//i.test(logo) ? logo : `${base}${logo.startsWith("/") ? "" : "/"}${logo}`;
    const skills = Array.isArray(job.requiredSkills) ? job.requiredSkills.filter(Boolean) : [];
    const employer = job.organizationName || job.company || "Organization not verified";
    const sections = jobPost(job.sections);
    const instructions = job.applicationInstructions
      ? `<section class="job-post-section" id="how-to-apply">
          <h2 class="job-post-title"><span class="job-post-icon" aria-hidden="true">📨</span>How to Apply</h2>
          <div class="job-post-content"><p>${esc(job.applicationInstructions)}</p></div>
        </section>`
      : `<section class="job-post-section" id="how-to-apply">
          <h2 class="job-post-title"><span class="job-post-icon" aria-hidden="true">📨</span>How to Apply</h2>
          <div class="job-post-content">
            <p>This vacancy does not publish an online application link. Contact <strong>${esc(employer)}</strong> using the details in the announcement above, and mention the job title when you apply.</p>
            ${job.organizationWebsite ? `<p>Employer website: <a href="${esc(job.organizationWebsite)}" target="_blank" rel="noopener noreferrer nofollow">${esc(job.organizationDomain || job.organizationWebsite)}</a></p>` : ""}
          </div>
        </section>`;
    const skillsBlock = skills.length
      ? `<section class="job-post-section">
          <h2 class="job-post-title"><span class="job-post-icon" aria-hidden="true">🧰</span>Required skills</h2>
          <div class="job-post-content"><ul>${skills.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
        </section>`
      : "";

    const body = `
<main class="jd-page">
  <a class="jd-back" href="/jobs.html">← Back to jobs</a>
  <article>
    <header class="jd-hero">
      <div class="jd-hero-main">
          ${logoMarkup(job, logoUrl)}
        <div>
          <h1 class="jd-title">${esc(job.title)}</h1>
          <p class="jd-company">${esc(employer)} ${job.organizationVerified ? '<span class="badge badge-verified">✓ Verified employer</span>' : ""}</p>
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
          <h2>Vacancy at a glance</h2>
          <div class="job-facts">
            ${fact("🏢", "Organization", employer)}
            ${fact("📍", "Location", job.location || job.regionCity || "Ethiopia")}
            ${fact("💼", "Employment type", job.type || "Not specified")}
            ${fact("🗓️", "Application deadline", deadlineText)}
            ${fact("👥", "Open positions", job.vacancies || 1)}
            ${fact("📂", "Category", job.category)}
            ${fact("💰", "Salary", job.salary)}
            ${fact("🎓", "Education", job.educationRequirements)}
            ${fact("🧭", "Experience", job.experienceRequirements)}
            ${job.jobReference ? fact("🔖", "Reference", job.jobReference) : ""}
          </div>
        </section>

        ${sections || `<section class="jd-card"><h2>Job description</h2><p>Full description is available from the employer's application page.</p></section>`}
        ${skillsBlock}
        ${instructions}

        <section class="jd-card">
          <h2>Before you apply</h2>
          <p>Habesha Careers lists this opportunity for discovery. Always confirm the role, deadline and application requirements with the hiring organization before sending personal information.</p>
          ${job.lastVerifiedAt ? `<p><small>Listing last checked ${esc(formatDate(job.lastVerifiedAt))}.</small></p>` : ""}
        </section>

        <section class="jd-card jd-final-apply" aria-label="Apply for this position">
          <h2>Ready to apply?</h2>
          <p>Review the complete vacancy details above before applying.</p>
          ${applyBlock(job)}
        </section>
      </div>

      <aside class="jd-sidebar" aria-label="Job details">
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
