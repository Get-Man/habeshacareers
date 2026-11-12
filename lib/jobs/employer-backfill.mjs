// Employer identity + official logo backfill.
//
// Runs server-side. For every organisation in the employer directory it:
//   1. infers the organisation's OWN website from the vacancy data,
//   2. fetches that website and reads its official logo,
//   3. finds the organisation's own careers/vacancies page,
//   4. stores all of it in the employer directory so every vacancy of that
//      organisation shows the same identity, logo and Apply button.
//
// The publishing job board's own logo is never used: a logo is only accepted
// when it is served by the organisation's own domain, or when it is a
// favicon service URL keyed on the organisation's own domain.
//
// The work is bounded and resumable: organisations that already have a
// verified identity are skipped, so each run advances the catalogue a little
// further.

import { query } from "../db.mjs";
import { fetchText } from "./extract/http.mjs";
import {
  collectPublisherAssets,
  employerKey,
  extractSiteLogoCandidates,
  faviconServiceCandidates,
  isPublishableLogo,
  pickBestLogo,
  verifyLogoOwnership,
} from "./extract/employer-logo.mjs";
import { baseDomain, hostOf, isKnownSourceDomain } from "./extract/hosts.mjs";
import {
  careersUrlCandidates,
  inferEmployerDomain,
  usableEmployerDomain,
} from "./employer-identity.mjs";

const LOGO_FETCH_OPTIONS = {
  timeoutMs: 8000,
  maxBytes: 700_000,
  respectRobots: true,
  retries: 0,
};

const CAREERS_FETCH_OPTIONS = {
  timeoutMs: 6000,
  maxBytes: 400_000,
  respectRobots: true,
  retries: 0,
};

const CAREERS_HINT = /(career|vacanc|job|recruit|opportunit|position)/i;

/**
 * The organisations that still need an identity.
 */
export async function listEmployersNeedingIdentity({ limit = 25 } = {}) {
  const max = Math.min(500, Math.max(1, Number(limit) || 25));
  return query(
    `select e.id,
            e.name,
            e.name_key,
            e.website_url,
            e.website_domain,
            e.careers_url,
            e.logo_verified,
            e.logo_public_url,
            e.listing_count,
            (select count(*)::int from job_listings l where l.employer_id = e.id and l.status = 'active') as active_count
       from employer_directory e
      where (e.website_domain is null
             or e.careers_url is null
             or e.logo_verified = false)
        -- An organisation that was checked recently is left alone, so each
        -- run makes progress on the ones that have never been resolved.
        and (e.identity_checked_at is null
             or e.identity_checked_at < now() - interval '7 days')
      order by e.listing_count desc, e.id asc
      limit $1`,
    [max]
  );
}

/**
 * The signals one organisation's vacancies carry about its own website.
 */
export async function collectEmployerSignals(employerId) {
  const rows = await query(
    `select apply_url,
            application_email,
            contact_email,
            left(coalesce(description,''), 4000) as description,
            company
       from job_listings
      where employer_id = $1
        and status = 'active'
      order by apply_url nulls last
      limit 25`,
    [employerId]
  );
  const signals = {
    applyUrls: [],
    emails: [],
    descriptions: [],
    company: rows[0]?.company || "",
  };
  for (const row of rows) {
    if (row.apply_url) signals.applyUrls.push(row.apply_url);
    const mail = row.application_email || row.contact_email;
    if (mail) signals.emails.push(mail);
    if (row.description) signals.descriptions.push(row.description);
  }
  return signals;
}

/**
 * Read the official logo from the organisation's own website.
 *
 * Returns `{ url, kind, source, confidence }` or null.
 */
export async function resolveOfficialLogo({ websiteUrl, domain, company }) {
  if (!websiteUrl) return null;
  let page;
  try {
    page = await fetchText(websiteUrl, LOGO_FETCH_OPTIONS);
  } catch {
    page = null;
  }

  const candidates = [];
  if (page?.ok && page.text) {
    const publisherAssets = collectPublisherAssets(page.text, null);
    for (const candidate of extractSiteLogoCandidates(page.text, page.url || websiteUrl, {
      publisherAssets,
    })) {
      candidates.push({ ...candidate, origin: "employer_site" });
    }
  }

  // The organisation's own favicon is always a safe official mark.
  for (const candidate of faviconServiceCandidates(domain)) {
    candidates.push({ ...candidate, origin: "favicon_service" });
  }

  const context = { employerDomain: domain, employerName: company, publisherAssets: [] };
  const verified = [];
  for (const candidate of candidates) {
    const verdict = verifyLogoOwnership(candidate, context);
    verified.push({ ...candidate, verified: verdict.ok, reason: verdict.reason, verdictKind: verdict.kind });
  }

  const best = pickBestLogo(verified, context);
  if (!best) return null;
  if (!isPublishableLogo(best.url)) return null;
  return {
    url: best.url,
    kind: best.verdictKind || best.kind || "employer_site",
    source: best.origin === "favicon_service" ? "favicon_service" : "employer_site",
    confidence: Math.max(0, Math.min(100, Math.round(best.score ?? 60))),
  };
}

/**
 * Find the organisation's own careers page.
 */
export async function resolveCareersUrl({ websiteUrl, domain, maxProbes = 5 }) {
  const candidates = careersUrlCandidates(domain, websiteUrl).slice(0, maxProbes);
  for (const candidate of candidates) {
    let page;
    try {
      page = await fetchText(candidate, CAREERS_FETCH_OPTIONS);
    } catch {
      continue;
    }
    if (!page?.ok || !page.text) continue;
    if (!CAREERS_HINT.test(page.text.slice(0, 4000))) continue;
    return page.url || candidate;
  }
  return null;
}

/**
 * Resolve and store one organisation's identity.
 */
export async function refreshEmployerIdentity(employer, { withCareers = true } = {}) {
  const signals = await collectEmployerSignals(employer.id);
  const company = signals.company || employer.name || "";

  // 1) The organisation's own website.
  let domain = usableEmployerDomain(employer.website_domain);
  let websiteUrl = employer.website_url || null;
  let identitySource = employer.identity_source || null;

  if (!domain) {
    const inferred = inferEmployerDomain({
      company,
      applyUrl: signals.applyUrls.find((u) => u && !/^mailto:/i.test(u)) || "",
      email: signals.emails[0] || "",
      description: signals.descriptions.join("\n"),
    });
    if (inferred.domain) {
      domain = inferred.domain;
      websiteUrl = inferred.url;
      identitySource = inferred.source;
    }
  }

  const patch = {
    domain,
    websiteUrl: websiteUrl || (domain ? `https://${domain}` : null),
    identitySource,
    careersUrl: employer.careers_url || null,
    logo: null,
  };

  // 2) The official logo.
  if (domain && !employer.logo_verified) {
    patch.logo = await resolveOfficialLogo({
      websiteUrl: patch.websiteUrl,
      domain,
      company,
    });
  }

  // 3) The organisation's own careers page.
  if (domain && !patch.careersUrl && withCareers) {
    patch.careersUrl = await resolveCareersUrl({ websiteUrl: patch.websiteUrl, domain });
  }

  await query(
    `update employer_directory
        set website_url = coalesce($2, website_url),
            website_domain = coalesce($3, website_domain),
            identity_source = coalesce(identity_source, $4),
            careers_url = coalesce($5, careers_url),
            logo_url = coalesce($6, logo_url),
            logo_public_url = coalesce($7, logo_public_url),
            logo_host_kind = coalesce($8, logo_host_kind),
            logo_source = coalesce($9, logo_source),
            logo_confidence = greatest(coalesce(logo_confidence, 0), coalesce($10, 0)),
            logo_verified = logo_verified or $11,
            logo_verified_at = case when $11 then coalesce(logo_verified_at, now()) else logo_verified_at end,
            identity_checked_at = now(),
            updated_at = now()
      where id = $1`,
    [
      employer.id,
      patch.websiteUrl,
      patch.domain,
      patch.identitySource,
      patch.careersUrl,
      patch.logo?.url || null,
      patch.logo?.url || null,
      patch.logo ? "employer" : null,
      patch.logo?.source || null,
      patch.logo?.confidence || 0,
      !!patch.logo,
    ]
  );

  return {
    id: employer.id,
    name: employer.name,
    domain: patch.domain,
    careersUrl: patch.careersUrl,
    logo: patch.logo?.url || null,
    changed: !!(patch.domain || patch.careersUrl || patch.logo),
  };
}

/**
 * Refresh a batch of organisations.
 *
 * `budgetMs` bounds the whole run: when the budget is spent the remaining
 * organisations are left for the next run.
 */
export async function backfillEmployerIdentities({ limit = 25, withCareers = true, budgetMs = 0 } = {}) {
  const employers = await listEmployersNeedingIdentity({ limit });
  const deadline = budgetMs > 0 ? Date.now() + budgetMs : 0;
  const results = [];
  for (const employer of employers) {
    if (deadline && Date.now() > deadline) {
      results.push({ id: employer.id, name: employer.name, skipped: "budget" });
      continue;
    }
    try {
      const result = await refreshEmployerIdentity(employer, { withCareers });
      results.push(result);
    } catch (e) {
      results.push({ id: employer.id, name: employer.name, error: String(e?.message || e) });
    }
  }
  return {
    processed: results.filter((r) => !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    withDomain: results.filter((r) => r.domain).length,
    withLogo: results.filter((r) => r.logo).length,
    withCareers: results.filter((r) => r.careersUrl).length,
    errors: results.filter((r) => r.error).length,
    results,
  };
}

/**
 * Link every listing whose employer name matches a directory entry.
 * A listing that was imported before the directory existed still has to share
 * the organisation's verified logo.
 */
export async function relinkListingsToEmployers() {
  const rows = await query(
    `update job_listings l
        set employer_id = e.id,
            employer_name_key = e.name_key,
            updated_at = now()
       from employer_directory e
      where l.employer_id is null
        and l.company is not null
        and btrim(l.company) <> ''
        and lower(btrim(l.company)) <> 'organization not verified'
        and lower(regexp_replace(trim(l.company), '\s+', ' ', 'g')) = e.name_key
      returning id`
  );
  return rows.length;
}

export { employerKey, hostOf, baseDomain, isKnownSourceDomain };
