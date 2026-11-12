import { query, withClient } from "../db.mjs";
import {
  cleanText,
  dedupHash,
  excerpt,
  guessCategory,
  isExpired,
  legacyKey,
  logoFromUrl,
  looksLikeVacancyPoster,
  mapCategoryToFrontend,
  norm,
  orgLogoUrl,
  toDate,
} from "./utils.mjs";
import { classifyText, loadCategories } from "./classify.mjs";
import { isJsonLdEligible } from "./extract/validate.mjs";
import { APPLY_URL_TYPES, classifyDestination } from "./extract/apply-link.mjs";
import { baseDomain, hostOf, isKnownSourceDomain } from "./extract/hosts.mjs";
import { jobPublicPath } from "./extract/urls.mjs";
import { scrubSourceTitle } from "./extract/job.mjs";
import { employerKey, isFaviconServiceUrl, isPublishableLogo, isSourceHostedLogo } from "./extract/employer-logo.mjs";
import { formatJobSections } from "./format.mjs";
import { classifyApplyDestination } from "./apply-destination.mjs";

// ---------------------------------------------------------------------------
// Public mapping
//
// Public rows must never expose a discovery source's name, slug, domain, logo
// or URL. The database view `public_job_listings` is the first line of defence;
// this mapper is the second. It deliberately whitelists every field.
// ---------------------------------------------------------------------------

/**
 * The domain a favicon-service URL actually represents. `google.com/s2/favicons?
 * domain=geezjobs.com` renders the JOB BOARD's icon, not the employer's, so
 * the encoded domain — not the service host — is what must be checked.
 */
function faviconServiceTarget(url) {
  const value = String(url || "");
  let m = /[?&]domain=([^&]+)/i.exec(value);
  if (m) return decodeURIComponent(m[1]).toLowerCase().replace(/^www\./, "");
  // "…/ip3/<domain>.ico" — the domain may contain dots, so capture lazily.
  m = /duckduckgo\.com\/ip3\/(.+?)\.ico(?:$|[?#])/i.exec(value);
  if (m) return m[1].toLowerCase();
  return null;
}

/**
 * True when a host belongs to a discovery source.
 *
 * Both the full host and its registrable domain are checked: a favicon for
 * "careers.un.org" must be recognised even though its registrable domain is
 * "un.org".
 */
function isDiscoveryHost(host) {
  if (!host) return false;
  const clean = String(host).toLowerCase().replace(/^www\./, "");
  if (isKnownSourceDomain(clean)) return true;
  const base = baseDomain(clean);
  return !!base && isKnownSourceDomain(base);
}

function publicLogo(row) {
  // The verified employer logo (from the employer directory) wins. A legacy
  // per-listing logo is only used when it is not a discovery-source asset.
  const directory = row?.employer_logo_url || null;
  const candidate = directory || row?.organization_logo_url || row?.logo || null;
  if (!candidate) return null;
  const host = hostOf(candidate);
  if (isDiscoveryHost(host)) return null;
  if (looksLikeVacancyPoster(candidate)) return null;
  if (isFaviconServiceUrl(candidate)) {
    // A favicon of the publishing site is not the employer's logo.
    const target = faviconServiceTarget(candidate);
    if (!target || isDiscoveryHost(target)) return null;
  }
  return candidate;
}

export function toFrontendJob(row, { includeSections = true } = {}) {
  const deadline = row.deadline ? new Date(row.deadline).toISOString().slice(0, 10) : null;
  const posted = row.posted_date
    ? new Date(row.posted_date).toISOString().slice(0, 10)
    : row.created_at
      ? new Date(row.created_at).toISOString().slice(0, 10)
      : null;
  // A board may append its own name to the headline it publishes
  // ("Secretary via GeezJobs"). That attribution must never reach the
  // public API, the HTML or the vacancy URL.
  const title = scrubSourceTitle(row.title);
  const req = cleanText(row.requirements, 50000);
  const isReqMissing =
    !req ||
    /^see (the )?(original|source|official).{0,80}(for|to).{0,40}(full )?(requirements|details|qualifications)/i.test(
      req
    );
  const applicationEmail = row.application_email || row.contact_email || null;
  const applyUrl = row.apply_url || null;
  const applyHost = applyUrl ? hostOf(applyUrl) : null;
  const applyOnSourceHost = !!(applyHost && isKnownSourceDomain(applyHost));
  // An application destination hosted on the discovery source is redirected
  // through our own endpoint so the source domain never reaches the public
  // API, the HTML or the structured data.
  const publicApplyUrl = applyOnSourceHost ? `/api/apply?id=${Number(row.id)}` : applyUrl;

  // The organisation's own identity, taken from the employer directory. Every
  // vacancy of an organisation shows the same employer, logo and careers page
  // — whichever job board published it.
  const employerName = row.employer_name || row.company || null;
  const employerDomain = row.employer_website_domain || null;
  const employerWebsite = row.employer_website_url || null;
  const employerCareersUrl = row.employer_careers_url || null;

  // Where "Apply Now" should go, and how that destination is described.
  const apply = classifyApplyDestination({
    applyUrl: publicApplyUrl,
    applicationEmail,
    employerDomain,
    employerWebsite,
    careersUrl: employerCareersUrl,
    applyVerified: !!row.apply_url_verified,
  });

  const description = row.description || row.description_excerpt || "";

  const job = {
    id: Number(row.id),
    // A board may append its own name to the headline it publishes
    // ("Secretary via GeezJobs"). That attribution must never reach the
    // public API, the HTML or the vacancy URL.
    title: title,
    company: row.company,
    logo: publicLogo(row),
    organizationVerified: !!row.organization_verified,
    // The employer's own website and official logo, from the central
    // employer directory. Every vacancy of an organisation shows the same
    // identity and logo, whichever job board published it.
    organizationName: employerName,
    organizationWebsite: employerWebsite,
    organizationDomain: employerDomain,
    organizationCareersUrl: employerCareersUrl,
    organizationIdentitySource: row.employer_identity_source || null,
    organizationLogoVerified: !!row.employer_logo_verified,
    organizationLogoSource: row.organization_logo_source || null,
    category: row.category || "Business and Management",
    location: row.location || row.region_city || null,
    regionCity: row.region_city || row.location || null,
    type: row.job_type || "Full-time / Permanent",
    vacancies: row.vacancies || 1,
    postedDate: posted,
    deadline,
    description,
    descriptionHtml: row.description_html || "",
    requirements: isReqMissing ? null : req,
    requirementsHtml: isReqMissing ? "" : row.requirements_html || "",
    requirementsMissing: isReqMissing,
    contactEmail: applicationEmail,
    applicationEmail,
    applyUrl: publicApplyUrl,
    applyUrlType: row.apply_url_type || null,
    applyUrlVerified: !!row.apply_url_verified,
    applyConfidence: Number(row.apply_url_confidence || 0),
    applicationInstructions: row.application_instructions || null,
    status: row.status,
    jobStatus: row.job_status || null,
    featured: !!row.featured,
    educationRequirements: row.education_requirements || null,
    experienceRequirements: row.experience_requirements || null,
    requiredSkills: Array.isArray(row.required_skills) ? row.required_skills : [],
    salary: row.salary || null,
    jobReference: row.job_reference || null,
    lastVerifiedAt: row.last_verified_at || null,
    updatedAt: row.updated_at || null,
    publicPath: jobPublicPath(row.id, title),
    // The application destination, already classified. The button label is
    // always "Apply Now"; the badge says where it actually goes.
    apply,
  };

  // The structured form of the announcement: headings, paragraphs and bullet
  // lists, so the vacancy reads like a professional job post instead of one
  // scrambled paragraph.
  job.sections = includeSections ? formatJobSections(description, { requirements: job.requirements }) : [];

  // Structured data is emitted only for genuinely open, complete vacancies with
  // a safe application destination. This boolean is safe to expose.
  job.jsonLdEligible = isJsonLdEligible(job, { now: new Date() });
  return job;
}

// ---------------------------------------------------------------------------
// Public catalogue queries (view-backed)
// ---------------------------------------------------------------------------

export async function listPublicJobs(params = {}) {
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit || "20", 10) || 20));
  const offset = (page - 1) * limit;
  // A demo seed row must never be listed, whatever its status is.
  const where = [
    `l.status = 'active'`,
    `(l.deadline is null or l.deadline >= current_date)`,
    `(l.origin is null or l.origin <> 'demo')`,
  ];
  const vals = [];
  const p = (v) => {
    vals.push(v);
    return `$${vals.length}`;
  };

  if (params.q) {
    const q = String(params.q).trim();
    where.push(
      `(to_tsvector('simple', coalesce(l.title,'')||' '||coalesce(l.company,'')||' '||coalesce(l.description,'')||' '||coalesce(l.requirements,'')||' '||coalesce(l.location,'')) @@ plainto_tsquery('simple', ${p(
        q
      )}) or lower(l.title) like ${p(`%${q.toLowerCase()}%`)} or lower(l.company) like ${p(`%${q.toLowerCase()}%`)})`
    );
  }
  if (params.category) {
    where.push(
      `(l.category = ${p(params.category)} or exists (select 1 from job_listing_categories jlc join job_categories jc on jc.id=jlc.category_id where jlc.listing_id=l.id and jc.name=${p(
        params.category
      )}))`
    );
  }
  if (params.location) where.push(`lower(coalesce(l.region_city,l.location,'')) = lower(${p(params.location)})`);
  if (params.type) {
    const TYPE_ALIASES = {
      "Full-time / Permanent": ["Full Time", "Full-Time", "Full-time", "Fulltime", "Full Time / Permanent", "Full-time / Permanent"],
      "Part-time": ["Part Time", "Part-Time", "Part-time"],
      "Contract / Fixed-term": ["Contract", "Contractor"],
      "Temporary / Casual": ["Temporary", "Casual"],
      "Freelance / Independent Contractor": ["Freelance", "Freelancer"],
      "Internship / Apprenticeship": ["Internship", "Apprenticeship"],
    };
    const label = String(params.type);
    const variants = (TYPE_ALIASES[label] || [label]).map((v) => p(v));
    if (label === "Full-time / Permanent") where.push(`(l.job_type is null or lower(l.job_type) in (${variants.join(",")}))`);
    else where.push(`lower(l.job_type) in (${variants.join(",")})`);
  }
  if (params.featured === "true" || params.featured === true) where.push(`l.featured = true`);
  if (params.organization) where.push(`lower(l.company) like ${p(`%${String(params.organization).toLowerCase()}%`)}`);
  if (params.postedFrom) where.push(`l.posted_date >= ${p(params.postedFrom)}::date`);
  if (params.deadlineTo) where.push(`l.deadline <= ${p(params.deadlineTo)}::date`);

  const sort =
    params.sort === "deadline"
      ? `l.deadline asc nulls last, l.posted_date desc nulls last`
      : `l.posted_date desc nulls last, l.created_at desc`;
  // The employer directory is joined in for the organisation's own careers
  // page and the source of its identity. The public view stays the privacy
  // boundary for the vacancy itself.
  const base = `from public_job_listings l
    left join employer_directory ed on ed.id = l.employer_id
   where ${where.join(" and ")}`;
  const countRows = await query(`select count(*)::int as total ${base}`, vals);
  const rows = await query(
    `select l.*,
            ed.careers_url as employer_careers_url,
            ed.identity_source as employer_identity_source ${base} order by l.featured desc, ${sort} limit ${p(limit)} offset ${p(offset)}`,
    vals
  );

  const brief = params.brief === "1" || params.brief === "true";
  const jobs = brief
    ? rows.map((r) => {
        // The list view only needs a short excerpt, so the structured
        // sections of the announcement are not built for it.
        const j = toFrontendJob(r, { includeSections: false });
        if (typeof j.description === "string" && j.description.length > 400) {
          j.description = j.description.slice(0, 400) + "…";
        }
        j.descriptionHtml = "";
        j.requirements = null;
        j.requirementsHtml = "";
        j.applicationInstructions = j.applicationInstructions
          ? String(j.applicationInstructions).slice(0, 240)
          : null;
        return j;
      })
    : rows.map((r) => toFrontendJob(r, { includeSections: true }));
  return { total: countRows[0]?.total || 0, page, limit, jobs };
}

export async function getPublicJobById(id) {
  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const rows = await query(
    `select l.*,
            ed.careers_url as employer_careers_url,
            ed.identity_source as employer_identity_source
       from public_job_listings l
       left join employer_directory ed on ed.id = l.employer_id
      where l.id = $1`,
    [numericId]
  );
  return rows[0] ? toFrontendJob(rows[0]) : null;
}

export async function getRelatedJobs(job, limit = 4) {
  if (!job) return [];
  const max = Math.min(8, Math.max(1, parseInt(limit, 10) || 4));
  const rows = await query(
    `select * from public_job_listings
      where id <> $1
        and status = 'active'
        and (deadline is null or deadline >= current_date)
        and (
          ($2::text is not null and category = $2)
          or ($3::text is not null and lower(company) = lower($3))
        )
      order by featured desc, deadline asc nulls last, posted_date desc nulls last
      limit $4`,
    [Number(job.id), job.category || null, job.company || null, max]
  );
  return rows.map((r) => toFrontendJob(r, { includeSections: false }));
}

// Honest catalog-wide counters (same active/future-deadline basis as listPublicJobs).
export async function listCatalogStats() {
  const [totals] = await query(`
    select
      count(*)::int as total,
      count(distinct lower(coalesce(btrim(company), '')))::int as orgs,
      count(distinct lower(coalesce(nullif(btrim(category), ''), 'other')))::int as categories,
      count(distinct lower(coalesce(btrim(company), ''))) filter (where organization_verified)::int as verified_orgs
    from public_job_listings
  `);
  const byCategory = await query(`
    select coalesce(nullif(btrim(category), ''), 'Other') as category, count(*)::int as count
    from public_job_listings
    group by coalesce(nullif(btrim(category), ''), 'Other')
    order by count desc, category asc
  `);
  return {
    total: totals?.total || 0,
    orgs: totals?.orgs || 0,
    categories: totals?.categories || 0,
    verifiedOrgs: totals?.verified_orgs || 0,
    byCategory,
  };
}

// ---------------------------------------------------------------------------
// Employer directory
//
// One row per organisation. Every vacancy of that organisation points at the
// same row, so the identity and the OFFICIAL logo are consistent no matter
// which job board the vacancy was discovered on.
// ---------------------------------------------------------------------------

/**
 * Look up an organisation by its canonical key. Returns null when unknown.
 */
export async function getEmployerDirectoryEntry(key) {
  const nameKey = String(key || "").trim().toLowerCase();
  if (!nameKey) return null;
  const rows = await query(
    `select * from employer_directory where name_key = $1 limit 1`,
    [nameKey]
  );
  return rows[0] || null;
}

/**
 * Create or refresh an organisation's directory entry.
 *
 * A verified logo is never downgraded by a weaker candidate, and a verified
 * logo is never replaced by a source-hosted asset.
 *
 * `logo_url` keeps the canonical upstream URL (admin-only). `logo_public_url`
 * is what the public site may render: either the upstream URL when it is the
 * employer's own asset, or our own proxy path when the employer uploaded the
 * logo to a job board's CDN (publishing that URL directly would leak the
 * discovery source).
 */
export async function upsertEmployerDirectory(entry = {}) {
  const name = cleanText(entry.name, 200);
  const nameKey = String(entry.nameKey || employerKey(name) || "").trim().toLowerCase();
  if (!name || !nameKey) return null;

  const websiteUrl = cleanText(entry.websiteUrl, 1000);
  const websiteDomain = entry.websiteDomain ? String(entry.websiteDomain).toLowerCase() : null;
  const logoUrl = cleanText(entry.logoUrl, 1000);
  const logoKind = entry.logoKind || null;
  const logoSource = entry.logoSource || null;
  const logoConfidence = Number.isFinite(Number(entry.logoConfidence)) ? Number(entry.logoConfidence) : 0;
  const logoVerified = !!entry.logoVerified;
  const alias = cleanText(entry.alias, 200);

  // A logo hosted on a discovery source is never published directly.
  const logoHost = logoUrl ? hostOf(logoUrl) : null;
  const onSourceHost = isSourceHostedLogo(logoUrl, { source: entry.source || null });
  const publishable = logoUrl ? isPublishableLogo(logoUrl, { source: entry.source || null }) : false;

  const rows = await query(
    `insert into employer_directory
       (name, name_key, aliases, website_url, website_domain, logo_url, logo_host_kind,
        logo_source, logo_confidence, logo_verified, logo_verified_at, last_seen_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,case when $10 then now() else null end,now(),now())
     on conflict (name_key) do update set
       name = excluded.name,
       aliases = case
         when $11::text is not null and not (excluded.aliases @> $11::text[])
           then (select array_agg(distinct x) from unnest(excluded.aliases || $11::text[]) as x)
         else employer_directory.aliases end,
       website_url = coalesce(excluded.website_url, employer_directory.website_url),
       website_domain = coalesce(excluded.website_domain, employer_directory.website_domain),
       logo_url = case
         when excluded.logo_verified and employer_directory.logo_verified = false then excluded.logo_url
         when excluded.logo_verified and excluded.logo_confidence >= employer_directory.logo_confidence then excluded.logo_url
         else employer_directory.logo_url end,
       logo_host_kind = case
         when excluded.logo_verified and employer_directory.logo_verified = false then excluded.logo_host_kind
         when excluded.logo_verified and excluded.logo_confidence >= employer_directory.logo_confidence then excluded.logo_host_kind
         else employer_directory.logo_host_kind end,
       logo_source = case
         when excluded.logo_verified and employer_directory.logo_verified = false then excluded.logo_source
         when excluded.logo_verified and excluded.logo_confidence >= employer_directory.logo_confidence then excluded.logo_source
         else employer_directory.logo_source end,
       logo_confidence = greatest(excluded.logo_confidence, employer_directory.logo_confidence),
       logo_verified = employer_directory.logo_verified or excluded.logo_verified,
       logo_verified_at = case
         when excluded.logo_verified and employer_directory.logo_verified = false then now()
         else employer_directory.logo_verified_at end,
       last_seen_at = now(),
       updated_at = now()
     returning *`,
    [
      name,
      nameKey,
      alias ? [alias] : [],
      websiteUrl,
      websiteDomain,
      // The upstream logo URL is kept even when it lives on the board's CDN:
      // it is the organisation's own uploaded logo, and it is served through
      // our proxy so the board's domain is never revealed.
      logoVerified ? logoUrl : null,
      logoKind,
      logoSource,
      logoConfidence,
      logoVerified,
      alias,
    ]
  );
  const saved = rows[0];
  if (!saved) return null;

  // Compute the public URL. Logos hosted on a job board's CDN are served
  // through our own proxy so the discovery source never reaches the browser.
  let publicUrl = null;
  if (saved.logo_verified && saved.logo_url) {
    if (onSourceHost) publicUrl = `/api/employer-logo?id=${saved.id}`;
    else if (publishable) publicUrl = saved.logo_url;
  }
  if (publicUrl !== saved.logo_public_url) {
    await query(
      `update employer_directory set logo_public_url = $2, updated_at = now() where id = $1`,
      [saved.id, publicUrl]
    );
    saved.logo_public_url = publicUrl;
  }
  return saved;
}

/**
 * Point every listing of this organisation at the directory entry, so the
 * official logo is reused across all of its vacancies.
 */
export async function linkListingsToEmployer(listingIds = [], employerId = null) {
  const ids = [...new Set((Array.isArray(listingIds) ? listingIds : [listingIds]).map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length || !employerId) return 0;
  const rows = await query(
    `update job_listings
        set employer_id = $2::bigint,
            updated_at = now()
      where id = any($1::bigint[])
      returning id`,
    [ids, employerId]
  );
  await query(
    `update employer_directory
        set listing_count = (select count(*)::int from job_listings where employer_id = $1),
            updated_at = now()
      where id = $1`,
    [employerId]
  );
  return rows.length;
}

/**
 * Employer directory listing for the admin dashboard.
 */
export async function listEmployerDirectory({ limit = 100, search = null } = {}) {
  const max = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  const vals = [max];
  let filter = "";
  if (search) {
    vals.push(`%${String(search).toLowerCase()}%`);
    filter = `and lower(e.name) like $${vals.length}`;
  }
  return query(
    `select e.*,
            (select count(*)::int from job_listings l where l.employer_id = e.id) as listing_count,
            (select count(*)::int from job_listings l where l.employer_id = e.id and l.status='active') as active_count
       from employer_directory e
      where 1=1 ${filter}
      order by listing_count desc, e.name asc
      limit $1`,
    vals
  );
}

// ---------------------------------------------------------------------------
// Stage B persistence: save one validated extraction result
// ---------------------------------------------------------------------------

function compactRawPayload(job) {
  return {
    extractionMethod: job.extractionMethod || null,
    extractionStatus: job.extractionStatus || null,
    warnings: Array.isArray(job.warnings) ? job.warnings.slice(0, 40) : [],
    errors: Array.isArray(job.errors) ? job.errors.slice(0, 20) : [],
    organizationConfidence: job.organizationConfidence || 0,
    organizationEvidence: job.organizationEvidence || null,
    organizationWebsite: job.organizationWebsite || null,
    applyReason: job.applyReason || null,
    applyAmbiguous: !!job.applyAmbiguous,
    qualityScore: job.qualityScore ?? null,
  };
}

async function insertApplyCandidates(client, listingId, candidates = []) {
  for (const c of candidates.slice(0, 25)) {
    const url = String(c?.url || "").trim();
    if (!url || url.length > 2000) continue;
    const status = c.status || (c.valid === false ? "rejected" : "candidate");
    await client.query(
      `insert into job_application_candidates
         (listing_id, url, url_type, confidence, source, label, context, verified, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (listing_id, url) do update
         set url_type = excluded.url_type,
             confidence = greatest(job_application_candidates.confidence, excluded.confidence),
             verified = job_application_candidates.verified or excluded.verified,
             status = case when excluded.status = 'selected' then 'selected' else job_application_candidates.status end`,
      [
        listingId,
        url,
        c.urlType || null,
        Number.isFinite(Number(c.confidence)) ? Math.max(0, Math.min(100, Number(c.confidence))) : 0,
        c.source || null,
        cleanText(c.label, 300),
        cleanText(c.context, 500),
        !!c.verified,
        status,
      ]
    );
  }
}

/**
 * Resolve the organisation once, up front, so every listing of that
 * organisation shares one identity and one official logo.
 */
async function resolveEmployerForJob(source, job) {
  const company = cleanText(job?.company, 200);
  if (!company || company === "Organization not verified") {
    return { id: null, nameKey: null, logoUrl: null, verified: false };
  }
  const nameKey = employerKey(company);
  if (!nameKey) return { id: null, nameKey: null, logoUrl: null, verified: false };

  const entry = await upsertEmployerDirectory({
    name: company,
    nameKey,
    alias: cleanText(job?.organizationEvidence, 120) || null,
    websiteUrl: job?.organizationWebsite || job?.employerWebsite || null,
    websiteDomain: hostOf(job?.organizationWebsite || job?.employerWebsite || "") || null,
    logoUrl: job?.organizationLogo || null,
    logoKind: job?.organizationLogoKind || null,
    logoSource: job?.organizationLogoSource || null,
    logoConfidence: job?.organizationLogoConfidence ?? 0,
    logoVerified: !!job?.organizationLogoVerified,
    source,
  }).catch(() => null);

  return {
    id: entry?.id || null,
    nameKey,
    logoUrl: entry?.logo_public_url || entry?.logo_url || null,
    verified: !!entry?.logo_verified,
  };
}

async function linkSource(client, listingId, source, job, { isPrimary = false } = {}) {
  if (!source?.id) return;
  const url = job.canonicalJobUrl || job.originalJobUrl;
  if (!url) return;
  await client.query(
    `insert into job_listing_sources (listing_id, source_id, external_id, source_url, last_verified_at, is_primary)
     values ($1,$2,$3,$4,now(),$5)
     on conflict (source_id, source_url) do update
       set last_verified_at = now(),
           external_id = coalesce(excluded.external_id, job_listing_sources.external_id),
           is_primary = job_listing_sources.is_primary or excluded.is_primary`,
    [listingId, source.id, job.jobReference || null, url, isPrimary]
  );
}

/**
 * Persist one Stage B extraction result.
 *
 * Rules:
 *  - never invent values; prefer the richer of the stored/new value
 *  - new needs-review jobs start as `pending` (not publicly visible)
 *  - existing active jobs are never demoted except expired/unavailable
 *  - application destination is always the verified employer destination
 */
export async function upsertExtractedJob(source, job, { queueItem = null } = {}) {
  if (!source?.id) return { action: "skipped", reason: "missing_source" };
  const title = cleanText(job?.title, 300);
  const canonicalJobUrl = job?.canonicalJobUrl || job?.originalJobUrl || queueItem?.discovered_url || null;
  if (!title) return { action: "skipped", reason: "missing_title" };
  if (!canonicalJobUrl) return { action: "skipped", reason: "missing_url" };

  // Resolve the organisation once, up front, so every listing of that
  // organisation shares one identity and one official logo.
  const employer = await resolveEmployerForJob(source, job);

  const categories = await loadCategories().catch(() => []);
  const company = cleanText(job?.company, 200) || "Organization not verified";
  const description = cleanText(job?.description, 50000);
  const descriptionHtml = cleanText(job?.descriptionHtml, 200000);
  const requirements = cleanText(job?.requirements, 30000);
  const requirementsHtml = cleanText(job?.requirementsHtml, 120000);
  const text = [title, company, description, requirements, job?.location, job?.rawCategory].filter(Boolean).join(" ");
  const matchedCats = classifyText(text, categories);
  const frontendCategory =
    job?.categoryFrontend ||
    guessCategory({
      title,
      company,
      description: description || "",
      requirements: requirements || "",
      location: job?.location || "",
      rawCategory: job?.rawCategory || "",
      matchedCategories: matchedCats,
    });
  const deadline = toDate(job?.deadline);
  const posted = toDate(job?.postedDate) || new Date().toISOString().slice(0, 10);
  const needsReview = !!job?.needsReview || job?.extractionStatus === "needs_manual_review";
  const extractionStatus = job?.extractionStatus || (needsReview ? "needs_manual_review" : "verified");
  const deadlinePassed = deadline ? isExpired(deadline) : false;
  const newStatus = deadlinePassed ? "expired" : needsReview ? "pending" : "active";
  const reviewStatus = needsReview ? "pending" : "unreviewed";
  const jobStatus =
    job?.jobStatus || (deadlinePassed ? "expired" : needsReview ? "needs_verification" : "open");

  const logo = job?.organizationLogo || (job?.organizationVerified ? orgLogoUrl(company) : null);
  const hash = dedupHash({
    title,
    company,
    location: job?.location,
    deadline,
    original_url: canonicalJobUrl,
  });
  const contentHash = job?.dedupContentHash || hash;
  const rawPayload = JSON.stringify(compactRawPayload(job));
  const candidates = Array.isArray(job?.applyCandidates) ? job.applyCandidates : [];
  const urls = [...new Set([canonicalJobUrl, job?.originalJobUrl, job?.applyUrlFinalUrl, queueItem?.discovered_url].filter(Boolean))];
  const employerId = employer?.id || null;
  const employerNameKey = employer?.nameKey || null;

  return withClient(async (client) => {
    await client.query("begin");
    try {
      // 1) Match an existing row by any URL we have seen for this vacancy.
      let existing = null;
      if (urls.length) {
        const r = await client.query(
          `select l.id, l.status, l.apply_url, l.apply_url_verified, l.organization_verified
             from job_listings l
             left join job_listing_sources jls on jls.listing_id = l.id
            where jls.source_url = any($1::text[])
               or l.canonical_job_url = any($1::text[])
               or l.original_job_url = any($1::text[])
            limit 1`,
          [urls]
        );
        existing = r.rows[0] || null;
      }

      // 2) Match by content hash (same vacancy, different URL).
      if (!existing && contentHash) {
        const r = await client.query(
          `select id, status, apply_url, apply_url_verified, organization_verified
             from job_listings
            where dedup_content_hash = $1
              and status in ('active','pending','expired')
            order by (case when status='active' then 0 when status='pending' then 1 else 2 end), id desc
            limit 1`,
          [contentHash]
        );
        existing = r.rows[0] || null;
      }

      // 3) Conservative title + company + deadline match, only for a real employer.
      if (!existing && company !== "Organization not verified" && norm(title).length >= 12) {
        const r = await client.query(
          `select id, status, apply_url, apply_url_verified, organization_verified
             from job_listings
            where normalized_title = $1
              and lower(regexp_replace(coalesce(company,''), '\\s+', ' ', 'g')) = lower(regexp_replace($2, '\\s+', ' ', 'g'))
              and (($3::date is null and deadline is null) or deadline = $3::date)
            order by (case when status='active' then 0 when status='pending' then 1 else 2 end), id desc
            limit 1`,
          [norm(title), company, deadline]
        );
        existing = r.rows[0] || null;
      }

      if (existing) {
        const id = existing.id;
        const sameApplyUrl = existing.apply_url && job?.applyUrl && existing.apply_url === job.applyUrl;
        await client.query(
          `update job_listings set
             title = coalesce(nullif($2,''), title),
             company = case
               when $3 is not null and btrim($3) <> '' and ($3 <> 'Organization not verified' or company is null or btrim(company)='' or company='Organization not verified') then $3
               else company
             end,
             logo = coalesce(nullif($4,''), logo),
             category = coalesce(nullif($5,''), category),
             location = coalesce(nullif($6,''), location),
             region_city = coalesce(nullif($7,''), region_city),
             job_type = coalesce(nullif($8,''), job_type),
             vacancies = coalesce($9, vacancies),
             education_requirements = coalesce($10, education_requirements),
             experience_requirements = coalesce($11, experience_requirements),
             required_skills = case when coalesce(array_length($12::text[],1),0) > 0 then $12::text[] else required_skills end,
             salary = coalesce($13, salary),
             posted_date = coalesce($14::date, posted_date),
             deadline = coalesce($15::date, deadline),
             description = case when $16 is not null and length($16) >= length(coalesce(description,'')) then $16 else description end,
             description_html = case when $17 is not null and length($17) >= length(coalesce(description_html,'')) then $17 else description_html end,
             description_excerpt = coalesce($18, description_excerpt),
             requirements = case when $19 is not null and length($19) >= length(coalesce(requirements,'')) then $19 else requirements end,
             requirements_html = case when $20 is not null and length($20) >= length(coalesce(requirements_html,'')) then $20 else requirements_html end,
             application_instructions = coalesce($21, application_instructions),
             application_email = coalesce($22, application_email),
             contact_email = coalesce($23, contact_email),
             apply_url = coalesce($24, apply_url),
             apply_url_type = coalesce($25, apply_url_type),
             apply_url_confidence = case
               when $24 is not null and apply_url is distinct from $24 then coalesce($26,0)
               else greatest(coalesce($26,0), coalesce(apply_url_confidence,0))
             end,
             apply_url_source = coalesce($27, apply_url_source),
             apply_url_verified = case
               when $24 is not null and apply_url is distinct from $24 then coalesce($28,false)
               when $24 is not null then (apply_url_verified or coalesce($28,false))
               else apply_url_verified
             end,
             apply_url_checked_at = case when $24 is not null then $29::timestamptz else apply_url_checked_at end,
             apply_candidates = case when $30::jsonb <> '[]'::jsonb then $30::jsonb else apply_candidates end,
             job_reference = coalesce($31, job_reference),
             job_status = case
               when $15::date is not null and $15::date < current_date then 'expired'
               when $34 = 'failed' then 'unavailable'
               when status in ('rejected','archived') then coalesce(job_status, 'closed')
               else coalesce($32, job_status)
             end,
             extraction_method = coalesce($33, extraction_method),
             extraction_status = coalesce($34, extraction_status),
             extraction_timestamp = coalesce($35::timestamptz, extraction_timestamp),
             quality_score = greatest(coalesce($36,0), coalesce(quality_score,0)),
             dedup_content_hash = coalesce($37, dedup_content_hash),
             source_domain = coalesce($38, source_domain),
             source_website_name = coalesce($39, source_website_name),
             organization_verified = organization_verified or coalesce($40,false),
             organization_logo_url = coalesce($41, organization_logo_url),
             listing_page_url = coalesce($42, listing_page_url),
             original_job_url = coalesce($43, original_job_url),
             canonical_job_url = coalesce($44, canonical_job_url),
             original_url = coalesce($44, original_url),
             primary_source_id = coalesce(primary_source_id, $47),
             status = case
               when $15::date is not null and $15::date < current_date then 'expired'
               when $34 = 'failed' then case when status = 'active' then 'expired' else status end
               when status = 'active' then 'active'
               when status = 'pending' and $34 in ('verified','partial') and $45 = 'unreviewed' then 'active'
               when status = 'expired' and ($15::date is null or $15::date >= current_date) and $34 in ('verified','partial') then 'active'
               else status
             end,
             review_status = case
               when $45 = 'pending' and review_status = 'unreviewed' then 'pending'
               when $45 = 'unreviewed' and review_status = 'pending' and $34 in ('verified','partial') then 'unreviewed'
               else review_status
             end,
             last_verified_at = now(),
             updated_at = now(),
             raw_payload = coalesce($46::jsonb, raw_payload),
             employer_id = coalesce($48::bigint, employer_id),
             employer_name_key = coalesce($49, employer_name_key),
             organization_logo_source = coalesce($50, organization_logo_source),
             organization_logo_verified = organization_logo_verified or coalesce($51,false)
           where id = $1`,
          [
            id,
            title,
            company,
            logo,
            frontendCategory,
            job?.location || null,
            job?.regionCity || job?.location || null,
            job?.jobType || null,
            job?.vacancies || null,
            job?.education || null,
            job?.experience || null,
            Array.isArray(job?.skills) ? job.skills : [],
            job?.salary || null,
            posted,
            deadline,
            description,
            descriptionHtml,
            job?.descriptionExcerpt || excerpt(description),
            requirements,
            requirementsHtml,
            job?.applicationInstructions || null,
            job?.applicationEmail || null,
            job?.contactEmail || job?.applicationEmail || null,
            job?.applyUrl || null,
            job?.applyUrlType || null,
            Number(job?.applyConfidence || 0),
            job?.applyUrlSource || (job?.applyUrl ? "extraction" : null),
            !!job?.applyUrlVerified,
            job?.applyUrlCheckedAt || null,
            JSON.stringify(candidates),
            job?.jobReference || null,
            jobStatus,
            job?.extractionMethod || null,
            extractionStatus,
            job?.extractionTimestamp || null,
            Number(job?.qualityScore || 0),
            contentHash,
            job?.sourceDomain || null,
            job?.sourceWebsiteName || null,
            !!job?.organizationVerified,
            job?.organizationLogo || null,
            job?.listingPageUrl || null,
            job?.originalJobUrl || null,
            job?.canonicalJobUrl || null,
            reviewStatus,
            rawPayload,
            source.id,
            employerId,
            employerNameKey,
            job?.organizationLogoSource || null,
            !!job?.organizationLogoVerified,
          ]
        );
        await linkSource(client, id, source, job, { isPrimary: !existing.apply_url });
        await insertApplyCandidates(client, id, candidates);
        for (const c of matchedCats) {
          await client.query(
            `insert into job_listing_categories (listing_id, category_id) values ($1,$2) on conflict do nothing`,
            [id, c.id]
          );
        }
        await client.query("commit");
        return { action: "updated", id, needsReview, sameApplyUrl };
      }

      // New row
      const ins = await client.query(
        `insert into job_listings
           (title, company, logo, category, location, region_city, job_type, vacancies,
            education_requirements, experience_requirements, required_skills, salary,
            posted_date, deadline, description, description_html, description_excerpt,
            requirements, requirements_html, application_instructions, application_email,
            contact_email, apply_url, apply_url_type, apply_url_confidence, apply_url_source,
            apply_url_verified, apply_url_checked_at, apply_candidates, job_reference,
            job_status, extraction_method, extraction_status, extraction_timestamp,
            quality_score, dedup_content_hash, source_domain, source_website_name,
            organization_verified, organization_logo_url, listing_page_url, original_job_url,
            canonical_job_url, original_url, primary_source_id, origin, status,
            normalized_title, dedup_hash, collected_at, last_verified_at, raw_payload, review_status,
            employer_id, employer_name_key, organization_logo_source, organization_logo_verified)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,$15,$16,$17,$18,$19,$20,$21,$22,
                 $23,$24,$25,$26,$27,$28::timestamptz,$29::jsonb,$30,$31,$32,$33,$34::timestamptz,$35,$36,$37,$38,
                 $39,$40,$41,$42,$43,$44,$45,'aggregated',$46,$47,$48,now(),now(),$49::jsonb,$50,
                 $51::bigint,$52,$53,$54)
         returning id`,
        [
          title,
          company,
          logo,
          frontendCategory,
          job?.location || null,
          job?.regionCity || job?.location || null,
          job?.jobType || null,
          job?.vacancies || null,
          job?.education || null,
          job?.experience || null,
          Array.isArray(job?.skills) ? job.skills : [],
          job?.salary || null,
          posted,
          deadline,
          description,
          descriptionHtml,
          job?.descriptionExcerpt || excerpt(description),
          requirements,
          requirementsHtml,
          job?.applicationInstructions || null,
          job?.applicationEmail || null,
          job?.contactEmail || job?.applicationEmail || null,
          job?.applyUrl || null,
          job?.applyUrlType || null,
          Number(job?.applyConfidence || 0),
          job?.applyUrlSource || (job?.applyUrl ? "extraction" : null),
          !!job?.applyUrlVerified,
          job?.applyUrlCheckedAt || null,
          JSON.stringify(candidates),
          job?.jobReference || null,
          jobStatus,
          job?.extractionMethod || null,
          extractionStatus,
          job?.extractionTimestamp || null,
          Number(job?.qualityScore || 0),
          contentHash,
          job?.sourceDomain || null,
          job?.sourceWebsiteName || null,
          !!job?.organizationVerified,
          job?.organizationLogo || null,
          job?.listingPageUrl || null,
          job?.originalJobUrl || null,
          job?.canonicalJobUrl || null,
          job?.canonicalJobUrl || job?.originalJobUrl || null,
          source.id,
          newStatus,
          norm(title),
          hash,
          rawPayload,
          reviewStatus,
          employerId,
          employerNameKey,
          job?.organizationLogoSource || null,
          !!job?.organizationLogoVerified,
        ]
      );
      const id = ins.rows[0].id;
      await linkSource(client, id, source, job, { isPrimary: true });
      await insertApplyCandidates(client, id, candidates);
      for (const c of matchedCats) {
        await client.query(
          `insert into job_listing_categories (listing_id, category_id) values ($1,$2) on conflict do nothing`,
          [id, c.id]
        );
      }
      await client.query("commit");
      return { action: "new", id, needsReview };
    } catch (error) {
      await client.query("rollback").catch(() => null);
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// Legacy connector persistence (fallback when no Stage A adapter exists)
// ---------------------------------------------------------------------------

export async function upsertAggregatedJob(source, raw) {
  const categories = await loadCategories();
  const url = raw.original_url || raw.url || raw.link;
  // A board may append its own name to the headline it publishes
  // ("Secretary via GeezJobs"). It is removed before the title is stored.
  const title = scrubSourceTitle(String(raw.title || "").trim());
  const company = String(raw.company || raw.organization || "Unknown organization").trim();
  if (!title || !url) return { action: "skipped", reason: "missing_title_or_url" };

  const key = legacyKey(source.slug, raw.external_id, url);
  const descRaw = cleanText(raw.description, 50000) || null;
  const reqRaw = cleanText(raw.requirements, 30000) || null;
  const appRaw = cleanText(raw.application_instructions, 10000) || null;
  const text = [title, company, descRaw, reqRaw, raw.location, raw.category].filter(Boolean).join(" ");
  const matchedCats = classifyText(text, categories);
  const frontendCategory =
    raw.category_frontend ||
    guessCategory({
      title,
      company,
      description: descRaw || "",
      requirements: reqRaw || "",
      location: raw.location || "",
      rawCategory: raw.category || "",
      matchedCategories: matchedCats,
    });
  const deadline = toDate(raw.deadline);
  const posted = toDate(raw.posted_date || raw.postedDate) || new Date().toISOString().slice(0, 10);
  const status = isExpired(deadline) ? "expired" : "active";
  const hash = dedupHash({ title, company, location: raw.location, deadline, original_url: url });
  const rawLogo = raw.logo && !looksLikeVacancyPoster(raw.logo) ? raw.logo : null;
  const logo = rawLogo || orgLogoUrl(company) || logoFromUrl(url, { allowAggregator: false }) || null;
  const location = raw.location || raw.region_city || null;
  const regionCity = raw.region_city || raw.location || null;
  const jobType = raw.job_type || raw.type || "Full-time / Permanent";
  const vacancies = raw.vacancies ? parseInt(raw.vacancies, 10) || null : null;
  const education = cleanText(raw.education, 10000);
  const experience = cleanText(raw.experience, 10000);
  const skills = Array.isArray(raw.skills) ? raw.skills.map((s) => cleanText(s, 200)).filter(Boolean) : [];
  const salary = cleanText(raw.salary, 500);
  const rawPayload = JSON.stringify(raw);

  // A legacy connector URL is often the source listing itself. Only store it as
  // an application destination when it is a real employer/ATS destination.
  const contactEmail = raw.contact_email || null;
  let applyUrl = null;
  let applyType = null;
  let applyConfidence = 0;
  if (contactEmail) {
    applyUrl = `mailto:${String(contactEmail).trim()}`;
    applyType = APPLY_URL_TYPES.EMAIL;
    applyConfidence = 60;
  } else {
    const dest = classifyDestination(url, { source });
    if (dest.valid && dest.type !== APPLY_URL_TYPES.SOURCE && dest.type !== APPLY_URL_TYPES.LISTING) {
      applyUrl = url;
      applyType = dest.type;
      applyConfidence = 65;
    }
  }
  const sourceDomain = hostOf(source.base_url || source.listing_url || "");

  return withClient(async (client) => {
    const postPublicFields = async (id) => {
      await client.query(
        `update job_listings set
           original_job_url = coalesce(original_job_url, $2),
           canonical_job_url = coalesce(canonical_job_url, $2),
           listing_page_url = coalesce(listing_page_url, $2),
           source_domain = coalesce(source_domain, $3),
           source_website_name = coalesce(source_website_name, $4),
           extraction_status = coalesce(extraction_status, 'partial'),
           extraction_method = coalesce(extraction_method, 'legacy-connector'),
           extraction_timestamp = coalesce(extraction_timestamp, now()),
           job_status = coalesce(job_status, case when status = 'expired' then 'expired' else 'open' end),
           application_email = coalesce(application_email, contact_email),
           apply_url = coalesce(apply_url, $5),
           apply_url_type = coalesce(apply_url_type, $6),
           apply_url_confidence = coalesce(apply_url_confidence, $7),
           apply_url_verified = coalesce(apply_url_verified, false),
           review_status = coalesce(review_status, 'unreviewed'),
           updated_at = now()
         where id = $1`,
        [id, url, sourceDomain, source.name || null, applyUrl, applyType, applyConfidence]
      );
    };

    if (key) {
      const existing = await client.query("select id from job_listings where legacy_external_key=$1", [key]);
      if (existing.rows[0]) {
        const orgLogo = orgLogoUrl(company);
        await client.query(
          `update job_listings set
             title=$2, company=$3, logo=case
               when $4::text is not null and $4::text <> '' and $4::text !~* '(geezjobs\\.com|ethiojobs\\.net|ethiojobs\\.net\\.et|etcareers\\.com|alljobspo\\.com|hahu\\.jobs|dereja\\.com|ezega\\.com|jobwebethiopia\\.com|ngojobs\\.et|workethiopia\\.net|srazone\\.et|ethiopianreporterjobs\\.com|reliefweb\\.int|unjobs\\.org|vacancy|poster|advert|flyer|job.?ad|hiring.?banner|now.?hiring)' then $4::text
               when $23::text is not null and $23::text <> '' and (logo is null or logo = '' or logo ~* '(geezjobs\\.com|ethiojobs\\.net|ethiojobs\\.net\\.et|etcareers\\.com|alljobspo\\.com|hahu\\.jobs|dereja\\.com|ezega\\.com|jobwebethiopia\\.com|ngojobs\\.et|workethiopia\\.net|srazone\\.et|ethiopianreporterjobs\\.com|reliefweb\\.int|unjobs\\.org|vacancy|poster|advert|flyer|job.?ad|hiring.?banner|now.?hiring)') then $23::text
               when logo is null or logo = '' then $23::text
               else logo
             end, category=$5, location=$6, region_city=$7, job_type=$8,
             vacancies=coalesce($9,vacancies), education_requirements=coalesce($10::text,education_requirements),
             experience_requirements=coalesce($11::text,experience_requirements), required_skills=case when coalesce($12::text[],'{}'::text[]) <> '{}'::text[] then $12::text[] else required_skills end,
             salary=coalesce($13::text,salary), posted_date=coalesce($14::date,posted_date), deadline=$15::date,
             description=case
               when $16::text is not null and coalesce(description,'') ~* '(Powered by Greenhouse|indicates a required field|Autofill my application|Submit application|workethiopia\\.net does not collect applications|We use Google Analytics cookies|Related open jobs\\s*$)' then $16::text
               when $16::text is not null and length($16::text) >= length(coalesce(description,'')) then $16::text
               else coalesce(description,$16::text)
             end,
             description_excerpt=coalesce($17::text,description_excerpt),
             requirements=case
               when $18::text is not null and coalesce(requirements,'') ~* '(Powered by Greenhouse|indicates a required field|Autofill my application|Submit application)' then $18::text
               when $18::text is not null and length($18::text) >= length(coalesce(requirements,'')) then $18::text
               else coalesce(requirements,$18::text)
             end,
             application_instructions=coalesce($19::text,application_instructions), contact_email=coalesce($20::text,contact_email),
             original_url=$21, status=case when $15::date is not null and $15::date < current_date then 'expired' else case when status='expired' and ($15::date is null or $15::date >= current_date) then 'active' else status end end,
             last_verified_at=now(), updated_at=now(), raw_payload=$22::jsonb
             where id=$1`,
          [
            existing.rows[0].id,
            title,
            company,
            logo,
            frontendCategory,
            location,
            regionCity,
            jobType,
            vacancies,
            education,
            experience,
            skills,
            salary,
            posted,
            deadline,
            descRaw,
            excerpt(descRaw),
            reqRaw,
            appRaw,
            raw.contact_email || null,
            url,
            rawPayload,
            orgLogo,
          ]
        );
        await client.query(
          `insert into job_listing_sources (listing_id, source_id, external_id, source_url, last_verified_at, is_primary) values ($1,$2,$3,$4,now(),true) on conflict (source_id, source_url) do update set last_verified_at=now(), external_id=coalesce(excluded.external_id, job_listing_sources.external_id)`,
          [existing.rows[0].id, source.id, raw.external_id || null, url]
        );
        await postPublicFields(existing.rows[0].id);
        return { action: "updated", id: existing.rows[0].id };
      }
    }
    const byUrl = await client.query(
      "select l.id from job_listing_sources jls join job_listings l on l.id=jls.listing_id where jls.source_url=$1 limit 1",
      [url]
    );
    if (byUrl.rows[0]) return { action: "duplicate", id: byUrl.rows[0].id };

    const normTitle = norm(title);
    const normCompany = norm(company);
    if (normTitle.length >= 12 && normCompany.length >= 2) {
      const byContent = await client.query(
        `select l.id, l.original_url from job_listings l
          where l.status in ('active','pending','expired')
            and l.normalized_title = $1
            and lower(regexp_replace(coalesce(l.company,''), '\\s+', ' ', 'g')) = lower(regexp_replace($2, '\\s+', ' ', 'g'))
            and (($3::date is null and l.deadline is null) or l.deadline = $3::date)
            and not exists (select 1 from job_listing_sources jls where jls.listing_id = l.id and jls.source_id = $4 and jls.source_url = $5)
          order by (case when l.status='active' then 0 else 1 end), l.id desc limit 1`,
        [normTitle, company, deadline, source.id, url]
      );
      if (byContent.rows[0]) {
        const existingUrl = String(byContent.rows[0].original_url || "");
        const aggHost =
          /(^|\.)geezjobs\.com$|(^|\.)ethiojobs\.net$|(^|\.)ethiojobs\.net\.et$|(^|\.)etcareers\.com$|(^|\.)alljobspo\.com$|(^|\.)hahu\.jobs$|(^|\.)dereja\.com$|(^|\.)ezega\.com$|(^|\.)jobwebethiopia\.com$|(^|\.)ngojobs\.et$|(^|\.)workethiopia\.net$|(^|\.)srazone\.et$|(^|\.)ethiopianreporterjobs\.com$|(^|\.)reliefweb\.int$|(^|\.)unjobs\.org$/i;
        let existingHost = "";
        let incomingHost = "";
        try {
          existingHost = new URL(existingUrl).hostname;
        } catch {}
        try {
          incomingHost = new URL(url).hostname;
        } catch {}
        const incomingBetter = !!incomingHost && !aggHost.test(incomingHost) && (!existingHost || aggHost.test(existingHost));
        if (incomingBetter) {
          await client
            .query(
              `update job_listings set original_url=$2, application_instructions=coalesce($3::text, application_instructions), last_verified_at=now(), updated_at=now() where id=$1`,
              [byContent.rows[0].id, url, cleanText(raw.application_instructions, 10000)]
            )
            .catch(() => null);
        }
        await client.query(
          `insert into job_listing_sources (listing_id, source_id, external_id, source_url, last_verified_at, is_primary) values ($1,$2,$3,$4,now(),$5) on conflict (source_id, source_url) do update set last_verified_at=now(), external_id=coalesce(excluded.external_id, job_listing_sources.external_id)`,
          [byContent.rows[0].id, source.id, raw.external_id || null, url, incomingBetter]
        );
        if (incomingBetter) {
          await client
            .query(`update job_listing_sources set is_primary = (source_url = $2) where listing_id = $1`, [
              byContent.rows[0].id,
              url,
            ])
            .catch(() => null);
        }
        await client
          .query(
            `insert into job_merge_queue (candidate_listing_id, existing_listing_id, reason, confidence, status) values (null,$1,$2,92,'dismissed')`,
            [byContent.rows[0].id, `Cross-source duplicate attached (${source.name}): ${title}`]
          )
          .catch(() => null);
        return { action: "duplicate", id: byContent.rows[0].id, crossSource: true };
      }
    }

    const byHash = await client.query(
      "select id from job_listings where dedup_hash=$1 and status in ('active','pending') limit 1",
      [hash]
    );
    if (byHash.rows[0]) {
      await client.query(
        `insert into job_listing_sources (listing_id, source_id, external_id, source_url, last_verified_at, is_primary) values ($1,$2,$3,$4,now(),false) on conflict (source_id, source_url) do nothing`,
        [byHash.rows[0].id, source.id, raw.external_id || null, url]
      );
      await client
        .query(
          `insert into job_merge_queue (candidate_listing_id, existing_listing_id, reason, confidence, status) values (null,$1,$2,85,'pending')`,
          [byHash.rows[0].id, `Likely duplicate incoming vacancy from ${source.name}: ${title}`]
        )
        .catch(() => null);
      return { action: "duplicate", id: byHash.rows[0].id, queued: true };
    }

    const ins = await client.query(
      `insert into job_listings
        (legacy_external_key,title,company,logo,category,location,region_city,job_type,vacancies,education_requirements,experience_requirements,required_skills,salary,posted_date,deadline,description,description_excerpt,requirements,application_instructions,contact_email,original_url,primary_source_id,origin,status,normalized_title,dedup_hash,collected_at,last_verified_at,raw_payload)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,$15::date,$16,$17,$18,$19,$20,$21,$22,'aggregated',$23,$24,$25,now(),now(),$26::jsonb)
        returning id`,
      [
        key,
        title,
        company,
        logo,
        frontendCategory,
        location,
        regionCity,
        jobType,
        vacancies,
        education,
        experience,
        skills,
        salary,
        posted,
        deadline,
        descRaw,
        excerpt(descRaw),
        reqRaw,
        appRaw,
        raw.contact_email || null,
        url,
        source.id,
        status,
        norm(title),
        hash,
        rawPayload,
      ]
    );
    const id = ins.rows[0].id;
    await client.query(
      `insert into job_listing_sources (listing_id, source_id, external_id, source_url, last_verified_at, is_primary) values ($1,$2,$3,$4,now(),true) on conflict (source_id, source_url) do nothing`,
      [id, source.id, raw.external_id || null, url]
    );
    for (const c of matchedCats) {
      await client.query(`insert into job_listing_categories (listing_id, category_id) values ($1,$2) on conflict do nothing`, [
        id,
        c.id,
      ]);
    }
    await postPublicFields(id);
    return { action: "new", id };
  });
}

export async function markExpiredJobs() {
  const r = await query(
    `update job_listings set status='expired', job_status='expired', updated_at=now() where status='active' and deadline is not null and deadline < current_date`
  );
  return r?.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Admin statistics & review tooling
// ---------------------------------------------------------------------------

export async function getStats() {
  const [totals, today, week, sources, cats, queue, extraction, runs, apply] = await Promise.all([
    query(`select
      count(*)::int as total,
      count(*) filter (where status='active' and (deadline is null or deadline >= current_date))::int as active,
      count(*) filter (where status='expired' or (deadline is not null and deadline < current_date))::int as expired,
      count(*) filter (where status='pending')::int as pending,
      count(*) filter (where review_status in ('pending','unreviewed') and (extraction_status in ('needs_manual_review','failed') or apply_url is null))::int as needs_review,
      count(*) filter (where apply_url is null or apply_url_type='needs_manual_review')::int as missing_apply,
      count(*) filter (where apply_url_verified)::int as apply_verified,
      count(*) filter (where not organization_verified)::int as org_unverified,
      count(distinct company)::int as organizations
      from job_listings`),
    query(`select count(*)::int as n from job_listings where created_at >= date_trunc('day', now())`),
    query(`select count(*)::int as n from job_listings where created_at >= now() - interval '7 days'`),
    query(`select count(*)::int as total, count(*) filter (where integration_status='connected')::int as connected, count(*) filter (where integration_status in ('error','degraded','blocked'))::int as failed, count(*) filter (where enabled)::int as enabled, count(*) filter (where last_discovery_at is null or last_discovery_at < now() - interval '24 hours')::int as stale from job_sources`),
    query(`select coalesce(category,'Other') as category, count(*)::int as n from job_listings where status='active' group by 1 order by n desc limit 20`),
    query(`select status, count(*)::int as n from job_discovery_queue group by status`),
    query(`select coalesce(extraction_status,'unknown') as status, count(*)::int as n from job_listings group by 1`),
    query(`select count(*)::int as total, count(*) filter (where status='ok')::int as ok, count(*) filter (where status='error')::int as failed from job_sync_runs where started_at >= now() - interval '24 hours'`),
    query(`select round(avg(apply_url_confidence))::int as avg_confidence, count(*) filter (where apply_url is not null)::int as with_apply from job_listings where status in ('active','pending')`),
  ]);
  const queueStats = { pending: 0, extracting: 0, extracted: 0, failed: 0, skipped: 0, duplicate: 0, total: 0 };
  for (const row of queue) {
    queueStats[row.status] = row.n;
    queueStats.total += row.n;
  }
  const extractionStats = {};
  for (const row of extraction) extractionStats[row.status] = row.n;
  const runStats = runs[0] || { total: 0, ok: 0, failed: 0 };
  const successRate = runStats.total ? Math.round((runStats.ok / runStats.total) * 100) : null;
  return {
    totals: totals[0],
    newToday: today[0]?.n || 0,
    newThisWeek: week[0]?.n || 0,
    sources: sources[0],
    byCategory: cats,
    queue: queueStats,
    extraction: extractionStats,
    runs24h: { ...runStats, successRate },
    apply: apply[0] || { avg_confidence: 0, with_apply: 0 },
    duplicates: (await query(`select count(*)::int as n from job_merge_queue where status='pending'`))[0]?.n || 0,
  };
}

export async function listSources() {
  return query(`select * from job_sources order by name`);
}

export async function listSourcesWithStats() {
  return query(`select s.*,
      (select count(*)::int from job_discovery_queue q where q.source_id=s.id and q.status='pending') as queue_pending,
      (select count(*)::int from job_discovery_queue q where q.source_id=s.id and q.status='extracting') as queue_extracting,
      (select count(*)::int from job_discovery_queue q where q.source_id=s.id and q.status='extracted') as queue_extracted,
      (select count(*)::int from job_discovery_queue q where q.source_id=s.id and q.status='failed') as queue_failed,
      (select count(*)::int from job_discovery_queue q where q.source_id=s.id) as queue_total,
      (select count(*)::int from job_listings l where l.primary_source_id=s.id) as listing_count,
      (select count(*)::int from job_listings l where l.primary_source_id=s.id and l.status='pending') as pending_count,
      (select count(*)::int from job_listings l where l.primary_source_id=s.id and l.apply_url is null) as missing_apply
    from job_sources s order by s.name`);
}

export async function setSourceEnabled(slug, enabled) {
  return query(`update job_sources set enabled=$2, updated_at=now() where slug=$1 returning *`, [slug, !!enabled]);
}

export async function listReviewQueue({ limit = 100, status = null } = {}) {
  const max = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
  const vals = [max];
  let filter = "";
  if (status) {
    vals.push(status);
    filter = `and l.review_status = $2`;
  }
  return query(
    `select l.id, l.title, l.company, l.status, l.review_status, l.extraction_status, l.job_status,
            l.apply_url, l.apply_url_type, l.apply_url_verified, l.apply_url_confidence,
            l.quality_score, l.organization_verified, l.deadline, l.created_at, l.updated_at,
            s.name as source_name, s.slug as source_slug,
            (select count(*)::int from job_application_candidates c where c.listing_id=l.id) as candidate_count
       from job_listings l
       left join job_sources s on s.id = l.primary_source_id
      where l.status in ('pending','active')
        and (
          l.review_status = 'pending'
          or l.extraction_status in ('needs_manual_review','partial','failed')
          or l.apply_url is null
          or l.apply_url_verified = false
        )
        ${filter}
      order by (case when l.status='pending' then 0 else 1 end), l.created_at desc
      limit $1`,
    vals
  );
}

export async function getJobCandidates(listingId) {
  return query(
    `select id, listing_id, url, url_type, confidence, source, label, context, verified, status, created_at
       from job_application_candidates where listing_id=$1 order by confidence desc, id asc`,
    [listingId]
  );
}

export async function getAdminJob(id) {
  const rows = await query(
    `select l.*, s.name as source_name, s.slug as source_slug, s.base_url as source_base_url
       from job_listings l left join job_sources s on s.id=l.primary_source_id
      where l.id=$1`,
    [id]
  );
  if (!rows[0]) return null;
  const candidates = await getJobCandidates(id);
  const audit = await listAudit({ listingId: id, limit: 50 });
  return { job: rows[0], candidates, audit };
}

async function writeAudit({ listingId = null, actor = "admin", action, field = null, oldValue = null, newValue = null, note = null }) {
  await query(
    `insert into job_admin_audit (listing_id, actor, action, field, old_value, new_value, note)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [listingId, actor, action, field, oldValue == null ? null : String(oldValue).slice(0, 4000), newValue == null ? null : String(newValue).slice(0, 4000), note]
  );
}

export async function listAudit({ listingId = null, limit = 100 } = {}) {
  const max = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  if (listingId) {
    return query(
      `select a.*, l.title as listing_title from job_admin_audit a left join job_listings l on l.id=a.listing_id
        where a.listing_id=$1 order by a.created_at desc limit $2`,
      [listingId, max]
    );
  }
  return query(
    `select a.*, l.title as listing_title from job_admin_audit a left join job_listings l on l.id=a.listing_id
      order by a.created_at desc limit $1`,
    [max]
  );
}

export async function setManualApplyUrl(id, url, { actor = "admin", note = null } = {}) {
  const raw = String(url || "").trim();
  const dest = classifyDestination(raw);
  if (!dest.valid || dest.type === APPLY_URL_TYPES.SOURCE || dest.type === APPLY_URL_TYPES.LISTING) {
    throw new Error(`invalid_apply_url:${dest.reason || dest.type}`);
  }
  const before = await query(`select apply_url from job_listings where id=$1`, [id]);
  if (!before[0]) throw new Error("not_found");
  const verified = /^mailto:/i.test(raw) ? true : false;
  await query(
    `update job_listings set
       apply_url=$2, apply_url_type=$3, apply_url_confidence=100, apply_url_source='manual',
       apply_url_verified=$4, apply_url_checked_at=now(), apply_url_reason='manual_review',
       review_status='reviewed', reviewed_at=now(), reviewed_by=$5, updated_at=now()
     where id=$1`,
    [id, raw, dest.type, verified, actor]
  );
  await writeAudit({
    listingId: id,
    actor,
    action: "manual_apply_url",
    field: "apply_url",
    oldValue: before[0].apply_url,
    newValue: raw,
    note,
  });
  return { ok: true, id, applyUrl: raw, applyUrlType: dest.type };
}

export async function approveJob(id, { actor = "admin", note = null } = {}) {
  const rows = await query(`select status, deadline, extraction_status from job_listings where id=$1`, [id]);
  if (!rows[0]) throw new Error("not_found");
  const expired = rows[0].deadline && new Date(rows[0].deadline) < new Date(new Date().toISOString().slice(0, 10));
  const status = expired ? "expired" : "active";
  const jobStatus = expired ? "expired" : "open";
  await query(
    `update job_listings set status=$2, job_status=$3, review_status='approved', reviewed_at=now(), reviewed_by=$4, updated_at=now() where id=$1`,
    [id, status, jobStatus, actor]
  );
  await writeAudit({ listingId: id, actor, action: "approve", field: "status", oldValue: rows[0].status, newValue: status, note });
  return { ok: true, id, status };
}

export async function rejectJob(id, { actor = "admin", note = null } = {}) {
  const rows = await query(`select status from job_listings where id=$1`, [id]);
  if (!rows[0]) throw new Error("not_found");
  await query(
    `update job_listings set status='rejected', job_status='closed', review_status='rejected', reviewed_at=now(), reviewed_by=$2, updated_at=now() where id=$1`,
    [id, actor]
  );
  await writeAudit({ listingId: id, actor, action: "reject", field: "status", oldValue: rows[0].status, newValue: "rejected", note });
  return { ok: true, id, status: "rejected" };
}

export async function retryJobExtraction(id, { actor = "admin" } = {}) {
  const rows = await query(
    `select l.id, l.primary_source_id, l.canonical_job_url, l.original_job_url, l.original_url
       from job_listings l where l.id=$1`,
    [id]
  );
  if (!rows[0]) throw new Error("not_found");
  const url = rows[0].canonical_job_url || rows[0].original_job_url || rows[0].original_url;
  if (!rows[0].primary_source_id || !url) throw new Error("missing_source_or_url");
  const queued = await query(
    `insert into job_discovery_queue (source_id, discovered_url, canonical_url, status, attempts, next_attempt_at)
     values ($1,$2,$2,'pending',0,now())
     on conflict (source_id, discovered_url) do update
       set status='pending', attempts=0, last_error=null, next_attempt_at=now()
     returning id`,
    [rows[0].primary_source_id, url]
  );
  await writeAudit({ listingId: id, actor, action: "retry_extraction", field: "queue", newValue: String(queued[0]?.id || "") });
  return { ok: true, id, queueId: queued[0]?.id || null };
}

// ---------------------------------------------------------------------------
// Sync runs, submissions
// ---------------------------------------------------------------------------

export async function createSyncRun({ source_id = null, trigger_type = "manual" }) {
  const r = await query(`insert into job_sync_runs (source_id, trigger_type, status) values ($1,$2,'running') returning *`, [
    source_id,
    trigger_type,
  ]);
  return r[0];
}

export async function finishSyncRun(id, patch) {
  const r = await query(
    `update job_sync_runs set
       status=$2, finished_at=now(), fetched_count=$3, new_count=$4, updated_count=$5,
       duplicate_count=$6, expired_count=$7, error_count=$8, message=$9, details=$10::jsonb,
       discovered_count=$11, extracted_count=$12, apply_found_count=$13, needs_review_count=$14, duration_ms=$15
     where id=$1 returning *`,
    [
      id,
      patch.status || "ok",
      patch.fetched_count || 0,
      patch.new_count || 0,
      patch.updated_count || 0,
      patch.duplicate_count || 0,
      patch.expired_count || 0,
      patch.error_count || 0,
      patch.message || null,
      JSON.stringify(patch.details || {}),
      patch.discovered_count || 0,
      patch.extracted_count || 0,
      patch.apply_found_count || 0,
      patch.needs_review_count || 0,
      patch.duration_ms || null,
    ]
  );
  return r[0];
}

export async function listSyncRuns(limit = 50) {
  return query(
    `select r.*, s.name as source_name, s.slug as source_slug from job_sync_runs r left join job_sources s on s.id=r.source_id order by r.started_at desc limit $1`,
    [limit]
  );
}

export async function createDirectSubmission(payload, submitter = {}) {
  const r = await query(
    `insert into employer_submissions (submitter_user_ref, submitter_email, organization_name, payload, approval_status) values ($1,$2,$3,$4::jsonb,'pending') returning *`,
    [submitter.userRef || null, submitter.email || payload.contactEmail || null, payload.company || null, JSON.stringify(payload)]
  );
  return r[0];
}

export async function approveSubmission(id, reviewerNote = null) {
  return withClient(async (client) => {
    const sub = await client.query(`select * from employer_submissions where id=$1`, [id]);
    if (!sub.rows[0]) throw new Error("Submission not found");
    const p = sub.rows[0].payload || {};
    const deadline = toDate(p.deadline);
    const ins = await client.query(
      `insert into job_listings (title,company,category,location,job_type,vacancies,posted_date,deadline,description,requirements,contact_email,origin,status,description_excerpt,last_verified_at,extraction_status,job_status,apply_url,apply_url_type,apply_url_verified,review_status)
       values ($1,$2,$3,$4,$5,$6,current_date,$7::date,$8,$9,$10,'direct','active',$11,now(),'verified','open',$12,$13,false,'unreviewed') returning id`,
      [
        p.title,
        p.company,
        p.category || "Business and Management",
        p.location,
        p.jobType || p.type,
        p.vacancies ? parseInt(p.vacancies, 10) : 1,
        deadline,
        p.description,
        p.requirements,
        p.contactEmail,
        excerpt(p.description),
        p.applyUrl || null,
        p.applyUrl ? APPLY_URL_TYPES.EXTERNAL : null,
      ]
    );
    await client.query(
      `update employer_submissions set approval_status='approved', listing_id=$2, reviewer_note=$3, updated_at=now() where id=$1`,
      [id, ins.rows[0].id, reviewerNote]
    );
    return { submissionId: id, listingId: ins.rows[0].id };
  });
}
