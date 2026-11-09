// TEMP: parser re-check after fixes (small polite batches). Delete after use.
import * as ejn from "../lib/jobs/connectors/ethiojobs-net-et.mjs";
import * as etc from "../lib/jobs/connectors/etcareers.mjs";
import * as rj from "../lib/jobs/connectors/ethiopian-reporter.mjs";
import * as aj from "../lib/jobs/connectors/alljobspo.mjs";

const mk = (slug, name, fetch_config) => ({ slug, name, fetch_config });

const CASES = [
  ["ethiojobs-net-et", ejn, mk("ethiojobs-net-et", "EthioJobs ET", { limit: 1, offset: 0, delayMs: 250 })],
  ["etcareers", etc, mk("etcareers", "ET Careers", { limit: 1, offset: 0, delayMs: 250 })],
  ["ethiopian-reporter", rj, mk("ethiopian-reporter", "Ethiopian Reporter Jobs", { limit: 3, offset: 0, delayMs: 300 })],
  ["alljobspo", aj, mk("alljobspo", "Alljobspo", { limit: 3, offset: 1, delayMs: 250 })],
];

for (const [slug, mod, source] of CASES) {
  console.log(`\n===== ${slug} =====`);
  try {
    const jobs = await mod.fetchJobs(source);
    console.log("progress:", JSON.stringify(jobs.progress));
    console.log("count:", jobs.length);
    for (const j of jobs.slice(0, 3)) {
      console.log(`- title=${j.title} | company=${j.company} | loc=${j.location} | type=${j.job_type} | posted=${j.posted_date} | deadline=${j.deadline} | email=${j.contact_email}${j.salary ? ` | salary=${j.salary}` : ""}${j.education ? ` | edu=${j.education}` : ""}`);
      console.log(`  url=${j.original_url}`);
      console.log(`  descLen=${(j.description || "").length} ${(j.description || "").slice(0, 220).replace(/\s+/g, " ")}`);
      console.log(`  req=${(j.requirements || "").slice(0, 80).replace(/\s+/g, " ")}`);
    }
  } catch (e) {
    console.log("ERROR:", String(e && e.message || e));
  }
}
