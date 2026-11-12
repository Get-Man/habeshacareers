#!/usr/bin/env node
import process from "node:process";
import { hasDatabase } from "../lib/db.mjs";
import { createUser, findUserByEmail, hashPassword, isValidEmail, normalizeEmail } from "../lib/auth.mjs";
import { query } from "../lib/db.mjs";

async function main() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL || process.argv[2] || "");
  const password = String(process.env.ADMIN_PASSWORD || process.argv[3] || "");
  if (!hasDatabase()) {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }
  if (!isValidEmail(email) || password.length < 8) {
    console.error("Usage: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='StrongPass123' node scripts/create-admin.mjs");
    process.exit(1);
  }
  const existing = await findUserByEmail(email);
  if (existing) {
    const passwordHash = await hashPassword(password);
    await query(
      `update users set password_hash=$2, role='admin', is_active=true, name=coalesce(name,'Administrator'), updated_at=now() where id=$1`,
      [existing.id, passwordHash]
    );
    console.log(`Updated existing user as admin: ${email}`);
    return;
  }
  await createUser({ email, password, role: "admin", name: "Administrator" });
  console.log(`Created admin user: ${email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
