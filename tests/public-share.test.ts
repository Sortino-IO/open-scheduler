import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { canonicalPublicUrl, isShareCancellation, publicSharePayload } from "../lib/public-share";
import { adminManifest, adminSignInReturnUrl, publicManifest } from "../lib/pwa";

const env = process.env as Record<string, string | undefined>;
const savedOrigin = env.APP_ORIGIN;
const savedName = env.NEXT_PUBLIC_SCHEDULER_OWNER_NAME;

function useSite(origin = "https://schedule.example.com", name = "Alex Rivera") {
  env.APP_ORIGIN = origin;
  env.NEXT_PUBLIC_SCHEDULER_OWNER_NAME = name;
}

afterEach(() => {
  if (savedOrigin === undefined) delete env.APP_ORIGIN;
  else env.APP_ORIGIN = savedOrigin;
  if (savedName === undefined) delete env.NEXT_PUBLIC_SCHEDULER_OWNER_NAME;
  else env.NEXT_PUBLIC_SCHEDULER_OWNER_NAME = savedName;
});

test("public share URLs drop unlock, booking, and reschedule tokens", () => {
  useSite();
  assert.equal(canonicalPublicUrl("/intro?k=abc.secret"), "https://schedule.example.com/intro");
  assert.equal(
    canonicalPublicUrl("/45-minute?reschedule=id&t=token"),
    "https://schedule.example.com/45-minute",
  );
  assert.equal(
    canonicalPublicUrl("https://schedule.example.com/in-person?k=unlock#share"),
    "https://schedule.example.com/in-person",
  );
  assert.equal(canonicalPublicUrl("/"), "https://schedule.example.com");
});

test("public share refuses admin and private booking links", () => {
  assert.throws(() => canonicalPublicUrl("/admin"));
  assert.throws(() => canonicalPublicUrl("/booking/abc?t=secret"));
  assert.throws(() => canonicalPublicUrl("/api/admin/state"));
});

test("friend share text is the meeting name plus the canonical URL", () => {
  useSite();
  const payload = publicSharePayload("Intro call", "/intro?k=should-not-leak");
  assert.equal(payload.title, "Intro call with Alex Rivera");
  assert.equal(payload.text, "Intro call with Alex Rivera");
  assert.equal(payload.url, "https://schedule.example.com/intro");
  assert.equal(payload.url.includes("k="), false);
  assert.equal(payload.text.includes("secret"), false);
});

test("closing the share sheet is not a failure", () => {
  assert.equal(isShareCancellation({ name: "AbortError" }), true);
  assert.equal(isShareCancellation({ name: "NotAllowedError" }), false);
  assert.equal(isShareCancellation(new Error("nope")), false);
});

test("admin sign-in returns to /admin without a token", () => {
  assert.equal(adminSignInReturnUrl("https://schedule.example.com"), "https://schedule.example.com/admin");
  assert.equal(
    adminSignInReturnUrl("https://schedule.example.com", "?google=denied"),
    "https://schedule.example.com/admin?google=denied",
  );
  assert.equal(adminSignInReturnUrl("https://schedule.example.com").includes("t="), false);
  assert.equal(adminManifest().start_url, adminSignInReturnUrl("https://schedule.example.com").replace("https://schedule.example.com", ""));
});

test("public and admin home-screen apps are different identities", () => {
  const pub = publicManifest();
  const admin = adminManifest();
  assert.equal(pub.start_url, "/");
  assert.equal(pub.scope, "/");
  assert.equal(pub.id, "/");
  assert.equal(admin.start_url, "/admin");
  assert.equal(admin.scope, "/admin");
  assert.equal(admin.id, "/admin");
  assert.notEqual(pub.short_name, admin.short_name);
  assert.notEqual(pub.theme_color, admin.theme_color);
  assert.equal(pub.icons.some((icon) => icon.src.startsWith("/admin")), false);
  assert.equal(admin.icons.every((icon) => icon.src.startsWith("/admin/")), true);
});
