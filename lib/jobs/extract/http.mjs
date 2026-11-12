// SSRF-safe HTTP client with robots.txt support, per-host throttling, timeouts,
// bounded response sizes and retry/backoff. Used only by the server-side sync
// pipeline (never imported by browser code).

import dns from "node:dns/promises";
import net from "node:net";
import { isLocalHostname, isPrivateIp, safeParseUrl } from "./hosts.mjs";

export const USER_AGENT =
  "HabeshaCareersBot/1.0 (+https://habeshacareers.vercel.app; public vacancy aggregation; respectful; contact site admin)";

const DEFAULT_OPTIONS = {
  timeoutMs: 12000,
  maxBytes: 3_000_000,
  maxRedirects: 5,
  retries: 2,
  retryDelayMs: 600,
  minHostIntervalMs: 250,
  allowPrivate: false,
  respectRobots: true,
  headers: {},
};

const hostState = new Map(); // host -> { nextAt, robots, robotsAt }

export function clearHttpState() {
  hostState.clear();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mergeOptions(opts = {}) {
  return { ...DEFAULT_OPTIONS, ...opts, headers: { ...DEFAULT_OPTIONS.headers, ...(opts.headers || {}) } };
}

async function assertPublicUrl(url, opts) {
  if (opts.allowPrivate) return;
  const host = url.hostname;
  if (isLocalHostname(host)) throw new Error("blocked_local_host");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("blocked_private_address");
    return;
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("dns_lookup_failed");
  }
  if (!addresses.length) throw new Error("dns_lookup_empty");
  for (const entry of addresses) {
    if (isPrivateIp(entry.address)) throw new Error("blocked_private_address");
  }
}

async function throttle(host, opts) {
  const now = Date.now();
  const state = hostState.get(host) || { nextAt: 0 };
  const wait = Math.max(0, state.nextAt - now);
  state.nextAt = Math.max(now, state.nextAt) + Math.max(0, opts.minHostIntervalMs);
  hostState.set(host, state);
  if (wait > 0) await sleep(wait);
}

async function readTextLimited(res, maxBytes) {
  const contentType = res.headers.get("content-type") || "";
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes, contentType };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  let text = "";
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        truncated = true;
        const slice = value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes)));
        text += decoder.decode(slice, { stream: false });
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return { text, truncated, contentType };
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

function parseRobots(txt) {
  const groups = [];
  let current = null;
  for (const rawLine of String(txt || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      current.rules.push({ type: key, path: value });
    } else if (key === "crawl-delay") {
      const n = parseFloat(value);
      if (Number.isFinite(n)) current.crawlDelay = Math.max(0, Math.min(10, n));
    }
  }
  return groups;
}

function robotsGroupFor(groups) {
  const uaLower = USER_AGENT.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && uaLower.includes(a)));
  return specific || groups.find((g) => g.agents.includes("*")) || null;
}

function robotsAllows(group, pathname) {
  if (!group) return true;
  const path = pathname || "/";
  let best = null;
  for (const rule of group.rules) {
    if (!rule.path) continue;
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const re = new RegExp(`^${pattern}`);
    if (!re.test(path)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.type === "allow")) {
      best = { length, type: rule.type };
    }
  }
  return !best || best.type === "allow";
}

export async function getRobots(origin, opts = {}) {
  const options = mergeOptions(opts);
  const key = `robots:${origin}`;
  const state = hostState.get(key) || {};
  if (state.robots && Date.now() - (state.robotsAt || 0) < 30 * 60 * 1000) return state.robots;
  let robots = { groups: [], crawlDelay: null };
  try {
    const res = await fetchText(`${origin}/robots.txt`, {
      ...options,
      respectRobots: false,
      timeoutMs: Math.min(options.timeoutMs, 6000),
      maxBytes: 200_000,
      retries: 0,
    });
    if (res.ok) robots = { groups: parseRobots(res.text), crawlDelay: null };
  } catch {
    // A missing/unreachable robots.txt is treated as "no restrictions" but the
    // per-host throttle still applies.
  }
  hostState.set(key, { robots, robotsAt: Date.now() });
  return robots;
}

export async function isAllowedByRobots(url, opts = {}) {
  const options = mergeOptions(opts);
  if (!options.respectRobots) return true;
  const u = url instanceof URL ? url : safeParseUrl(url);
  if (!u) return false;
  const robots = await getRobots(u.origin, options);
  const group = robotsGroupFor(robots.groups);
  return robotsAllows(group, u.pathname + u.search);
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

function retryAfterMs(res) {
  const value = res.headers.get("retry-after");
  if (!value) return 0;
  const seconds = parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(30_000, seconds * 1000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(30_000, date - Date.now()));
  return 0;
}

async function fetchOnce(url, options) {
  await assertPublicUrl(url, options);
  if (options.respectRobots && !(await isAllowedByRobots(url, options))) {
    const err = new Error("robots_disallowed");
    err.code = "ROBOTS_DISALLOWED";
    throw err;
  }
  await throttle(url.hostname, options);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: options.method || "GET",
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en,am;q=0.8",
        ...options.headers,
      },
      signal: controller.signal,
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { redirect: true, status: res.status, location, url: url.toString(), headers: res.headers };
    }
    const { text, truncated, contentType } = await readTextLimited(res, options.maxBytes);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      url: url.toString(),
      headers: res.headers,
      contentType,
      text,
      truncated,
      bytes: text.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a URL with manual redirect validation, SSRF protection, robots.txt,
 * per-host throttling and retry/backoff.
 */
export async function fetchText(input, opts = {}) {
  const options = mergeOptions(opts);
  let current = safeParseUrl(input);
  if (!current) return { ok: false, status: 0, url: String(input), error: "invalid_url", text: "" };
  if (options.respectRobots && !(await isAllowedByRobots(current, options))) {
    return { ok: false, status: 0, url: current.toString(), error: "robots_disallowed", text: "" };
  }

  let redirects = 0;
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetchOnce(current, options);
      if (res.redirect) {
        if (redirects >= options.maxRedirects) {
          return { ok: false, status: res.status, url: current.toString(), error: "too_many_redirects", text: "" };
        }
        const next = safeParseUrl(res.location, current.toString());
        if (!next) return { ok: false, status: res.status, url: current.toString(), error: "invalid_redirect", text: "" };
        await assertPublicUrl(next, options);
        current = next;
        redirects += 1;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < options.retries) {
        const wait = retryAfterMs({ headers: res.headers }) || options.retryDelayMs * 2 ** attempt;
        await sleep(wait + Math.floor(Math.random() * 250));
        attempt += 1;
        continue;
      }
      return { ...res, redirects };
    } catch (e) {
      const code = e?.code || e?.name || "";
      if (code === "ROBOTS_DISALLOWED") {
        return { ok: false, status: 0, url: current.toString(), error: "robots_disallowed", text: "" };
      }
      if (/blocked_|dns_|invalid_url/.test(String(e.message))) {
        return { ok: false, status: 0, url: current.toString(), error: String(e.message), text: "" };
      }
      if (attempt < options.retries) {
        await sleep(options.retryDelayMs * 2 ** attempt + Math.floor(Math.random() * 250));
        attempt += 1;
        continue;
      }
      return {
        ok: false,
        status: 0,
        url: current.toString(),
        error: String(e?.message || e).slice(0, 300),
        text: "",
      };
    }
  }
}

export async function fetchJson(input, opts = {}) {
  const res = await fetchText(input, {
    ...opts,
    headers: { Accept: "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) return { ...res, data: null };
  try {
    return { ...res, data: JSON.parse(res.text) };
  } catch {
    return { ...res, ok: false, data: null, error: "invalid_json" };
  }
}

/**
 * Validate a destination URL without downloading the whole page. HEAD is tried
 * first; servers that reject HEAD fall back to a tiny ranged GET.
 */
export async function checkDestination(input, opts = {}) {
  const options = mergeOptions({ ...opts, retries: opts.retries ?? 1 });
  const url = safeParseUrl(input);
  if (!url) return { ok: false, status: 0, error: "invalid_url" };
  try {
    const head = await fetchText(url.toString(), {
      ...options,
      method: "HEAD",
      maxBytes: 4096,
      respectRobots: false,
    });
    if (head.ok || (head.status >= 300 && head.status < 400)) {
      return { ok: true, status: head.status, finalUrl: head.url, contentType: head.contentType || "" };
    }
    if (head.status && ![400, 403, 405, 501].includes(head.status)) {
      return { ok: false, status: head.status, finalUrl: head.url, error: `http_${head.status}` };
    }
    const get = await fetchText(url.toString(), {
      ...options,
      method: "GET",
      headers: { Range: "bytes=0-2048" },
      maxBytes: 8192,
      respectRobots: false,
    });
    // 401/403 usually means a login-protected but real application flow.
    const accepted = get.ok || get.status === 401 || get.status === 403 || (get.status >= 300 && get.status < 400);
    return {
      ok: accepted,
      status: get.status,
      finalUrl: get.url,
      contentType: get.contentType || "",
      error: accepted ? undefined : get.error || `http_${get.status}`,
    };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e).slice(0, 200) };
  }
}
