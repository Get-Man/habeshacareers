import { spawnSync } from "node:child_process";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// A step that must never fail the deployment.
const runSoft = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) console.warn(`[build] "${args.join(" ")}" exited with ${r.status}; continuing.`);
};

const hasDb = !!(process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED);
if (hasDb) {
  run("node", ["scripts/migrate.mjs"]);
  // Fill ETcareers identity, logos, descriptions and direct apply links from
  // the public feed. Zero page visits, idempotent, and fail-safe.
  runSoft("node", ["scripts/enrich-etcareers.mjs"]);
  // Resolve the employers' own websites, careers pages and official logos.
  // Runs after enrichment so freshly recovered apply URLs and application
  // emails can reveal the employer's own domain. Bounded and fail-safe.
  runSoft("node", ["scripts/employer-backfill.mjs", "--limit=200", "--budget=480"]);
} else {
  console.log("[build] No database URL env var found; skipping migrations. Set DATABASE_URL or connect Neon/Vercel integration and redeploy.");
}
