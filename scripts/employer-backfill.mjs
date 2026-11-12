// Employer identity + official logo backfill.
//
// Resolves, for every organisation in the employer directory, its own
// website, its own careers page and its official logo, so that every
// vacancy of that organisation shows the same employer identity and a real
// Apply button.
//
// The run is bounded and resumable, and it never fails the build: a network
// hiccup or an unreachable site only means that organisation is tried again
// on the next run.
//
//   node scripts/employer-backfill.mjs [--limit=25] [--no-careers]

import { backfillEmployerIdentities, relinkListingsToEmployers } from "../lib/jobs/employer-backfill.mjs";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const limit = Math.min(200, Math.max(1, parseInt(argValue("limit", "25"), 10) || 25));
const withCareers = !hasFlag("no-careers");
const budgetMs = Math.min(600000, Math.max(0, parseInt(argValue("budget", "120"), 10) || 0)) * 1000;

async function main() {
  const linked = await relinkListingsToEmployers().catch(() => 0);
  if (linked) console.log(`[employer-backfill] linked ${linked} listings to their organisation`);

  const out = await backfillEmployerIdentities({ limit, withCareers, budgetMs });
  console.log(
    `[employer-backfill] processed ${out.processed} organisation(s): ` +
      `${out.withDomain} with a website, ${out.withLogo} with an official logo, ` +
      `${out.withCareers} with a careers page, ${out.errors} error(s)` +
      (out.skipped ? `, ${out.skipped} left for the next run` : "")
  );
  for (const row of out.results) {
    if (row.error) console.log(`  ! ${row.name}: ${row.error}`);
    else if (row.domain) console.log(`  + ${row.name} -> ${row.domain}${row.logo ? " (logo)" : ""}${row.careersUrl ? " (careers)" : ""}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // The backfill must never break a deployment.
    console.error("[employer-backfill] failed:", e && e.message ? e.message : e);
    process.exit(0);
  });
