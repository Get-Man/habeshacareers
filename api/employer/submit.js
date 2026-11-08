import { json, parseJsonBody, sanitizeText } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import { createDirectSubmission } from "../../lib/jobs/repository.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable", message: "Employer submissions require database configuration." });
  try {
    const body = await parseJsonBody(req);
    const payload = {
      title: sanitizeText(body.title, 300),
      company: sanitizeText(body.company, 200),
      category: sanitizeText(body.category, 120),
      jobType: sanitizeText(body.jobType || body.type, 80),
      location: sanitizeText(body.location, 200),
      vacancies: body.vacancies,
      description: sanitizeText(body.description, 20000),
      requirements: sanitizeText(body.requirements, 20000),
      deadline: body.deadline || null,
      contactEmail: sanitizeText(body.contactEmail, 200),
    };
    if (!payload.title || !payload.company || !payload.description) return json(res, 400, { ok: false, error: "validation", message: "Title, company, and description are required." });
    const sub = await createDirectSubmission(payload, { email: payload.contactEmail, userRef: sanitizeText(body.submitterRef, 200) });
    return json(res, 200, { ok: true, submission: sub, message: "Submission received and pending administrator approval." });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
