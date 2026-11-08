import crypto from "node:crypto";

export function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9\u1200-\u137f ]/g, "").trim();
}

export function excerpt(text, max = 240) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function dedupHash({ title, company, location, deadline, original_url }) {
  const key = [norm(title), norm(company), norm(location), toDate(deadline) || "", (original_url || "").trim().toLowerCase()].join("|");
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function legacyKey(sourceSlug, externalId, url) {
  if (externalId) return `${sourceSlug}:${externalId}`;
  if (url) return `${sourceSlug}:url:${crypto.createHash("sha1").update(url).digest("hex")}`;
  return null;
}

export function isExpired(deadline) {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0,0,0,0);
  return d < today;
}

const ORG_DOMAINS = [
  { re: /\bunicef\b/i, domain: "unicef.org" },
  { re: /\bundp\b|united nations development programme/i, domain: "undp.org" },
  { re: /\bwho\b|world health organization/i, domain: "who.int" },
  { re: /\bwfp\b|world food programme/i, domain: "wfp.org" },
  { re: /\bunhcr\b|un refugee agency|refugees\b/i, domain: "unhcr.org" },
  { re: /\biom\b|international organization for migration/i, domain: "iom.int" },
  { re: /\bunfpa\b/i, domain: "unfpa.org" },
  { re: /\bun women\b|united nations entity for gender/i, domain: "unwomen.org" },
  { re: /\bfao\b|food and agriculture organization/i, domain: "fao.org" },
  { re: /\bilo\b|international labour organization|international labor organization/i, domain: "ilo.org" },
  { re: /\bunesco\b/i, domain: "unesco.org" },
  { re: /\bunocha\b|\bocha\b|humanitarian affairs/i, domain: "unocha.org" },
  { re: /\bunops\b/i, domain: "unops.org" },
  { re: /\bworld bank\b|\bifc\b/i, domain: "worldbank.org" },
  { re: /\busaid\b/i, domain: "usaid.gov" },
  { re: /\bethiopian airlines\b/i, domain: "ethiopianairlines.com" },
  { re: /\bethio telecom\b|ethiotelecom/i, domain: "ethiotelecom.et" },
  { re: /\bcommercial bank of ethiopia\b|\bcbe\b/i, domain: "combanketh.et" },
  { re: /\bsave the children\b/i, domain: "savethechildren.net" },
  { re: /\bcare\b/i, domain: "care.org" },
  { re: /\bmercy corps\b/i, domain: "mercycorps.org" },
  { re: /\boxfam\b/i, domain: "oxfam.org" },
  { re: /\bplan international\b/i, domain: "plan-international.org" },
  { re: /\bworld vision\b/i, domain: "worldvision.org" },
  { re: /\bgiz\b/i, domain: "giz.de" },
  { re: /\birc\b|international rescue committee/i, domain: "rescue.org" },
  { re: /\bamref\b/i, domain: "amref.org" },
  { re: /\bpath\b/i, domain: "path.org" },
  { re: /\bjhpiego\b/i, domain: "jhpiego.org" },
  { re: /\bfhi 360\b|\bfhi360\b/i, domain: "fhi360.org" },
];

const AGGREGATOR_HOST_RE = /(^|\.)geezjobs\.com$|(^|\.)ethiojobs\.net$|(^|\.)hahu\.jobs$|(^|\.)dereja\.com$|(^|\.)ezega\.com$|(^|\.)jobwebethiopia\.com$|(^|\.)ngojobs\.et$|(^|\.)workethiopia\.net$|(^|\.)srazone\.et$|(^|\.)ethiopianreporterjobs\.com$|(^|\.)reliefweb\.int$|(^|\.)unjobs\.org$/i;

export function orgLogoUrl(company) {
  const name = String(company || "").trim();
  if (!name) return null;
  for (const item of ORG_DOMAINS) {
    if (item.re.test(name)) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(item.domain)}&sz=128`;
  }
  return null;
}

export function logoFromUrl(url, { allowAggregator = true } = {}) {
  try {
    if (!url) return null;
    const u = new URL(String(url));
    const host = u.hostname.replace(/^www\./i, "");
    if (!host || host === "localhost") return null;
    if (!allowAggregator && AGGREGATOR_HOST_RE.test(host)) return null;
    return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
  } catch { return null; }
}

function htmlToText(html = "") {
  return cleanText(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>(?=\s*<)/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h\d|section|article|tr|td|th|header|footer|main)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " "), 80000);
}

function pickSection(text, labels, stopLabels = []) {
  if (!text) return null;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelRe = labels.map(escRe).join("|");
  const stopRe = (stopLabels.length ? stopLabels : [
    "How to apply","Apply now","Application instructions","Application process","About the company","About us",
    "Qualifications","Requirements","Responsibilities","Duties","Key responsibilities","What you will do",
    "Description","Job description","Role overview","Summary","Benefits","Salary","Location","Deadline",
    "Education","Experience","Skills","Equal opportunity","Privacy","Similar jobs","Related jobs"
  ]).map(escRe).join("|");
  const re = new RegExp(`(?:^|\\n)\\s*${labelRe}\\s*:?\\s*\\n([\\s\\S]{20,}?)(?=\\n\\s*(?:${stopRe})\\s*:?\\s*(?:\\n|$)|$)`, "i");
  const m = String(text).match(re);
  return m ? cleanText(m[1], 25000) : null;
}

export async function fetchPublicLogo(pageUrl, timeoutMs = 4500) {
  try {
    if (!pageUrl || !/^https?:/i.test(pageUrl)) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": "HabeshaCareers/1.0 (public vacancy aggregation; logo discovery)", "Accept": "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|xhtml/i.test(ct)) return null;
    const html = (await res.text()).slice(0, 180000);
    const abs = (href) => { try { return href ? new URL(href, pageUrl).toString() : null; } catch { return null; } };
    const metas = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/ig,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/ig,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/ig,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/ig,
    ];
    for (const re of metas) for (const m of html.matchAll(re)) { const u = abs(m[1]); if (u && /^https?:/i.test(u)) return u; }
    const icons = [...html.matchAll(/<link[^>]+rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]*>/ig)];
    let best = null, bestSz = -1;
    for (const m of icons) {
      const tag = m[0];
      const href = (tag.match(/\bhref=["']([^"']+)["']/i) || [])[1];
      const sizes = (tag.match(/\bsizes=["']([^"']+)["']/i) || [])[1] || "";
      const sz = Math.max(0, ...sizes.split(/\s+/).map(s => parseInt(s,10)||0), /apple-touch-icon/i.test(tag) ? 180 : 0);
      const u = abs(href);
      if (u && /^https?:/i.test(u) && sz >= bestSz) { bestSz = sz; best = u; }
    }
    return best;
  } catch { return null; }
}

export async function fetchPublicJobDetails(pageUrl, timeoutMs = 7000) {
  try {
    if (!pageUrl || !/^https?:/i.test(pageUrl)) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": "HabeshaCareers/1.0 (public vacancy aggregation; detail extraction)", "Accept": "text/html,application/xhtml+xml,application/json" },
      redirect: "follow",
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (/application\/json/i.test(ct)) {
      const j = await res.json().catch(() => null);
      const desc = cleanText(j?.description || j?.jobDescription || j?.content, 50000);
      const req = cleanText(j?.qualifications || j?.requirements || j?.skills, 30000);
      return (desc || req) ? { description: desc, requirements: req } : null;
    }
    if (!/text\/html|xhtml/i.test(ct)) return null;
    const html = (await res.text()).slice(0, 260000);
    let ldDesc = null, ldReq = null, ldType = null, ldLoc = null;
    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const raw = JSON.parse(m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ""));
        const items = Array.isArray(raw) ? raw : (Array.isArray(raw?.['@graph']) ? raw['@graph'] : [raw]);
        for (const it of items) {
          const type = Array.isArray(it?.['@type']) ? it['@type'].join(' ') : String(it?.['@type']||'');
          if (!/JobPosting/i.test(type) && !it?.title && !it?.description) continue;
          ldDesc = ldDesc || cleanText(it?.description || it?.responsibilities, 50000);
          ldReq = ldReq || cleanText(it?.qualifications || it?.skills || it?.experienceRequirements || it?.educationRequirements, 30000);
          ldType = ldType || cleanText(it?.employmentType, 120);
          const loc = it?.jobLocation?.address || it?.jobLocation?.[0]?.address || it?.applicantLocationRequirements;
          ldLoc = ldLoc || cleanText([loc?.addressLocality, loc?.addressRegion, loc?.addressCountry].filter(Boolean).join(', ') || loc?.name, 200);
        }
      } catch {}
    }
    const text = htmlToText(html);
    const description = ldDesc || pickSection(text, ["Job description","Description","About the role","Role overview","Position summary","Summary","The opportunity","The role","About this role","Overview"]) || cleanText(text, 20000);
    const requirements = ldReq || pickSection(text, ["Qualifications","Requirements","Required qualifications","Minimum requirements","What you will bring","What you bring","Skills and experience","Who you are","Your profile","Candidate profile"]);
    const application = pickSection(text, ["How to apply","Application instructions","Application process","To apply","Application procedure"]);
    return { description, requirements, application_instructions: application, job_type: ldType, location: ldLoc };
  } catch { return null; }
}

export function cleanText(s, max = null) {
  if (s == null) return null;
  let t = String(s).replace(/\r\n?/g, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return null;
  if (max && t.length > max) t = t.slice(0, max - 1) + "…";
  return t;
}

export const FRONTEND_CATEGORIES = [
  "Healthcare and Medical","Information Technology","Education and Training","Engineering and Technical",
  "Finance and Accounting","Business and Management","Creative and Design","Law and Public Safety",
  "Science and Research","Hospitality and Tourism","Manufacturing and Skilled Trades",
  "Agriculture and Natural Resources","Transportation and Logistics","Media and Communication"
];

function normCat(s) { return String(s || "").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim(); }

export function guessCategory({ title = "", company = "", description = "", requirements = "", location = "", rawCategory = "", matchedCategories = [] } = {}) {
  const text = [title, company, description, requirements, location, rawCategory].filter(Boolean).join(" \n ").toLowerCase();
  const raw = normCat(rawCategory);
  const rawDirect = FRONTEND_CATEGORIES.find(c => normCat(c) === raw);
  const rules = [
    { cat: "Healthcare and Medical", strong: /\b(doctor|physician|nurse|nursing|midwife|clinical|medical officer|pharmacist|pharmacy|public health|health officer|surgeon|hospital|maternal|reproductive health|sexual health|nutrition|epidemiolog|laboratory techn|health specialist|watsan specialist in health context?)\b/, weak: /\bhealth\b/ },
    { cat: "Information Technology", strong: /\b(software|developer|programmer|frontend|backend|full[- ]stack|devops|cloud engineer|data engineer|cybersecurity|it support|system administrator|network engineer|database administrator|mobile app|web developer|ai engineer|machine learning engineer)\b/, weak: /\b(digital transformation|ict)\b/ },
    { cat: "Education and Training", strong: /\b(teacher|lecturer|professor|instructor|tutor|education project|education officer|school principal|curriculum|training officer|academic|faculty|tv0?et|classroom)\b/, weak: /\b(education|learning)\b/ },
    { cat: "Engineering and Technical", strong: /\b(civil engineer|mechanical engineer|electrical engineer|structural engineer|construction engineer|architect|surveyor|technician|cad|autocad|site engineer|water engineer)\b/, weak: /\b(engineer|engineering)\b/ },
    { cat: "Finance and Accounting", strong: /\b(accountant|accounting|auditor|audit|finance officer|financial analyst|budget officer|bookkeeper|payroll|tax consultant|banker|treasury|grant finance|energy finance|investment analyst)\b/, weak: /\b(finance|financial|accounting)\b/ },
    { cat: "Transportation and Logistics", strong: /\b(driver|chauffeur|fleet|logistics officer|supply chain|procurement officer|warehouse|dispatcher|transport officer|delivery driver)\b/, weak: /\b(logistics|supply chain)\b/ },
    { cat: "Agriculture and Natural Resources", strong: /\b(agronomist|agriculture|farmer support|livestock|veterinar|forestry|irrigation|natural resource|environment officer|climate adaptation|rangeland|crop)\b/, weak: /\b(wash|water sanitation|environment|climate)\b/ },
    { cat: "Law and Public Safety", strong: /\b(lawyer|legal officer|attorney|compliance officer|judge|prosecutor|safeguarding investigator|security officer|police|human rights officer)\b/, weak: /\b(legal|law|protection)\b/ },
    { cat: "Media and Communication", strong: /\b(journalist|communications officer|media officer|public relations|content creator|editor|photographer|videographer|social media manager|reporter)\b/, weak: /\b(communication|media)\b/ },
    { cat: "Science and Research", strong: /\b(researcher|research officer|scientist|data scientist|statistician|biostatistician|monitoring evaluation research|study coordinator|laboratory scientist)\b/, weak: /\b(research|study)\b/ },
    { cat: "Hospitality and Tourism", strong: /\b(hotel|hospitality|tourism|chef|cook|housekeeping|travel consultant|guest service|restaurant)\b/, weak: null },
    { cat: "Manufacturing and Skilled Trades", strong: /\b(manufacturing|production operator|machinist|welder|electrician|plumber|carpenter|maintenance technician|factory)\b/, weak: /\b(technician|maintenance)\b/ },
    { cat: "Creative and Design", strong: /\b(graphic designer|ui ux designer|creative director|brand designer|illustrator|animator|video editor|photography)\b/, weak: /\b(design|creative)\b/ },
    { cat: "Business and Management", strong: /\b(program manager|programme manager|project manager|senior program lead|chief of party|director\b|coordinator|operations manager|business advisor|consultant|administrator|executive assistant|hr officer|human resources|monitoring and evaluation officer|meal advisor|partnerships? manager)\b/, weak: /\b(manager|management|officer|specialist|lead|advisor)\b/ },
  ];
  const scores = new Map(FRONTEND_CATEGORIES.map(c => [c, 0]));
  for (const r of rules) {
    if (r.strong && r.strong.test(text)) scores.set(r.cat, (scores.get(r.cat)||0) + 7);
    if (r.weak && r.weak.test(text)) scores.set(r.cat, (scores.get(r.cat)||0) + 1);
  }
  const names = (matchedCategories || []).map(c => normCat(c.name || c));
  const has = (n) => names.some(x => x.includes(normCat(n)));
  if ((scores.get("Information Technology")||0) < 7 && (has("Information Technology") || has("Data Science"))) scores.set("Information Technology", (scores.get("Information Technology")||0)+1);
  if ((scores.get("Finance and Accounting")||0) < 7 && has("Finance")) scores.set("Finance and Accounting", (scores.get("Finance and Accounting")||0)+1);
  if ((scores.get("Education and Training")||0) < 7 && has("Education")) scores.set("Education and Training", (scores.get("Education and Training")||0)+1);
  if ((scores.get("Healthcare and Medical")||0) < 7 && (has("Medicine") || has("Nursing") || has("Public Health"))) scores.set("Healthcare and Medical", (scores.get("Healthcare and Medical")||0)+1);
  // explicit high-confidence corrections (authoritative)
  const force = (cat, s) => scores.set(cat, Math.max(scores.get(cat)||0, s));
  const role = [title, rawCategory].join(" ").toLowerCase();
  if (/\b(chauffeur|driver\b(?!'?\s*s?\b\s*(of|for|behind|to|in\b\s+change)))/.test(role) || /\b(valid (driving|driver'?s?) licen[cs]e|vehicle driver|light vehicle driver|heavy (truck|vehicle) driver|driver,?\s*G-\d)\b/.test(text)) force("Transportation and Logistics", 10);
  if (/\b(gtm|go-to-market|strategic planning|strategy lead|business development|chief of party|chief field office|head of office|country director|deputy director|program director|programme director|project manager|program lead|programme lead|senior program lead|operations manager)\b/.test(text) && !/\b(education project manager|clinical|nurse|pharmac|accountant|software engineer)\b/.test(text)) force("Business and Management", 9);
  if (/\b(education project|teacher|school principal|curriculum|training of trainers|tvet|lecturer|instructor)\b/.test(text)) force("Education and Training", 9);
  if (/\b(finance specialist|energy finance|accountant|auditor|audit|budget officer|financial analyst|treasury)\b/.test(text)) force("Finance and Accounting", 9);
  if (/\b(maternal|reproductive health|sexual health|medical officer|nurse|midwife|clinical|pharmacist|surgeon|public health officer)\b/.test(text) && !/\b(education project)\b/.test(text)) force("Healthcare and Medical", 9);
  if (/\b(climate|environment and drr|disaster risk|resilience|wash specialist|water sanitation|agriculture|livestock|natural resource)\b/.test(text) && !/\b(education project|teacher|school)\b/.test(text)) force("Agriculture and Natural Resources", 9);
  if (/\b(software developer|software engineer|frontend developer|backend developer|full[- ]stack developer|devops engineer|cloud engineer|cybersecurity engineer|mobile developer)\b/.test(text) || (/\b(software engineer|developer role|engineering team)\b/.test(role) && !/\b(gtm|strategic planning|sales|marketing|finance|accountant|hr|recruit)\b/.test(role))) force("Information Technology", 9);
  let best = "Business and Management", bestScore = -1;
  for (const [cat, s] of scores.entries()) if (s > bestScore) { best = cat; bestScore = s; }
  if (bestScore >= 7) return best;
  if (rawDirect && bestScore < 3) return rawDirect;
  if (rawDirect && bestScore >= 3 && bestScore < 7) return bestScore >= (scores.get(rawDirect)||0) + 2 ? best : rawDirect;
  if (bestScore >= 3) return best;
  return rawDirect || "Business and Management";
}

export function mapCategoryToFrontend(categories = [], fallback = null) {
  return guessCategory({ matchedCategories: categories, rawCategory: fallback || "" });
}
