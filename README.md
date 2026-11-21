# Habesha Careers

A job portal for Ethiopia and the Horn of Africa. Real vacancies are discovered from
documented public sources, verified where possible, and published with a clear
`verified` / `partially_verified` / `needs_review` / `expired` label.

Live site: https://habeshacareers.vercel.app

## What is in this repository

- **Ten HTML pages** — a single shared shell with one stylesheet and one JS runtime.
  `index.html`, `jobs.html`, `job-details.html`, `login.html`, `dashboard.html`,
  `account.html`, `post-job.html`, `admin.html`, `about.html`, `contact.html`.
- **`css/app.css`** — the only stylesheet: design tokens, components, responsive
  breakpoints at 1024/860/640/420px, print and reduced-motion styles.
- **`js/app.js`** — the shared runtime: server-verified sessions, injected header and
  footer, role guards, toasts, API client, job cards and company-logo fallbacks.
- **`js/pages.js`** — one controller per page: search/filter/sort/pagination, job
  details, sign-in and registration, password reset, dashboards, profile and CV
  builder, job submission and the admin console.
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
password change, password reset by email webhook, and a session list with
"sign out everywhere".

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

The site is static HTML plus serverless functions; there is no bundler step. Deploying
to Vercel runs `scripts/vercel-build.mjs`, which applies pending migrations when a
database URL is configured.

## Environment

Database and auth credentials are injected by the platform. Optional settings:
`PUBLIC_SITE_URL`, `SYNC_TOKEN`, `CRON_SECRET`, `ADMIN_API_KEY`,
`EMAIL_WEBHOOK_URL` (receives `{ to, resetUrl }` for password resets),
`INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`.

## License

© Habesha Careers. All rights reserved.
