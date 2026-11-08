import { spawnSync } from "node:child_process";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (process.env.DATABASE_URL) {
  run("node", ["scripts/migrate.mjs"]);
} else {
  console.log("[build] DATABASE_URL not set; skipping migrations (static site will still deploy). Set DATABASE_URL in Vercel and redeploy.");
}
