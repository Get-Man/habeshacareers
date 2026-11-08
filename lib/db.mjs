import pg from "pg";

const { Pool } = pg;

let pool;

function resolveDatabaseUrl() {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL, // Vercel/Neon pooled (works with pg in many setups)
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL_UNPOOLED,
  ];
  for (const v of candidates) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

export function hasDatabase() {
  return Boolean(resolveDatabaseUrl());
}

export function getPool() {
  const connectionString = resolveDatabaseUrl();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
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
