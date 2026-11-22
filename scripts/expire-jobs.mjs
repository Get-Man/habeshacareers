// Deploy-time expiry sweep.
//
// Marks every vacancy whose application deadline has passed as expired so the
// public catalogue hides it immediately, for ETCareers and every other source.
// Idempotent and fail-soft: it never fails a deployment.

import { hasDatabase } from "../lib/db.mjs";
import { refreshJobLifecycle } from "../lib/jobs/extract/engine.mjs";

if (!hasDatabase()) {
  console.log("[expire-jobs] no database configured; skipping expiry sweep.");
  process.exit(0);
}

try {
  const out = await refreshJobLifecycle();
  console.log(
    `[expire-jobs] expired ${out.expired} | unavailable ${out.unavailable} | stale ${out.stale}`
  );
  process.exit(0);
} catch (e) {
  console.warn(`[expire-jobs] sweep failed; the scheduled sweep will retry: ${e?.message || e}`);
  process.exit(0);
}
