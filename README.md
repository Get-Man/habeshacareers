# Habesha Careers

A job portal for Ethiopia and the Horn of Africa. Real vacancies are discovered from
documented public sources, verified where possible, and published with a clear
`verified` / `partially_verified` / `needs_review` / `expired` label.

Live site: https://habeshacareers.vercel.app

## What is in this repository

This repository is the **API and content backend only**. The former static frontend has
been removed; all public pages, account pages and the admin console live in the separate
React app at https://habeshacareers.vercel.app.

- **`api/`** — Vercel serverless endpoints (auth, account, employer, admin, jobs,
  sitemap). Catch-all functions keep the deployment within the Hobby function cap.
- **`lib/`** — database, auth, job repository and the two-stage discovery/extraction
  engine.
- **`migrations/`** — PostgreSQL schema, including source monitoring and the account
  suite.
- **`scripts/`** — migrations, sync/extract jobs and the smoke test suite.

## Accounts

Public registration creates `employee` or `employer` accounts only. Administrators are
provisioned outside the site (bootstrap environment variables or
`node scripts/create-admin.mjs`) and sign in through the normal login page.

Signed-in users get role dashboards, editable profiles, a structured profile/CV builder,
password change, password reset by email webhook, saved jobs, and a session list with
"sign out everywhere" — all inside the React app.

## Job sources

Enabled discovery adapters: `srafelagi`, `aradajobs`, `un-careers-ethiopia`.
Source URLs are stored on every listing; duplicates update the canonical record and
attach the new source. Expired listings are marked `expired` rather than deleted.
The admin console's **Source monitoring** tab shows:
`Source | Status | Last Fetch | Jobs Found | New Jobs | Updated | Errors`.

## Local development

```bash
npm install
npm run db:migrate      # requires a DATABASE_URL / POSTGRES_URL
npm run sync:once       # discover and extract jobs once
npm run test:smoke      # 122 assertions
```

There is no frontend bundler step here. Deploying to Vercel runs
`scripts/vercel-build.mjs`, which applies pending migrations when a database URL is
configured. The React frontend owns the browser-facing routes and proxies `/api/*` to
this host, so the httpOnly session cookie remains same-site.

## Environment

Database and auth credentials are injected by the platform. Optional settings:
`PUBLIC_SITE_URL`, `SYNC_TOKEN`, `CRON_SECRET`, `ADMIN_API_KEY`,
`EMAIL_WEBHOOK_URL` (receives `{ to, resetUrl }` for password resets),
`INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`.

## License

© Habesha Careers. All rights reserved.
