// Pure unit tests for the role-based account suite.
// No database or network access: only the deterministic helpers are exercised.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

import {
  forgotPasswordResponse,
  hashSessionToken,
  isValidResetToken,
  sanitizeAccountFields,
  sanitizeProfileData,
  withCurrentSessionFlag,
} from "../../lib/auth.mjs";

test("reset tokens are URL-safe and long enough to be unguessable", () => {
  const generated = crypto.randomBytes(32).toString("base64url");
  assert.equal(generated.length, 43);
  assert.equal(isValidResetToken(generated), true);
  assert.equal(isValidResetToken("a".repeat(64)), true);
  assert.equal(isValidResetToken(""), false);
  assert.equal(isValidResetToken(null), false);
  assert.equal(isValidResetToken(undefined), false);
  assert.equal(isValidResetToken("too-short"), false);
  assert.equal(isValidResetToken(`${generated}\n`), false);
  assert.equal(isValidResetToken(`${generated}+`), false);
  assert.equal(isValidResetToken("a".repeat(129)), false);
});

test("a generated token hashes to something different from the token", () => {
  const token = crypto.randomBytes(32).toString("base64url");
  assert.notEqual(hashSessionToken(token), token);
  assert.match(hashSessionToken(token), /^[a-f0-9]{64}$/);
  assert.equal(hashSessionToken(token), hashSessionToken(token));
});

test("profile fields strip secret keys at every level", () => {
  const result = sanitizeProfileData({
    fullName: "Ada",
    skills: ["nursing", "public health"],
    _internal: "private",
    passwordHint: "secret",
    reset_token: "secret",
    nested: {
      ACCESS_TOKEN: "secret",
      myPassword: "secret",
      keep: "yes",
      deeper: { sessionToken: "secret", note: "ok" },
    },
  });
  assert.deepEqual(result, {
    fullName: "Ada",
    skills: ["nursing", "public health"],
    nested: {
      keep: "yes",
      deeper: { note: "ok" },
    },
  });
});

test("profile data is bounded and non-object input is ignored", () => {
  const result = sanitizeProfileData({ bio: "x".repeat(5000), note: "keep me" }, 2048);
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 2048);
  assert.deepEqual(sanitizeProfileData("not an object"), {});
  assert.deepEqual(sanitizeProfileData(null), {});
  assert.deepEqual(sanitizeProfileData(["array"]), {});
});

test("only employers may store company and contact name columns", () => {
  const fields = {
    name: "  Ada  ",
    phone: "  +251911  ",
    location: "  Addis Ababa  ",
    company_name: "  Acme PLC  ",
    contact_name: "  Bob  ",
    role: "admin",
  };
  const employee = sanitizeAccountFields(fields, "employee");
  assert.deepEqual(employee, { name: "Ada", phone: "+251911", location: "Addis Ababa" });
  assert.deepEqual(sanitizeAccountFields(fields, "admin"), employee);

  assert.deepEqual(sanitizeAccountFields(fields, "employer"), {
    name: "Ada",
    phone: "+251911",
    location: "Addis Ababa",
    company_name: "Acme PLC",
    contact_name: "Bob",
  });
});

test("account text fields are length capped", () => {
  const result = sanitizeAccountFields({ name: "x".repeat(400), phone: "y".repeat(100) }, "employee");
  assert.equal(result.name.length, 200);
  assert.equal(result.phone.length, 50);
});

test("a session list marks only the caller's session as current", () => {
  const currentToken = "session-current";
  const otherToken = "session-other";
  const rows = [
    {
      id: 7,
      token_hash: hashSessionToken(otherToken),
      created_at: "2026-01-01T00:00:00Z",
      last_seen_at: "2026-01-02T00:00:00Z",
      user_agent: "Firefox",
    },
    {
      id: 8,
      token_hash: hashSessionToken(currentToken),
      created_at: "2026-01-03T00:00:00Z",
      last_seen_at: null,
      user_agent: null,
    },
  ];
  const sessions = withCurrentSessionFlag(rows, currentToken);
  assert.deepEqual(sessions, [
    {
      id: 7,
      created_at: "2026-01-01T00:00:00Z",
      last_seen_at: "2026-01-02T00:00:00Z",
      user_agent: "Firefox",
      current: false,
    },
    {
      id: 8,
      created_at: "2026-01-03T00:00:00Z",
      last_seen_at: null,
      user_agent: null,
      current: true,
    },
  ]);
  assert.equal(sessions.every((session) => !("token_hash" in session)), true);
  assert.equal(withCurrentSessionFlag(rows, null).some((session) => session.current), false);
});

test("forgot-password always returns one generic, link-free response", () => {
  const first = forgotPasswordResponse();
  const second = forgotPasswordResponse();
  assert.deepEqual(first, {
    ok: true,
    message: "If an account exists, reset instructions have been sent.",
  });
  assert.deepEqual(second, first);
  assert.notEqual(first, second);
  assert.equal("devResetUrl" in first, false);
  assert.equal("token" in first, false);
  assert.equal("resetUrl" in first, false);
});
