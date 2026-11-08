import { syncEnabledSources, syncSourceBySlug } from "../lib/jobs/sync.mjs";
import { hasDatabase } from "../lib/db.mjs";

if (!hasDatabase()) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const slug = process.argv[2];
const out = slug ? await syncSourceBySlug(slug, "manual") : await syncEnabledSources("manual", 10);
console.log(JSON.stringify(out, null, 2));
process.exit(0);
