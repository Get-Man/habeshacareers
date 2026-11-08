# Habesha Careers — Job Aggregator Integration (Implementation Notes)

## What was added (additive)
- **Backend/API (Vercel serverless, Node ESM):** `api/jobs/*` public read endpoints, `api/employer/submit`, `api/admin/*` (stats/sources/runs/jobs/submissions/sync), `api/cron/sync-jobs` (secured, batched).
- **Database:** Neon/Postgres schema in `migrations/001_job_aggregator.sql` (sources, listings, source refs, categories, sync runs, employer submissions, merge queue). Migration runner: `scripts/migrate.mjs`.
- **Aggregator engine:** `lib/jobs/*` normalization/dedup/classification/expiry/repository/sync; modular connectors in `lib/jobs/connectors/`.
- **Frontend integration (existing HTML preserved):** `js/data.js` now fetches `/api/jobs` with fallback to existing localStorage/sample data; `jobs.js`/`main.js`/`job-details.js` updated to display DB-backed jobs, aggregated/direct badges, and **original application URL** for aggregated vacancies. `post-job.js` submits to `/api/employer/submit` (pending admin approval) with local fallback.
- **Admin:** `admin.html` + `js/admin.js` for stats, source management, manual sync, runs, employer submission approval/rejection, job moderation/feature/archive.

## Required environment variables (Vercel/GitHub secrets — never in frontend)
- `DATABASE_URL` (Neon PostgreSQL)
- `ADMIN_API_KEY` (protects admin APIs/UI actions)
- `CRON_SECRET` (protects `/api/cron/sync-jobs`; Vercel Cron can send `Authorization: Bearer <CRON_SECRET>`)
- optional `PUBLIC_SITE_URL`

## Deployment
1. Set env vars in Vercel project `habeshacareers`.
2. Deploy (build runs `scripts/vercel-build.mjs`; migrations run when `DATABASE_URL` is set).
3. Open `admin.html`, enter `ADMIN_API_KEY`, verify sources/stats.
4. Enable/test sources one by one. **Do not mark connected until tested.**

## Source status (important)
- Sources are seeded **disabled/pending** (or unsupported where access is restricted).
- **Implemented/testable connector (code-level):** `reliefweb-ethiopia` via public RSS. It is **not enabled by default** and has **not** been executed against a configured production DB in this environment because `DATABASE_URL` was not set here.
- **Indeed Ethiopia:** marked `unsupported` (commercial board; automated access commonly restricted) — use authorized API/partnership/manual import.
- **Other Ethiopian/NGO boards:** require per-source verification of `robots.txt`, ToS, rate limits, and permitted extraction/API/RSS before enabling. Connectors should be added only when lawful/feasible.

## Current limitations / next steps
- Existing auth is client-side localStorage (demo). Admin/employer server-side role validation should be unified with a secure auth provider/Neon-backed users; `ADMIN_API_KEY` is a pragmatic protection for admin APIs now.
- Some requested fields (salary/skills/education parsed from arbitrary pages) depend on source structure and may be null; missing info is never invented.
- Full-text search/filter performance can be improved with dedicated indexes/FTS tuning as data grows.
- File uploads (CV) are not wired to server storage yet.
- Live source integration testing requires valid `DATABASE_URL`, deployed API, and per-source permission checks.
