import { query, withClient } from "../db.mjs";
import { cleanText, dedupHash, excerpt, guessCategory, isExpired, legacyKey, logoFromUrl, mapCategoryToFrontend, norm, orgLogoUrl, toDate } from "./utils.mjs";
import { classifyText, loadCategories } from "./classify.mjs";

export function toFrontendJob(row) {
  const deadline = row.deadline ? new Date(row.deadline).toISOString().slice(0, 10) : null;
  const posted = row.posted_date ? new Date(row.posted_date).toISOString().slice(0, 10) : (row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : null);
  const req = cleanText(row.requirements, 50000);
  const isReqMissing = !req || /^see (the )?(original|source|official).{0,80}(for|to).{0,40}(full )?(requirements|details|qualifications)/i.test(req);
  return {
    id: Number(row.id),
    title: row.title,
    company: row.company,
    logo: row.logo || null,
    category: row.category || "Business and Management",
    location: row.location || row.region_city || null,
    type: row.job_type || "Full-time / Permanent",
    vacancies: row.vacancies || 1,
    postedDate: posted,
    deadline,
    description: row.description || row.description_excerpt || "",
    requirements: isReqMissing ? null : req,
    requirementsMissing: isReqMissing,
    contactEmail: row.contact_email || null,
    originalUrl: row.original_url || null,
    applicationInstructions: row.application_instructions || null,
    sourceName: row.source_name || null,
    sourceSlug: row.source_slug || null,
    origin: row.origin,
    status: row.status,
    featured: !!row.featured,
    educationRequirements: row.education_requirements || null,
    experienceRequirements: row.experience_requirements || null,
    requiredSkills: Array.isArray(row.required_skills) ? row.required_skills : [],
    salary: row.salary || null,
    regionCity: row.region_city || null,
    lastVerifiedAt: row.last_verified_at || null,
  };
}

export async function listPublicJobs(params = {}) {
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit || "20", 10) || 20));
  const offset = (page - 1) * limit;
  const where = [`l.status = 'active'`, `(l.deadline is null or l.deadline >= current_date)`];
  const vals = [];
  const p = (v) => { vals.push(v); return `$${vals.length}`; };

  if (params.q) {
    const q = String(params.q).trim();
    where.push(`(to_tsvector('simple', coalesce(l.title,'')||' '||coalesce(l.company,'')||' '||coalesce(l.description,'')||' '||coalesce(l.requirements,'')||' '||coalesce(l.location,'')) @@ plainto_tsquery('simple', ${p(q)}) or lower(l.title) like ${p(`%${q.toLowerCase()}%`)} or lower(l.company) like ${p(`%${q.toLowerCase()}%`)})`);
  }
  if (params.category) where.push(`(l.category = ${p(params.category)} or exists (select 1 from job_listing_categories jlc join job_categories jc on jc.id=jlc.category_id where jlc.listing_id=l.id and jc.name=${p(params.category)}))`);
  if (params.location) where.push(`lower(coalesce(l.region_city,l.location,'')) = lower(${p(params.location)})`);
  if (params.type) where.push(`l.job_type = ${p(params.type)}`);
  if (params.origin) where.push(`l.origin = ${p(params.origin)}`);
  if (params.source) where.push(`s.slug = ${p(params.source)}`);
  if (params.featured === "true" || params.featured === true) where.push(`l.featured = true`);
  if (params.organization) where.push(`lower(l.company) like ${p(`%${String(params.organization).toLowerCase()}%`)}`);
  if (params.postedFrom) where.push(`l.posted_date >= ${p(params.postedFrom)}::date`);
  if (params.deadlineTo) where.push(`l.deadline <= ${p(params.deadlineTo)}::date`);

  const sort = params.sort === "deadline" ? `l.deadline asc nulls last, l.posted_date desc nulls last` : `l.posted_date desc nulls last, l.created_at desc`;
  const base = `from job_listings l left join job_sources s on s.id=l.primary_source_id where ${where.join(" and ")}`;
  const countRows = await query(`select count(*)::int as total ${base}`, vals);
  const rows = await query(`select l.*, s.name as source_name, s.slug as source_slug ${base} order by l.featured desc, ${sort} limit ${p(limit)} offset ${p(offset)}`, vals);
  return { total: countRows[0]?.total || 0, page, limit, jobs: rows.map(toFrontendJob) };
}

export async function getPublicJobById(id) {
  const rows = await query(`select l.*, s.name as source_name, s.slug as source_slug from job_listings l left join job_sources s on s.id=l.primary_source_id where l.id=$1 and l.status in ('active','pending','expired')`, [id]);
  return rows[0] ? toFrontendJob(rows[0]) : null;
}

export async function upsertAggregatedJob(source, raw) {
  const categories = await loadCategories();
  const url = raw.original_url || raw.url || raw.link;
  const title = String(raw.title || "").trim();
  const company = String(raw.company || raw.organization || "Unknown organization").trim();
  if (!title || !url) return { action: "skipped", reason: "missing_title_or_url" };

  const key = legacyKey(source.slug, raw.external_id, url);
  const descRaw = cleanText(raw.description, 50000) || null;
  const reqRaw = cleanText(raw.requirements, 30000) || null;
  const appRaw = cleanText(raw.application_instructions, 10000) || null;
  const text = [title, company, descRaw, reqRaw, raw.location, raw.category].filter(Boolean).join(" ");
  const matchedCats = classifyText(text, categories);
  const frontendCategory = raw.category_frontend || guessCategory({ title, company, description: descRaw || "", requirements: reqRaw || "", location: raw.location || "", rawCategory: raw.category || "", matchedCategories: matchedCats });
  const deadline = toDate(raw.deadline);
  const posted = toDate(raw.posted_date || raw.postedDate) || new Date().toISOString().slice(0, 10);
  const status = isExpired(deadline) ? "expired" : "active";
  const hash = dedupHash({ title, company, location: raw.location, deadline, original_url: url });
  // Never use aggregator favicons (e.g. Ethiojobs/GeezJobs) as the organization's logo.
  const logo = raw.logo || orgLogoUrl(company) || logoFromUrl(url, { allowAggregator: false }) || null;
  const location = raw.location || raw.region_city || null;
  const regionCity = raw.region_city || raw.location || null;
  const jobType = raw.job_type || raw.type || "Full-time / Permanent";
  const vacancies = raw.vacancies ? (parseInt(raw.vacancies, 10) || null) : null;
  const education = cleanText(raw.education, 10000);
  const experience = cleanText(raw.experience, 10000);
  const skills = Array.isArray(raw.skills) ? raw.skills.map(s => cleanText(s, 200)).filter(Boolean) : [];
  const salary = cleanText(raw.salary, 500);
  const rawPayload = JSON.stringify(raw);

  return withClient(async (client) => {
    // duplicate by stable key
    if (key) {
      const existing = await client.query("select id from job_listings where legacy_external_key=$1", [key]);
      if (existing.rows[0]) {
        const orgLogo = orgLogoUrl(company);
        await client.query(`update job_listings set
          title=$2, company=$3, logo=case
            when $4::text is not null and $4::text <> '' and $4::text !~* '(geezjobs\.com|ethiojobs\.net|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|workethiopia\.net|srazone\.et|ethiopianreporterjobs\.com|reliefweb\.int|unjobs\.org)' then $4::text
            when $23::text is not null and $23::text <> '' and (logo is null or logo = '' or logo ~* '(geezjobs\.com|ethiojobs\.net|hahu\.jobs|dereja\.com|ezega\.com|jobwebethiopia\.com|ngojobs\.et|workethiopia\.net|srazone\.et|ethiopianreporterjobs\.com|reliefweb\.int|unjobs\.org)') then $23::text
            when logo is null or logo = '' then $23::text
            else logo
          end, category=$5, location=$6, region_city=$7, job_type=$8,
          vacancies=coalesce($9,vacancies), education_requirements=coalesce($10::text,education_requirements),
          experience_requirements=coalesce($11::text,experience_requirements), required_skills=case when coalesce($12::text[],'{}'::text[]) <> '{}'::text[] then $12::text[] else required_skills end,
          salary=coalesce($13::text,salary), posted_date=coalesce($14::date,posted_date), deadline=$15::date,
          description=case
            when $16::text is not null and coalesce(description,'') ~* '(Powered by Greenhouse|indicates a required field|Autofill my application|Submit application|workethiopia\.net does not collect applications|We use Google Analytics cookies|Related open jobs\s*$)' then $16::text
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
          [existing.rows[0].id, title, company, logo, frontendCategory, location, regionCity, jobType, vacancies, education, experience, skills, salary, posted, deadline, descRaw, excerpt(descRaw), reqRaw, appRaw, raw.contact_email || null, url, rawPayload, orgLogo]);
        await client.query(`insert into job_listing_sources (listing_id, source_id, external_id, source_url, last_verified_at, is_primary) values ($1,$2,$3,$4,now(),true) on conflict (source_id, source_url) do update set last_verified_at=now(), external_id=coalesce(excluded.external_id, job_listing_sources.external_id)`,
          [existing.rows[0].id, source.id, raw.external_id || null, url]);
        return { action: "updated", id: existing.rows[0].id };
      }
    }
    // duplicate by URL
    const byUrl = await client.query("select l.id from job_listing_sources jls join job_listings l on l.id=jls.listing_id where jls.source_url=$1 limit 1", [url]);
    if (byUrl.rows[0]) return { action: "duplicate", id: byUrl.rows[0].id };

    // cross-source dedup (e.g. same vacancy posted on Ethiojobs and GeezJobs with different URLs):
    // match conservatively on normalized title + company + deadline to avoid showing duplicates.
    const normTitle = norm(title);
    const normCompany = norm(company);
    if (normTitle.length >= 12 && normCompany.length >= 2) {
      const byContent = await client.query(
        `select l.id, l.original_url from job_listings l
          where l.status in ('active','pending','expired')
            and l.normalized_title = $1
            and lower(regexp_replace(coalesce(l.company,''), '\s+', ' ', 'g')) = lower(regexp_replace($2, '\s+', ' ', 'g'))
            and (($3::date is null and l.deadline is null) or l.deadline = $3::date)
            and not exists (select 1 from job_listing_sources jls where jls.listing_id = l.id and jls.source_id = $4 and jls.source_url = $5)
          order by (case when l.status='active' then 0 else 1 end), l.id desc limit 1`,
        [normTitle, company, deadline, source.id, url]
      );
      if (byContent.rows[0]) {
        // Prefer a direct employer/application URL over an aggregator listing URL when available.
        const existingUrl = String(byContent.rows[0].original_url || "");
        const aggHost = /(^|\.)geezjobs\.com$|(^|\.)ethiojobs\.net$|(^|\.)hahu\.jobs$|(^|\.)dereja\.com$|(^|\.)ezega\.com$|(^|\.)jobwebethiopia\.com$|(^|\.)ngojobs\.et$|(^|\.)workethiopia\.net$|(^|\.)srazone\.et$|(^|\.)ethiopianreporterjobs\.com$|(^|\.)reliefweb\.int$|(^|\.)unjobs\.org$/i;
        let existingHost = ""; let incomingHost = "";
        try { existingHost = new URL(existingUrl).hostname; } catch {}
        try { incomingHost = new URL(url).hostname; } catch {}
        const incomingBetter = !!incomingHost && !aggHost.test(incomingHost) && (!existingHost || aggHost.test(existingHost));
        if (incomingBetter) {
          await client.query(`update job_listings set original_url=$2, application_instructions=coalesce($3::text, application_instructions), last_verified_at=now(), updated_at=now() where id=$1`,
            [byContent.rows[0].id, url, cleanText(raw.application_instructions, 10000)]).catch(() => null);
        }
        await client.query(`insert into job_listing_sources (listing_id, source_id, external_id, source_url, last_verified_at, is_primary) values ($1,$2,$3,$4,now(),$5) on conflict (source_id, source_url) do update set last_verified_at=now(), external_id=coalesce(excluded.external_id, job_listing_sources.external_id)`,
          [byContent.rows[0].id, source.id, raw.external_id || null, url, incomingBetter]);
        if (incomingBetter) {
          await client.query(`update job_listing_sources set is_primary = (source_url = $2) where listing_id = $1`, [byContent.rows[0].id, url]).catch(() => null);
        }
        await client.query(`insert into job_merge_queue (candidate_listing_id, existing_listing_id, reason, confidence, status) values (null,$1,$2,92,'dismissed')`,
          [byContent.rows[0].id, `Cross-source duplicate attached (${source.name}): ${title}`]).catch(() => null);
        return { action: "duplicate", id: byContent.rows[0].id, crossSource: true };
      }
    }

    // uncertain duplicate detection by hash -> queue, do not auto-merge
    const byHash = await client.query("select id from job_listings where dedup_hash=$1 and status in ('active','pending') limit 1", [hash]);
    if (byHash.rows[0]) {
      await client.query(`insert into job_listing_sources (listing_id, source_id, external_id, source_url, last_verified_at, is_primary) values ($1,$2,$3,$4,now(),false) on conflict (source_id, source_url) do nothing`,
        [byHash.rows[0].id, source.id, raw.external_id || null, url]);
      await client.query(`insert into job_merge_queue (candidate_listing_id, existing_listing_id, reason, confidence, status) values (null,$1,$2,85,'pending')`,
        [byHash.rows[0].id, `Likely duplicate incoming vacancy from ${source.name}: ${title}`]).catch(() => null);
      return { action: "duplicate", id: byHash.rows[0].id, queued: true };
    }

    const ins = await client.query(`insert into job_listings
      (legacy_external_key,title,company,logo,category,location,region_city,job_type,vacancies,education_requirements,experience_requirements,required_skills,salary,posted_date,deadline,description,description_excerpt,requirements,application_instructions,contact_email,original_url,primary_source_id,origin,status,normalized_title,dedup_hash,collected_at,last_verified_at,raw_payload)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,$15::date,$16,$17,$18,$19,$20,$21,$22,'aggregated',$23,$24,$25,now(),now(),$26::jsonb)
      returning id`,
      [key, title, company, logo, frontendCategory, location, regionCity, jobType, vacancies, education, experience, skills, salary, posted, deadline, descRaw, excerpt(descRaw), reqRaw, appRaw, raw.contact_email || null, url, source.id, status, norm(title), hash, rawPayload]);
    const id = ins.rows[0].id;
    await client.query(`insert into job_listing_sources (listing_id, source_id, external_id, source_url, last_verified_at, is_primary) values ($1,$2,$3,$4,now(),true) on conflict (source_id, source_url) do nothing`,
      [id, source.id, raw.external_id || null, url]);
    for (const c of matchedCats) {
      await client.query(`insert into job_listing_categories (listing_id, category_id) values ($1,$2) on conflict do nothing`, [id, c.id]);
    }
    return { action: "new", id };
  });
}

export async function markExpiredJobs() {
  const r = await query(`update job_listings set status='expired', updated_at=now() where status='active' and deadline is not null and deadline < current_date`);
  return r?.rowCount ?? 0;
}

export async function getStats() {
  const [totals, today, week, sources, cats] = await Promise.all([
    query(`select
      count(*)::int as total,
      count(*) filter (where status='active' and (deadline is null or deadline >= current_date))::int as active,
      count(*) filter (where status='expired' or (deadline is not null and deadline < current_date))::int as expired,
      count(distinct company)::int as organizations
      from job_listings`),
    query(`select count(*)::int as n from job_listings where created_at >= date_trunc('day', now())`),
    query(`select count(*)::int as n from job_listings where created_at >= now() - interval '7 days'`),
    query(`select count(*)::int as total, count(*) filter (where integration_status='connected')::int as connected, count(*) filter (where integration_status in ('error','degraded','blocked'))::int as failed from job_sources`),
    query(`select coalesce(category,'Other') as category, count(*)::int as n from job_listings where status='active' group by 1 order by n desc limit 20`),
  ]);
  return { totals: totals[0], newToday: today[0]?.n || 0, newThisWeek: week[0]?.n || 0, sources: sources[0], byCategory: cats };
}

export async function listSources() {
  return query(`select * from job_sources order by name`);
}

export async function setSourceEnabled(slug, enabled) {
  return query(`update job_sources set enabled=$2, updated_at=now() where slug=$1 returning *`, [slug, !!enabled]);
}

export async function createSyncRun({ source_id = null, trigger_type = "manual" }) {
  const r = await query(`insert into job_sync_runs (source_id, trigger_type, status) values ($1,$2,'running') returning *`, [source_id, trigger_type]);
  return r[0];
}

export async function finishSyncRun(id, patch) {
  const r = await query(`update job_sync_runs set status=$2, finished_at=now(), fetched_count=$3, new_count=$4, updated_count=$5, duplicate_count=$6, expired_count=$7, error_count=$8, message=$9, details=$10::jsonb where id=$1 returning *`,
    [id, patch.status || "ok", patch.fetched_count||0, patch.new_count||0, patch.updated_count||0, patch.duplicate_count||0, patch.expired_count||0, patch.error_count||0, patch.message||null, JSON.stringify(patch.details||{})]);
  return r[0];
}

export async function listSyncRuns(limit = 50) {
  return query(`select r.*, s.name as source_name, s.slug as source_slug from job_sync_runs r left join job_sources s on s.id=r.source_id order by r.started_at desc limit $1`, [limit]);
}

export async function createDirectSubmission(payload, submitter = {}) {
  const r = await query(`insert into employer_submissions (submitter_user_ref, submitter_email, organization_name, payload, approval_status) values ($1,$2,$3,$4::jsonb,'pending') returning *`,
    [submitter.userRef || null, submitter.email || payload.contactEmail || null, payload.company || null, JSON.stringify(payload)]);
  return r[0];
}

export async function approveSubmission(id, reviewerNote = null) {
  return withClient(async (client) => {
    const sub = await client.query(`select * from employer_submissions where id=$1`, [id]);
    if (!sub.rows[0]) throw new Error("Submission not found");
    const p = sub.rows[0].payload || {};
    const deadline = toDate(p.deadline);
    const ins = await client.query(`insert into job_listings (title,company,category,location,job_type,vacancies,posted_date,deadline,description,requirements,contact_email,origin,status,description_excerpt,last_verified_at)
      values ($1,$2,$3,$4,$5,$6,current_date,$7::date,$8,$9,$10,'direct','active',$11,now()) returning id`,
      [p.title, p.company, p.category||'Business and Management', p.location, p.jobType||p.type, p.vacancies?parseInt(p.vacancies,10):1, deadline, p.description, p.requirements, p.contactEmail, excerpt(p.description)]);
    await client.query(`update employer_submissions set approval_status='approved', listing_id=$2, reviewer_note=$3, updated_at=now() where id=$1`, [id, ins.rows[0].id, reviewerNote]);
    return { submissionId: id, listingId: ins.rows[0].id };
  });
}
