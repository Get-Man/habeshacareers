#!/usr/bin/env node
/**
 * Deploy-time enrichment for ETcareers-sourced vacancies.
 * ------------------------------------------------------
 *
 * Uses the same zero-visit contract as `scripts/headless-job-fetch.mjs`:
 * only the public RSS feed, search-index snippets and image search are read.
 * No ETcareers job detail page is ever requested, rendered or navigated to.
 *
 * The script reads the real catalogue from the database, finds rows whose
 * internal source is ETcareers, matches them to the public feed by title, and
 * fills only what is missing:
 *   - employer identity (where the row is still "Unknown organization")
 *   - a verified employer logo served through /api/employer-logo
 *   - the full employer description and direct application URL (where the row
 *     still has the stub "Open the official/original vacancy page…" text)
 *
 * Nothing is stored in a public file: the enrichment is computed from the feed
 * at deploy time and written straight to the database. Third-party logo hosts
 * and discovery-source page links never reach the public API, HTML or assets.
 *
 * Fail-soft: an unresolved logo or a bad application link never fails a deploy;
 * the remaining fields are still enriched and the run is safe to repeat.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { hasDatabase, query, withClient } from "../lib/db.mjs";
import { classifyDestination, APPLY_URL_TYPES } from "../lib/jobs/extract/apply-link.mjs";
import { Diagnostics } from "./etcareers-scraper.mjs";
import { resolve_org_logo } from "./etcareers-embed.mjs";
import {
  extractHeadlessJob,
  guardedFetch,
  isForbiddenEtcareersUrl,
  parseRssItems,
} from "./headless-job-fetch.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEED_URL = "https://etcareers.com/jobs.rss";
const STUB_DESCRIPTION = "Open the official/original vacancy page";
const MAX_ROWS = Number(process.env.ETCAREERS_ENRICH_LIMIT || 400);
const LOGO_NOTE =
  "Logo resolved from public image search by the zero-visit ETcareers enrichment; no official domain inferred.";

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", bull: "•",
};

export function normaliseTitleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function feedJobTitle(value) {
  return String(value || "")
    .replace(/\s+-\s+[^-]+\s+-\s+[^-]+\s*$/, "")
    .trim();
}

export function isStubDescription(value) {
  return String(value || "").trimStart().startsWith(STUB_DESCRIPTION);
}

export function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<\/(p|h[1-6]|div|ul|ol|table|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, entity) => {
      if (entity[0] === "#") {
        const n = /^#x/i.test(entity)
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff
          ? String.fromCodePoint(n)
          : full;
      }
      return ENTITIES[entity.toLowerCase()] ?? full;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function needsEnrichment(row) {
  return {
    identity:
      !row.company ||
      ["Unknown organization", "Organization not verified"].includes(String(row.company).trim()),
    description: !row.description || isStubDescription(row.description),
    apply: !row.apply_url,
    logo: !(row.employer_logo_public_url || row.logo || row.organization_logo_url),
  };
}

async function loadCandidateRows() {
  // The source is identified internally only. No source column is selected for
  // the public view, and these URLs never leave this script.
  return query(`
    select distinct on (l.id)
           l.id, l.title, l.company, l.description, l.apply_url,
           l.logo, l.organization_logo_url, l.employer_id,
           ed.logo_public_url as employer_logo_public_url,
           ed.logo_verified as employer_logo_verified
      from job_listings l
      left join job_sources s on s.id = l.primary_source_id
      left join job_listing_sources jls on jls.listing_id = l.id
      left join job_sources s2 on s2.id = jls.source_id
      left join employer_directory ed on ed.id = l.employer_id
     where s.slug = 'etcareers'
        or s2.slug = 'etcareers'
        or l.original_url ~* 'etcareers\\.com'
        or l.original_job_url ~* 'etcareers\\.com'
        or l.listing_page_url ~* 'etcareers\\.com'
        or l.canonical_job_url ~* 'etcareers\\.com'
     order by l.id desc
     limit ${Number(MAX_ROWS) || 400}
  `);
}

async function ensureEmployer(client, orgName, logo) {
  const nameKey = normaliseTitleKey(orgName);
  if (!nameKey) return null;

  const existing = await client.query(
    "select id, logo_url, logo_verified, logo_source from employer_directory where name_key = $1 limit 1",
    [nameKey]
  );
  const logoUrl = logo?.logo_url && !isForbiddenEtcareersUrl(logo.logo_url) ? logo.logo_url : null;
  let id;

  if (!existing.rows[0]) {
    const inserted = await client.query(
      `insert into employer_directory
        (name, name_key, aliases, logo_url, logo_public_url, logo_host_kind,
         logo_source, logo_confidence, logo_verified, logo_verified_at,
         logo_review_note, identity_source)
       values ($1, $2, '{}', $3, null, 'board_cdn', 'global_search',
               $4, $4, case when $4 then now() else null end, $5, 'manual')
       returning id`,
      [orgName, nameKey, logoUrl, logoUrl ? 90 : 0, LOGO_NOTE]
    );
    id = inserted.rows[0].id;
  } else {
    id = existing.rows[0].id;
    const canImproveLogo =
      !existing.rows[0].logo_url ||
      !existing.rows[0].logo_verified ||
      ["seeded", "legacy_listing", "none"].includes(existing.rows[0].logo_source);
    if (logoUrl && canImproveLogo) {
      await client.query(
        `update employer_directory
            set logo_url = $2,
                logo_host_kind = 'board_cdn',
                logo_source = 'global_search',
                logo_confidence = 90,
                logo_verified = true,
                logo_verified_at = now(),
                logo_review_note = $3,
                updated_at = now()
          where id = $1`,
        [id, logoUrl, LOGO_NOTE]
      );
    }
  }

  if (logoUrl) {
    await client.query(
      `update employer_directory
          set logo_public_url = '/api/employer-logo?id=' || id
        where id = $1 and (logo_public_url is null or btrim(logo_public_url) = '')`,
      [id]
    );
  }
  return id;
}

async function updateListing(client, row, patch, employerId) {
  const applyCheck = patch.applyUrl
    ? classifyDestination(patch.applyUrl, {
        pageUrl: patch.rssLink,
        employerName: patch.orgName,
      })
    : null;
  const invalidApplyTypes = new Set([
    APPLY_URL_TYPES.SOURCE,
    APPLY_URL_TYPES.LISTING,
    APPLY_URL_TYPES.SOCIAL,
    APPLY_URL_TYPES.IMAGE,
    APPLY_URL_TYPES.UNKNOWN,
  ]);
  const usableApply =
    applyCheck?.valid && !invalidApplyTypes.has(applyCheck.type)
      ? { url: patch.applyUrl, type: applyCheck.type }
      : null;
  const wantsApply = patch.needs.apply && usableApply;
  const wantsDescription = patch.needs.description && patch.descriptionText;
  const wantsLogo = patch.needs.logo && patch.logoUrl;

  await client.query(
    `update job_listings
        set company = case when $2::boolean then $3 else company end,
            employer_id = coalesce($4, employer_id),
            employer_name_key = coalesce($5, employer_name_key),
            organization_logo_source = case when $6::boolean then 'global_search' else organization_logo_source end,
            organization_logo_verified = case when $6::boolean then true else organization_logo_verified end,
            description = case when $7::boolean then $8 else description end,
            description_html = case when $7::boolean then $9 else description_html end,
            description_excerpt = case when $7::boolean then left($8, 500) else description_excerpt end,
            apply_url = case when $10::boolean then $11 else apply_url end,
            apply_url_type = case when $10::boolean then $12 else apply_url_type end,
            apply_url_source = case when $10::boolean then 'rss_feed' else apply_url_source end,
            apply_url_verified = case when $10::boolean then true else apply_url_verified end,
            apply_url_confidence = case when $10::boolean then 90 else apply_url_confidence end,
            apply_url_checked_at = case when $10::boolean then now() else apply_url_checked_at end,
            last_verified_at = now(),
            updated_at = now()
      where id = $1`,
    [
      row.id,
      patch.needs.identity && patch.orgName,
      patch.orgName || null,
      employerId || null,
      patch.orgName ? normaliseTitleKey(patch.orgName) : null,
      wantsLogo,
      !!wantsDescription,
      wantsDescription || null,
      patch.descriptionHtml || null,
      !!wantsApply,
      wantsApply?.url || null,
      wantsApply?.type || null,
    ]
  );
}

export async function main() {
  if (!hasDatabase()) {
    console.log("[enrich-etcareers] no database configured; skipping.");
    return { skipped: "no_database" };
  }

  const networkLog = [];
  const diag = new Diagnostics(true);
  const xml = await (
    await guardedFetch(FEED_URL, {}, { networkLog, diag })
  ).text();
  const items = parseRssItems(xml);
  if (!items.length) throw new Error("the public ETcareers feed returned no listings");

  const byTitle = new Map();
  for (const item of items) {
    for (const key of [normaliseTitleKey(feedJobTitle(item.title)), normaliseTitleKey(item.title)]) {
      if (key && !byTitle.has(key)) byTitle.set(key, item);
    }
  }

  const rows = await loadCandidateRows();
  const candidates = rows.filter((row) => {
    const needs = needsEnrichment(row);
    return needs.identity || needs.description || needs.apply || needs.logo;
  });

  const logoCache = new Map();
  const resolveCachedLogo = async (orgName, pageUrl, extractOptions, extractDiag) => {
    const key = normaliseTitleKey(orgName);
    if (!key) return { logo_url: null, logo_local_path: null, logo_source: "none" };
    if (logoCache.has(key)) return logoCache.get(key);

    const existing = await query(
      `select logo_url, logo_public_url, logo_verified, logo_source
         from employer_directory where name_key = $1 limit 1`,
      [key]
    );
    const known = existing[0];
    if (known?.logo_verified && known.logo_public_url) {
      const cached = {
        logo_url: known.logo_url,
        logo_local_path: null,
        logo_source: known.logo_source || "directory_cache",
        logo_width: 0,
        logo_height: 0,
      };
      logoCache.set(key, cached);
      return cached;
    }

    let resolved;
    try {
      resolved = await resolve_org_logo(orgName, { html: "" }, pageUrl, {
        ...extractOptions,
        headerHtml: "",
        assetsDir: path.resolve(REPO_ROOT, "assets/logos"),
        allowGlobalSearch: true,
        maxSearchResults: 5,
        quiet: true,
        diag: extractDiag,
      });
    } catch (error) {
      extractDiag?.add("logo resolver", `${orgName}: ${error.message}`);
      resolved = { logo_url: null, logo_local_path: null, logo_source: "none" };
    }
    logoCache.set(key, resolved || { logo_url: null, logo_local_path: null, logo_source: "none" });
    return logoCache.get(key);
  };

  const stats = { feedItems: items.length, candidates: candidates.length, updated: 0, matched: 0, noMatch: 0, failed: 0 };
  const extractOptions = {
    rssXml: xml,
    quiet: true,
    noCrossReference: true,
    networkLog,
    diag,
    resolveOrgLogo: resolveCachedLogo,
    maxSearchResults: 5,
  };

  for (const row of candidates) {
    const item =
      byTitle.get(normaliseTitleKey(feedJobTitle(row.title))) ||
      byTitle.get(normaliseTitleKey(row.title));
    if (!item) {
      stats.noMatch += 1;
      continue;
    }
    stats.matched += 1;
    try {
      const record = await extractHeadlessJob(item.link, extractOptions);
      if (!record.org_name) continue;
      const patch = {
        orgName: record.org_name,
        logoUrl: record.logo_url,
        descriptionHtml: record.description_html,
        descriptionText: htmlToText(record.description_html),
        applyUrl: record.direct_apply_url,
        rssLink: item.link,
        needs: needsEnrichment(row),
      };
      await withClient(async (client) => {
        await client.query("begin");
        try {
          const employerId =
            patch.needs.identity || patch.needs.logo
              ? await ensureEmployer(client, patch.orgName, { logo_url: patch.logoUrl })
              : row.employer_id;
          await updateListing(client, row, patch, employerId);
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
      stats.updated += 1;
    } catch (error) {
      stats.failed += 1;
      diag.add("listing failed", `${row.id}: ${error.message}`);
    }
  }

  const forbidden = networkLog.filter((url) => isForbiddenEtcareersUrl(url));
  if (forbidden.length) throw new Error(`zero-visit guard blocked ${forbidden.length} request(s)`);

  console.log(
    `[enrich-etcareers] feed ${stats.feedItems} | candidates ${stats.candidates} | matched ${stats.matched} | updated ${stats.updated} | no match ${stats.noMatch} | failed ${stats.failed} | job page requests 0`
  );
  return stats;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`[enrich-etcareers] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
