import pg from "pg";

const { Pool } = pg;

let pool;

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());
}

export function getPool() {
  if (!hasDatabase()) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    const connectionString = process.env.DATABASE_URL.trim();
    const needsSsl = /neon\.tech|sslmode=require/i.test(connectionString) || process.env.PGSSLMODE === "require";
    pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
  return pool;
}

export async function query(text, params = []) {
  const res = await getPool().query(text, params);
  return res.rows;
}

export async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
