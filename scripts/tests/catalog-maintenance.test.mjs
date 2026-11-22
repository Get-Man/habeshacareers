// Catalog maintenance: expiry, UN source list, and the repaired collectors.
// Pure unit tests: no network and no database.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { discoverSource, getAdapter, listAdapterKeys } from "../../lib/jobs/sources/adapters.mjs";
import { toVerificationStatus } from "../../lib/jobs/extract/validate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const ADDIS_URL =
  "https://careers.un.org/jobopening?language=en&data=%257B%2522ds%2522:%255B%2522ADDISABABA%2522%255D%257D";

test("the Addis Ababa careers.un.org source has a registered RSS adapter", () => {
  const adapter = getAdapter({ adapter_key: "un-careers-addisababa" });
  assert.ok(adapter, "expected the Addis Ababa UN careers adapter");
  assert.equal(adapter.key, "un-careers-addisababa");
  assert.ok(listAdapterKeys().includes("un-careers-addisababa"));
  assert.ok(getAdapter({ slug: "careers-un-addisababa" }));
});

test("Addis Ababa discovery reads the official feed and keeps only local duty stations", async () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Programme Officer</title>
      <link>https://careers.un.org/jobSearchDescription/287216?language=en</link>
      <guid>https://careers.un.org/jobSearchDescription/287216?language=en</guid>
      <description>Duty Station : ADDIS ABABA</description></item>
    <item><title>Programme Officer</title>
      <link>https://careers.un.org/jobSearchDescription/287217?language=en</link>
      <guid>https://careers.un.org/jobSearchDescription/287217?language=en</guid>
      <description>Duty Station : NEW YORK</description></item>
  </channel></rss>`;
  const fetched = [];
  const result = await discoverSource(
    {
      adapter_key: "un-careers-addisababa",
      fetch_config: { feedUrl: "https://careers.un.org/jobfeed", keywordPattern: "ADDIS ABABA", limit: 10 },
    },
    {
      limit: 10,
      fetchText: async (url) => {
        fetched.push(url);
        return { ok: true, status: 200, text: xml, url };
      },
    }
  );
  assert.deepEqual(fetched, ["https://careers.un.org/jobfeed"]);
  assert.equal(result.mode, "rss");
  assert.equal(result.adapter, "un-careers-addisababa");
  assert.deepEqual(
    result.urls.map((u) => u.url),
    ["https://careers.un.org/jobSearchDescription/287216?language=en"]
  );
});

test("the migration records the exact requested URL and repairs the source list", () => {
  const sql = read("migrations/034_catalog_maintenance.sql");
  assert.ok(sql.includes(ADDIS_URL), "the exact Addis Ababa job-opening URL must be registered");
  assert.match(sql, /'careers-un-addisababa'/);
  assert.match(sql, /slug in \('un-ethiopia', 'un-org', 'un'\)/);
  assert.match(sql, /where slug = 'ethiojobs'/);
  assert.match(sql, /where slug = 'dereja'/);
  assert.match(sql, /enabled = true[\s\S]*where slug = 'dereja'/);
  assert.match(sql, /enabled = true[\s\S]*where slug = 'ethiojobs'/);
  assert.match(sql, /deadline < current_date/);
});

test("expired is a stable public verification label", () => {
  assert.equal(
    toVerificationStatus({ status: "expired", extractionStatus: "verified" }),
    "expired"
  );
  assert.equal(
    toVerificationStatus({ jobStatus: "expired", extractionStatus: "verified" }),
    "expired"
  );
});

test("every public surface applies the expiry visibility boundary", () => {
  const view = read("migrations/017_scrub_source_attribution.sql");
  assert.match(view, /l\.deadline >= current_date/);
  assert.match(view, /l\.job_status not in \('expired', 'unavailable'\)/);

  const apply = read("api/apply.js");
  assert.match(apply, /from public_job_listings l/);

  const categories = read("api/jobs/categories.js");
  assert.match(categories, /left join public_job_listings l/);
  assert.doesNotMatch(categories, /left join job_listings l/);

  const cronDispatcher = read("api/cron/[...path].js");
  assert.match(cronDispatcher, /"expire-jobs": expireJobs/);
  for (const file of [
    "api/_lib/handlers/cron/expire-jobs.mjs",
    "api/_lib/handlers/cron/sync-jobs.mjs",
    "api/_lib/handlers/cron/extract-jobs.mjs",
  ]) {
    assert.match(read(file), /refreshJobLifecycle\(\)/, `${file} must run the expiry sweep`);
  }
});

test("Dereja detail extraction falls back to the public listing payload", () => {
  const engine = read("lib/jobs/extract/engine.mjs");
  assert.match(engine, /derejaListingRecords/);
  assert.match(engine, /listingPageUrl/);
  assert.match(engine, /headers: \{ RSC: "1"/);
});
