import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, test } from "node:test";
import { adminEmailAllowed, adminGoogleAuthUrl, adminOwnerEmail } from "../lib/admin-google-oauth";
import { verifyGoogleIdToken } from "../lib/google-id-token";
import { signOAuthState, verifyOAuthStateCookie } from "../lib/google-oauth";
import { appOrigin, safeRedirectPath } from "../lib/origin";

const env = process.env as Record<string, string | undefined>;
const savedEnv = { ...env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const key of Object.keys(env)) if (!(key in savedEnv)) delete env[key];
  Object.assign(env, savedEnv);
  globalThis.fetch = originalFetch;
});

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" };

function signedToken(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "test-kid" }) {
  const unsigned = `${part(header)}.${part(claims)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

function serveJwks() {
  globalThis.fetch = (async () => Response.json({ keys: [jwk] })) as typeof fetch;
}

const goodClaims = () => ({
  aud: "client-1",
  iss: "https://accounts.google.com",
  exp: Math.floor(Date.now() / 1000) + 600,
  nonce: "nonce-1",
  email: "owner@example.com",
  email_verified: true,
});

test("admin sign-in link carries a nonce and never a login_hint", () => {
  env.GOOGLE_CLIENT_ID = "client-1";
  env.ADMIN_GOOGLE_EMAIL = "owner@example.com";
  env.APP_ORIGIN = "https://schedule.example.com";
  const url = new URL(adminGoogleAuthUrl(new Request("https://schedule.example.com/api/admin/oauth/google/start"), "state-1", "nonce-1"));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("nonce"), "nonce-1");
  assert.equal(url.searchParams.get("redirect_uri"), "https://schedule.example.com/api/oauth/google/callback");
  assert.equal(url.searchParams.has("login_hint"), false);
  assert.equal(url.toString().includes("owner"), false);
});

test("owner address comes only from the environment and must match exactly", () => {
  delete env.ADMIN_GOOGLE_EMAIL;
  assert.equal(adminOwnerEmail(), "");
  assert.equal(adminEmailAllowed("", true), false);
  assert.equal(adminEmailAllowed("someone@example.com", true), false);
  env.ADMIN_GOOGLE_EMAIL = " Owner@Example.com ";
  assert.equal(adminEmailAllowed("owner@example.com", true), true);
  assert.equal(adminEmailAllowed("OWNER@example.com", true), true);
  assert.equal(adminEmailAllowed("owner@example.com", false), false);
  assert.equal(adminEmailAllowed("owner@example.com.evil.test", true), false);
});

test("oauth state is bound to the cookie, expires, and cannot be forged", () => {
  const now = Date.now();
  const cookie = signOAuthState("abc", now);
  assert.equal(verifyOAuthStateCookie(cookie, "abc", now), true);
  assert.equal(verifyOAuthStateCookie(cookie, "other", now), false);
  assert.equal(verifyOAuthStateCookie(cookie, "abc", now + 21 * 60 * 1000), false);
  const [raw, exp] = cookie.split(".");
  assert.equal(verifyOAuthStateCookie(`${raw}.${Number(exp) + 60_000}.${cookie.split(".")[2]}`, "abc", now), false);
  assert.equal(verifyOAuthStateCookie(`${raw}.${exp}.forged`, "abc", now), false);
  assert.equal(verifyOAuthStateCookie(undefined, "abc", now), false);
});

test("production origin ignores the request Host header", () => {
  delete env.APP_ORIGIN;
  delete env.VERCEL_PROJECT_PRODUCTION_URL;
  env.NODE_ENV = "production";
  const spoofed = new Request("https://evil.example/x", { headers: { host: "evil.example", "x-forwarded-host": "evil.example" } });
  assert.throws(() => appOrigin(spoofed), /APP_ORIGIN must be set in production/);
  env.VERCEL_PROJECT_PRODUCTION_URL = "schedule.example.com";
  assert.equal(appOrigin(spoofed), "https://schedule.example.com");
  delete env.VERCEL_PROJECT_PRODUCTION_URL;
  env.APP_ORIGIN = "https://schedule.example.com/";
  assert.equal(appOrigin(spoofed), "https://schedule.example.com");
});

test("post-login redirects stay on this site", () => {
  assert.equal(safeRedirectPath("/admin?tab=links"), "/admin?tab=links");
  assert.equal(safeRedirectPath(null), "/admin");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/\\/evil.example", "javascript:alert(1)", "/x\r\nSet-Cookie: a=b"]) {
    assert.equal(safeRedirectPath(bad), "/admin", bad);
  }
});

test("a Google-signed id_token with matching claims and nonce is accepted", async () => {
  serveJwks();
  const claims = await verifyGoogleIdToken(signedToken(goodClaims()), "client-1", "nonce-1");
  assert.equal(claims.email, "owner@example.com");
});

test("id_token is rejected for a bad signature, alg, audience, issuer, expiry, or nonce", async () => {
  serveJwks();
  const good = signedToken(goodClaims());
  const [h, p] = good.split(".");
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const foreign = `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(other, "base64url")}`;
  await assert.rejects(() => verifyGoogleIdToken(foreign, "client-1", "nonce-1"), /signature/);
  await assert.rejects(() => verifyGoogleIdToken(`${part({ alg: "none" })}.${p}.`, "client-1", "nonce-1"), /alg/);
  await assert.rejects(() => verifyGoogleIdToken(signedToken({ ...goodClaims(), aud: "other" }), "client-1", "nonce-1"), /audience/);
  await assert.rejects(() => verifyGoogleIdToken(signedToken({ ...goodClaims(), iss: "https://evil.example" }), "client-1", "nonce-1"), /issuer/);
  await assert.rejects(() => verifyGoogleIdToken(signedToken({ ...goodClaims(), exp: 1 }), "client-1", "nonce-1"), /expired/);
  await assert.rejects(() => verifyGoogleIdToken(good, "client-1", "nonce-2"), /nonce/);
});

test("an unknown key id refetches Google's keys and fails closed when they cannot be fetched", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError("offline");
  }) as typeof fetch;
  const rotated = signedToken(goodClaims(), { alg: "RS256", kid: "rotated-kid" });
  await assert.rejects(() => verifyGoogleIdToken(rotated, "client-1", "nonce-1"), /offline/);
  assert.equal(calls, 1);
});
