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
  // Resolve the employers' own websites, careers pages and official logos.
  // Bounded and fail-safe: it never fails the deployment.
  runSoft("node", ["scripts/employer-backfill.mjs", "--limit=25"]);
} else {
  console.log("[build] No database URL env var found; skipping migrations. Set DATABASE_URL or connect Neon/Vercel integration and redeploy.");
}
