import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Outside a Next server unstable_cache has no backing store; run the callback directly.
const nextCache = createRequire(path.resolve("package.json"))("next/cache") as { unstable_cache: unknown };
nextCache.unstable_cache = (callback: () => unknown) => callback;

// The file-backed store and marker resolve paths from cwd at import time: isolate them first.
const workdir = mkdtempSync(path.join(tmpdir(), "calendar-health-"));
process.chdir(workdir);
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;
Object.assign(process.env, {
  EMAIL_DRY_RUN: "true",
  NOTIFY_EMAIL: "alerts@example.com",
  GOOGLE_CLIENT_ID: "client-1",
  GOOGLE_CLIENT_SECRET: "secret-1",
});

const modules = Promise.all([import("../lib/calendar"), import("../lib/calendar-health"), import("../lib/scheduling")]);

const markerPath = path.join(workdir, ".data", "calendar-disconnected.json");
const alerts = () =>
  (JSON.parse(readFileSync(path.join(workdir, ".data", "store.json"), "utf8")).emails as { kind: string; to: string; subject: string }[])
    .filter((email) => email.kind === "calendar_alert");

/** Google's token endpoint answers with `body`; the holiday feed has no holidays. */
function googleToken(status: number, body: Record<string, unknown>) {
  globalThis.fetch = (async (input: string | URL | Request) =>
    String(input instanceof Request ? input.url : input).startsWith("https://oauth2.googleapis.com/token")
      ? Response.json(body, { status })
      : Response.json({ items: [] })) as typeof fetch;
}

test("only grant rejections count as a disconnected calendar", async () => {
  const [{ accountGrantStatus, CalendarAuthError, isCalendarAuthError }] = await modules;
  assert.equal(isCalendarAuthError(new CalendarAuthError("invalid_grant")), true);
  assert.equal(isCalendarAuthError(new Error("invalid_grant")), true);
  assert.equal(isCalendarAuthError(new Error("Calendar list failed (500)")), false);
  googleToken(400, { error: "invalid_grant" });
  assert.equal(await accountGrantStatus("revoked-token"), "disconnected");
  googleToken(503, { error: "backendError" });
  assert.equal(await accountGrantStatus("flaky-token"), "unknown");
  googleToken(200, { access_token: "at", expires_in: 3600 });
  assert.equal(await accountGrantStatus("good-token"), "ok");
});

test("a failing public slots request sends one alert, and a reconnect re-arms it", async () => {
  const [, { clearCalendarDisconnected, reportCalendarDisconnected }, { getMonthSlots }] = await modules;
  mkdirSync(path.join(workdir, ".data"), { recursive: true });
  writeFileSync(
    path.join(workdir, ".data", "google-calendar-connections.json"),
    JSON.stringify({
      version: 2,
      accounts: [
        {
          id: "acc-1",
          email: "owner@example.com",
          refresh_token: "revoked-refresh",
          obtained_at: "2026-11-05T10:00:00.000Z",
          calendars: [{ id: "owner@example.com", summary: "Owner", primary: true, checkConflicts: true }],
        },
      ],
      bookingTarget: { accountId: "acc-1", calendarId: "owner@example.com" },
    }),
  );
  googleToken(400, { error: "invalid_grant" });
  const request = { meetingSlug: "intro", timeZone: "Asia/Jerusalem", month: "2026-11" };
  await assert.rejects(() => getMonthSlots(request), /temporarily unavailable/);
  await assert.rejects(() => getMonthSlots(request), /temporarily unavailable/);
  assert.equal(alerts().length, 1);
  assert.equal(alerts()[0].to, "alerts@example.com");
  assert.equal(alerts()[0].subject, "scheduler alert: calendar disconnected");

  // Another instance (no in-memory memo) still sees the persisted marker and stays quiet.
  await reportCalendarDisconnected("invalid_grant", Date.now() + 2 * 60 * 60 * 1000);
  assert.equal(alerts().length, 1);

  await clearCalendarDisconnected();
  assert.throws(() => readFileSync(markerPath));
  await reportCalendarDisconnected("invalid_grant");
  assert.equal(alerts().length, 2);
});
