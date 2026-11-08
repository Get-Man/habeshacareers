import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, hasDatabase } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

async function main() {
  if (!hasDatabase()) {
    console.log("DATABASE_URL not set; skipping migrations.");
    return;
  }
  const pool = getPool();
  await pool.query(`create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await pool.query("select name from _migrations")).rows.map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log("Applying", file);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  console.log("Migrations complete.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
