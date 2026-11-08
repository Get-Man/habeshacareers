import { spawnSync } from "node:child_process";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const hasDb = !!(process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED);
if (hasDb) {
  run("node", ["scripts/migrate.mjs"]);
} else {
  console.log("[build] No database URL env var found; skipping migrations. Set DATABASE_URL or connect Neon/Vercel integration and redeploy.");
}
