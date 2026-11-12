import { json, parseJsonBody, sanitizeText } from "../_lib/http.js";
import { hasDatabase } from "../../lib/db.mjs";
import { createDirectSubmission } from "../../lib/jobs/repository.mjs";
import { getUserFromRequest } from "../../lib/auth.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });
  if (!hasDatabase()) return json(res, 503, { ok: false, error: "db_unavailable", message: "Employer submissions require database configuration." });
  try {
    const authUser = await getUserFromRequest(req).catch(() => null);
    if (!authUser) return json(res, 401, { ok: false, error: "unauthorized", message: "Please log in as an employer to submit a job." });
    if (authUser.role !== "employer" && authUser.role !== "admin") {
      return json(res, 403, { ok: false, error: "forbidden", message: "Only employer accounts can post jobs." });
    }

    const body = await parseJsonBody(req);
    const companyFallback = authUser.company_name || authUser.companyName || authUser.name || null;
    const emailFallback = authUser.email || null;
    const payload = {
      title: sanitizeText(body.title, 300),
      company: sanitizeText(body.company || companyFallback, 200),
      category: sanitizeText(body.category, 120),
      jobType: sanitizeText(body.jobType || body.type, 80),
      location: sanitizeText(body.location, 200),
      vacancies: body.vacancies,
      description: sanitizeText(body.description, 20000),
      requirements: sanitizeText(body.requirements, 20000),
      deadline: body.deadline || null,
      contactEmail: sanitizeText(body.contactEmail || emailFallback, 200),
    };
    if (!payload.title || !payload.company || !payload.description) {
      return json(res, 400, { ok: false, error: "validation", message: "Title, company, and description are required." });
    }
    const row = await createDirectSubmission(payload, {
      email: authUser.email || payload.contactEmail,
      userRef: String(authUser.id || authUser.email || body.submitterRef || ""),
    });
    return json(res, 201, { ok: true, id: row.id, status: row.approval_status, message: "Vacancy submitted for admin approval." });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}
