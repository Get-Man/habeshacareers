// Next.js App Router "flight" payload reader.
//
// Modern Next.js sites render their content into a streamed RSC payload
// (self.__next_f.push([1,"..."]) chunks) instead of server-rendered HTML.
// This module decodes that payload so the ordinary HTML extraction pipeline
// can still read the page's real content.
//
// The payload is a sequence of records shaped "<id>:<json>", where the JSON
// is a React element tree:
//     ["$","div",null,{ "children": [ ... ] }]
// Leaf text is a plain string inside a "children" slot.

/**
 * Decode every flight chunk embedded in an HTML document.
 */
export function decodeFlightPayload(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  for (const m of String(html || "").matchAll(re)) {
    try {
      chunks.push(JSON.parse(m[1]));
    } catch {
      /* ignore a malformed chunk */
    }
  }
  if (chunks.length) return chunks.join("");

  // A request that sends `RSC: 1` receives the raw flight stream instead of
  // the HTML wrapper. It is already decoded, so it is returned as-is.
  const text = String(html || "");
  if (/^\s*\w+:\[/.test(text) || /"searchData"/.test(text)) return text;
  return "";
}

/**
 * Split a decoded payload into its "<id>:<json>" records.
 */
export function splitFlightRecords(payload) {
  const records = new Map();
  const text = String(payload || "");
  const re = /(?:^|\n)(\w+):/g;
  const starts = [];
  for (const m of text.matchAll(re)) starts.push({ id: m[1], index: m.index + m[0].length - m[1].length - 1 + m[1].length + 1 });
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i].index + starts[i].id.length + 1;
    const to = i + 1 < starts.length ? starts[i + 1].index : text.length;
    records.set(starts[i].id, text.slice(from, to).trim());
  }
  return records;
}

/**
 * Parse a record body as JSON. Records are either a JSON value or a
 * colon-separated list of JSON values (chunked rows).
 */
export function parseFlightJson(body) {
  const text = String(body || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to chunked parsing */
  }
  // Some records are "rowId:json" pairs.
  const rows = [];
  let rest = text;
  while (rest.length) {
    const m = /^(\w+):/.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
    const value = readJsonValue(rest);
    if (value == null) break;
    rows.push(value.value);
    rest = rest.slice(value.length);
  }
  return rows.length ? rows : null;
}

function readJsonValue(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return { value: text.slice(0, i + 1), length: i + 1 };
    }
  }
  return null;
}

/**
 * Walk a React element tree and collect its text leaves in document order.
 * Element type names ("div", "p", ...) are skipped; only real content is kept.
 */
export function collectFlightText(node, acc = []) {
  if (node == null) return acc;
  if (typeof node === "string") {
    if (node.trim()) acc.push(node);
    return acc;
  }
  if (typeof node === "number" || typeof node === "boolean") return acc;
  if (Array.isArray(node)) {
    // React element arrays look like ["$","tag",key,props].
    if (node.length >= 3 && node[0] === "$" && typeof node[1] === "string") {
      const props = node[3];
      if (props && typeof props === "object" && "children" in props) collectFlightText(props.children, acc);
      return acc;
    }
    for (const item of node) collectFlightText(item, acc);
    return acc;
  }
  if (typeof node === "object") {
    if ("children" in node) collectFlightText(node.children, acc);
    return acc;
  }
  return acc;
}

/**
 * Find every plain object in a decoded payload that looks like a job record.
 * Records are matched by the presence of a slug plus job-specific fields.
 */
export function findJobRecords(payload, { requiredKeys = ["slug", "title"], limit = 200 } = {}) {
  const found = [];
  const text = String(payload || "");
  // Records are JSON objects; locate them by scanning for balanced braces that
  // contain a "slug" key.
  const re = /"slug"\s*:/g;
  for (const m of text.matchAll(re)) {
    const start = findObjectStart(text, m.index);
    if (start < 0) continue;
    const value = readJsonValue(text.slice(start));
    if (!value) continue;
    let parsed;
    try {
      parsed = JSON.parse(value.value);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    if (!requiredKeys.every((k) => k in parsed)) continue;
    found.push(parsed);
    if (found.length >= limit) break;
  }
  return found;
}

function findObjectStart(text, from) {
  for (let i = from; i >= 0 && from - i < 4000; i -= 1) {
    if (text[i] === "{") {
      const value = readJsonValue(text.slice(i));
      if (value && value.length > 0) return i;
      return -1;
    }
  }
  return -1;
}
