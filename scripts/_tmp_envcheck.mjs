// TEMP: env sanity check (booleans only; never prints values)
import fs from "node:fs";
const text = fs.readFileSync(".env.local", "utf8");
const lines = text.split(/\r?\n/);
console.log("totalLines=" + lines.length);
for (let i = 0; i < lines.length; i++) {
  const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(lines[i]);
  if (m && m[1] === "DATABASE_URL") {
    const v = m[2];
    const isPh = v.includes("[SENSITIVE]") || v.trim() === "";
    console.log(
      `line=${i + 1} real=${!isPh} len=${v.length} startsPostgres=${/^(postgres|postgresql):\/\//.test(v)} pooledHost=${/pooler/i.test(v)} sslmode=${(/^postgres(ql)?:\/\/.*[?&]sslmode=([^&\s]+)/i.exec(v) || [])[2] || "none"}`
    );
  }
}
for (const [k, v] of Object.entries(Object.fromEntries(lines.map((l) => [/^([A-Za-z0-9_]+)=(.*)$/.exec(l) || [], null].slice(0, 1).map((mm) => [mm ? mm[1] : "", mm ? mm[2] : ""]))))) {
  if (/^[A-Za-z0-9_]+$/.test(k) === false) delete process.env[k];
}
for (const line of lines) {
  const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].includes("[SENSITIVE]") ? "" : m[2];
}
const { hasDatabase, query } = await import("../lib/db.mjs");
console.log("hasDatabase=" + hasDatabase());
try {
  const r = await query("select count(*)::int as n from job_sources");
  console.log("DB CONNECT OK, job_sources rows=" + r[0].n);
} catch (e) {
  console.log("DB CONNECT FAIL: " + String(e.message || e).slice(0, 140));
  process.exit(1);
}
