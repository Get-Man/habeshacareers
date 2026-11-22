#!/usr/bin/env node
/**
 * Deploy-time enrichment for ETcareers-sourced vacancies.
 * ------------------------------------------------------
 *
 * Uses the same zero-visit contract as `scripts/headless-job-fetch.mjs`:
 * only the public RSS feed, search-index snippets and image search are read.
 * No ETcareers job detail page is ever requested, rendered or navigated to.
 *
 * The script reads the real catalogue from the database and matches rows to the
 * public feed by title, so older seeded rows without an internal source link
 * are covered too. It fills only what is missing:
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
import { publicLogo } from "../lib/jobs/repository.mjs";
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
const MAX_ROWS = Number(process.env.ETCAREERS_ENRICH_LIMIT || 1000);
const DIAGNOSTIC_LIMIT = Number(process.env.ETCAREERS_DIAGNOSTIC_LIMIT || 8);
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
    // Some feed titles end with a dangling separator after the employer
    // ("... - Let Me Be A Child e.V. -") because the location is missing.
    .replace(/\s+-\s+[^-]+\s+-\s*$/, "")
    .trim();
}

export function isStubDescription(value) {
  return String(value || "").trimStart().startsWith(STUB_DESCRIPTION);
}

function short(value, max = 140) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sample(row, extra = {}) {
  return { id: row.id, title: short(row.title, 100), ...extra };
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

function isUsableEmployerLogo(logoPublicUrl) {
  return Boolean(
    publicLogo({
      employer_logo_url: logoPublicUrl,
      organization_logo_url: null,
      logo: null,
    })
  );
}

function isProxyLogoPath(value) {
  return /^\/api\/employer-logo\?id=\d+$/i.test(String(value || "").trim());
}

export function needsEnrichment(row) {
  // A non-null legacy logo is not enough: board favicons and discovery-source
  // assets are filtered out by the public mapper, so the vacancy still renders
  // an empty logo tile. Use exactly the same visibility rule here.
  const visibleLogo = publicLogo({
    employer_logo_url: row.employer_logo_public_url,
    organization_logo_url: row.organization_logo_url,
    logo: row.logo,
  });
  return {
    identity:
      !row.company ||
      ["Unknown organization", "Organization not verified"].includes(String(row.company).trim()),
    description: !row.description || isStubDescription(row.description),
    apply: !row.apply_url,
    logo: !visibleLogo,
  };
}

async function loadCandidateRows() {
  // A row qualifies by title match against the public feed, so it does not
  // need an internal source link (older seeded rows have none). Only fields
  // that are actually missing are written; good data is never overwritten.
  return query(`
    select l.id, l.title, l.company, l.description, l.apply_url,
           l.logo, l.organization_logo_url, l.employer_id,
           ed.logo_public_url as employer_logo_public_url,
           ed.logo_verified as employer_logo_verified
      from job_listings l
      left join employer_directory ed on ed.id = l.employer_id
     where coalesce(l.status, '') <> 'archived'
     order by l.id desc
     limit ${Number(MAX_ROWS) || 1000}
  `);
}

export async function ensureEmployer(client, orgName, logo) {
  const nameKey = normaliseTitleKey(orgName);
  if (!nameKey) return null;

  const existing = await client.query(
    "select id, logo_url, logo_public_url, logo_verified, logo_source from employer_directory where name_key = $1 limit 1",
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
               $4, $5, case when $5 then now() else null end, $6, 'manual')
       returning id`,
      [orgName, nameKey, logoUrl, logoUrl ? 90 : 0, Boolean(logoUrl), LOGO_NOTE]
    );
    id = inserted.rows[0].id;
  } else {
    id = existing.rows[0].id;
    const canImproveLogo =
      !existing.rows[0].logo_url ||
      !existing.rows[0].logo_verified ||
      !isUsableEmployerLogo(existing.rows[0].logo_public_url) ||
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

  if (logoUrl && !isProxyLogoPath(existing.rows[0]?.logo_public_url)) {
    // Always publish through our own proxy, replacing any legacy/filtered URL.
    await client.query(
      `update employer_directory
          set logo_public_url = '/api/employer-logo?id=' || id
        where id = $1`,
      [id]
    );
  }
  return id;
}

export async function updateListing(client, row, patch, employerId) {
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
  const wantsLogo = Boolean(patch.needs.logo && patch.logoUrl);

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
            application_email = case
              when $10::boolean and $11 like 'mailto:%' then substring($11 from 8)
              else application_email
            end,
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
      Boolean(patch.needs.identity && patch.orgName),
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
  const logoResolutionNotes = [];
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
    if (known?.logo_verified && isUsableEmployerLogo(known.logo_public_url)) {
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
    const diagStart = extractDiag?.lines?.length || 0;
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
    if (!resolved?.logo_url && logoResolutionNotes.length < DIAGNOSTIC_LIMIT) {
      const notes = (extractDiag?.lines || [])
        .slice(diagStart)
        .filter((line) => /global image search|logo download|REJECT|official-domain candidates|logo source/i.test(line))
        .slice(-4)
        .map((line) => short(line, 160));
      logoResolutionNotes.push({ org: orgName, notes });
    }
    logoCache.set(key, resolved || { logo_url: null, logo_local_path: null, logo_source: "none" });
    return logoCache.get(key);
  };

  const stats = {
    feedItems: items.length,
    candidates: candidates.length,
    matched: 0,
    updated: 0,
    skippedNoOrg: 0,
    noMatch: 0,
    failed: 0,
    noMatchSamples: [],
    skippedNoOrgSamples: [],
    failedSamples: [],
    logoNeeded: 0,
    logoResolved: 0,
    logoUnresolvedSamples: [],
  };
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
      if (stats.noMatchSamples.length < DIAGNOSTIC_LIMIT) {
        stats.noMatchSamples.push(sample(row));
      }
      continue;
    }
    stats.matched += 1;
    let phase = "extract";
    try {
      const record = await extractHeadlessJob(item.link, extractOptions);
      phase = "record";
      if (!record.org_name) {
        stats.skippedNoOrg += 1;
        if (stats.skippedNoOrgSamples.length < DIAGNOSTIC_LIMIT) {
          stats.skippedNoOrgSamples.push(sample(row));
        }
        continue;
      }
      const patch = {
        orgName: record.org_name,
        logoUrl: record.logo_url,
        descriptionHtml: record.description_html,
        descriptionText: htmlToText(record.description_html),
        applyUrl: record.direct_apply_url,
        rssLink: item.link,
        needs: needsEnrichment(row),
      };
      if (patch.needs.logo) {
        stats.logoNeeded += 1;
        if (patch.logoUrl) {
          stats.logoResolved += 1;
        } else if (stats.logoUnresolvedSamples.length < DIAGNOSTIC_LIMIT) {
          stats.logoUnresolvedSamples.push(sample(row, { org: patch.orgName }));
        }
      }
      phase = "database";
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
      if (stats.failedSamples.length < DIAGNOSTIC_LIMIT) {
        stats.failedSamples.push(sample(row, { phase, error: short(error?.message || error, 200) }));
      }
      diag.add("listing failed", `${row.id} (${phase}): ${error.message}`);
    }
  }

  const forbidden = networkLog.filter((url) => isForbiddenEtcareersUrl(url));
  if (forbidden.length) throw new Error(`zero-visit guard blocked ${forbidden.length} request(s)`);

  console.log(
    `[enrich-etcareers] feed ${stats.feedItems} | candidates ${stats.candidates} | matched ${stats.matched} | updated ${stats.updated} | no org ${stats.skippedNoOrg} | no match ${stats.noMatch} | failed ${stats.failed} | logo needed ${stats.logoNeeded} | logo resolved ${stats.logoResolved} | job page requests 0`
  );
  if (stats.failedSamples.length) {
    console.log(`[enrich-etcareers] failure samples ${JSON.stringify(stats.failedSamples)}`);
  }
  if (stats.noMatchSamples.length) {
    console.log(`[enrich-etcareers] no-match samples ${JSON.stringify(stats.noMatchSamples)}`);
  }
  if (stats.skippedNoOrgSamples.length) {
    console.log(`[enrich-etcareers] no-org samples ${JSON.stringify(stats.skippedNoOrgSamples)}`);
  }
  if (stats.logoUnresolvedSamples.length) {
    console.log(`[enrich-etcareers] unresolved-logo samples ${JSON.stringify(stats.logoUnresolvedSamples)}`);
  }
  if (logoResolutionNotes.length) {
    console.log(`[enrich-etcareers] logo resolution notes ${JSON.stringify(logoResolutionNotes)}`);
  }
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
