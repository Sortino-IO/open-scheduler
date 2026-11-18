import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Outside a Next server unstable_cache has no backing store; run the callback directly.
const nextCache = createRequire(path.resolve("package.json"))("next/cache") as { unstable_cache: unknown };
nextCache.unstable_cache = (callback: () => unknown) => callback;

// File-backed store in a throwaway directory, mock calendar, no holidays.
process.chdir(mkdtempSync(path.join(tmpdir(), "slots-freshness-")));
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;
Object.assign(process.env, { CALENDAR_DRY_RUN: "true", EMAIL_DRY_RUN: "true" });
globalThis.fetch = (async () => Response.json({ items: [] })) as typeof fetch;

const modules = Promise.all([import("../lib/scheduling"), import("../lib/store"), import("../lib/day-settings"), import("../app/api/slots/route")]);

const now = new Date("2026-11-18T09:12:00.000Z"); // Wed 18 Nov, 11:12 Israel: when the bug was reported
const intro = { meetingSlug: "intro", timeZone: "Asia/Jerusalem", month: "2026-11", now };

async function labels(date: string) {
  const [{ getMonthSlots }] = await modules;
  const month = await getMonthSlots(intro);
  return month.days.find((day) => day.date === date)?.slots.map((slot) => slot.label) ?? [];
}

test("a one-day US open shows on the public Intro month on the very next request", async () => {
  const [, { updateStore }, { withDayUsOpen }] = await modules;
  assert.equal((await labels("2026-11-24")).includes("9:00 PM"), false);

  await updateStore((data) => {
    data.admin = withDayUsOpen(data.admin, "2026-11-24", true);
  });
  const tuesday = await labels("2026-11-24");
  assert.deepEqual(tuesday.slice(-6), ["9:00 PM", "9:30 PM", "10:00 PM", "10:30 PM", "11:00 PM", "11:30 PM"]);
  // Dates without the switch keep daytime only.
  assert.equal((await labels("2026-11-23")).some((label) => label.endsWith("PM") && label.startsWith("9:")), false);
  assert.equal((await labels("2026-11-25")).includes("9:00 PM"), false);

  await updateStore((data) => {
    data.admin = withDayUsOpen(data.admin, "2026-11-24", false);
  });
  assert.equal((await labels("2026-11-24")).includes("9:00 PM"), false);
});

test("the global US switch also applies on the next request", async () => {
  const [, { updateStore }] = await modules;
  await updateStore((data) => {
    data.admin.usSlotsOpen = true;
  });
  assert.equal((await labels("2026-11-23")).includes("9:00 PM"), true);
  await updateStore((data) => {
    data.admin.usSlotsOpen = false;
  });
  assert.equal((await labels("2026-11-23")).includes("9:00 PM"), false);
});

test("the public slots API forbids shared and browser caching", async () => {
  const [, , , { GET }] = await modules;
  const response = await GET(new Request("https://schedule.example/api/slots?meeting=intro&month=2026-11&timeZone=Asia/Jerusalem"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a valid reschedule link frees the visitor's own booking; a wrong token does not", async () => {
  const [{ getMonthSlots, book }] = await modules;
  const month = { meetingSlug: "45", timeZone: "Asia/Jerusalem", month: "2026-11", now };
  const startsOn = async (extra: object = {}) =>
    (await getMonthSlots({ ...month, ...extra })).days.find((day) => day.date === "2026-11-26")?.slots.map((slot) => slot.start) ?? [];
  const [first] = await startsOn();
  const booking = await book(
    { meetingSlug: "45", start: first, timeZone: "Asia/Jerusalem", name: "Test Visitor", email: "visitor@example.com", mode: "meet" },
    "https://schedule.example",
    now,
  );
  assert.equal((await startsOn()).includes(first), false);
  assert.equal((await startsOn({ rescheduleId: booking.id, rescheduleToken: "wrong" })).includes(first), false);
  assert.equal((await startsOn({ rescheduleId: booking.id, rescheduleToken: booking.token })).includes(first), true);
});

test("a regular closure is enforced on slots, booking, and reschedule, per meeting type", async () => {
  const [{ getMonthSlots, book }, { updateStore }] = await modules;
  const sunday = async (meetingSlug: string, extra: object = {}) =>
    (await getMonthSlots({ meetingSlug, timeZone: "Asia/Jerusalem", month: "2026-11", now, ...extra })).days.find((day) => day.date === "2026-11-29")?.slots ?? [];
  const [open] = await sunday("intro");
  const request = { meetingSlug: "intro", start: open.start, timeZone: "Asia/Jerusalem", name: "Test Visitor", email: "closure@example.com", mode: "meet" };
  const existing = await book(request, "https://schedule.example", now);

  await updateStore((data) => {
    data.admin.regularClosures.push({ id: "sun", weekdays: [0], ranges: [], meetings: ["intro"], from: null, until: null });
  });
  assert.deepEqual(await sunday("intro"), []);
  assert.deepEqual(await sunday("intro", { rescheduleId: existing.id, rescheduleToken: existing.token }), []);
  await assert.rejects(book({ ...request, email: "other@example.com" }, "https://schedule.example", now), /no longer open/);
  await assert.rejects(
    book({ ...request, rescheduleId: existing.id, rescheduleToken: existing.token }, "https://schedule.example", now),
    /no longer open/,
  );
  // The rule names Intro only: 45-minute meetings on a closed weekday stay bookable.
  await updateStore((data) => {
    data.admin.regularClosures[0].weekdays = [0, 1];
  });
  const monday = async (meetingSlug: string) =>
    (await getMonthSlots({ meetingSlug, timeZone: "Asia/Jerusalem", month: "2026-11", now })).days.find((d) => d.date === "2026-11-30")?.slots ?? [];
  assert.deepEqual(await monday("intro"), []);
  assert.ok((await monday("45")).length > 0);
  await updateStore((data) => {
    data.admin.regularClosures = [];
  });
});
