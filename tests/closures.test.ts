import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSlots } from "../lib/availability";
import { describeClosure, parseClosure, type RegularClosure } from "../lib/closures";
import { MEETINGS } from "../lib/meetings";
import { normalizeStore } from "../lib/store";
import { formatIsoDate } from "../lib/time";

const now = new Date("2026-11-05T08:00:00.000Z"); // Thursday
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jerusalem" });

function times(
  meeting: "intro" | "45" | "inperson",
  date: string,
  closures: RegularClosure[],
  extra: { us?: boolean; open?: string[]; usOpen?: string[] } = {},
): string[] {
  return generateSlots({
    now,
    meeting: MEETINGS[meeting],
    usSlotsOpen: extra.us ?? false,
    busy: [],
    blockedHostDates: new Set(),
    openHostDates: new Set(extra.open ?? []),
    usOpenHostDates: new Set(extra.usOpen ?? []),
    closures,
  })
    .filter((slot) => formatIsoDate(slot.start, "Asia/Jerusalem") === date)
    .map((slot) => clock.format(slot.start));
}

const rule = (fields: Partial<RegularClosure>): RegularClosure => ({
  id: "c1",
  weekdays: [2],
  ranges: [],
  meetings: ["intro", "45"],
  from: null,
  until: null,
  ...fields,
});

test("a whole-day closure removes that weekday only for the meeting types it names", () => {
  const introOnly = [rule({ meetings: ["intro"] })];
  assert.deepEqual(times("intro", "2026-11-10", introOnly), []);
  assert.deepEqual(times("intro", "2026-11-17", introOnly), []);
  assert.ok(times("45", "2026-11-10", introOnly).length > 0);
  assert.ok(times("intro", "2026-11-09", introOnly).length > 0); // Monday untouched
});

test("a time-range closure removes only overlapping starts", () => {
  const morning = [rule({ ranges: [{ startMinute: 11 * 60, endMinute: 12 * 60 }] })];
  assert.deepEqual(times("intro", "2026-11-10", morning), ["12:00", "12:30", "13:00", "13:30", "14:00", "14:30"]);
  // A 45-minute meeting at 11:15 would run into the closed hour; 12:00 is the first allowed start.
  assert.equal(times("45", "2026-11-10", morning)[0], "12:00");
});

test("closures beat the global US switch, but a one-off day switch overrides them for its window", () => {
  const evenings = [rule({ ranges: [{ startMinute: 21 * 60, endMinute: 24 * 60 }] })];
  assert.equal(times("intro", "2026-11-10", evenings, { us: true }).includes("21:00"), false);
  assert.equal(times("intro", "2026-11-10", evenings, { usOpen: ["2026-11-10"] }).includes("21:00"), true);
  const wholeDay = [rule({})];
  assert.deepEqual(times("intro", "2026-11-10", wholeDay, { open: ["2026-11-10"] }).slice(0, 2), ["11:00", "11:30"]);
  // Opening the daytime once does not reopen a closed US evening on that date.
  assert.equal(times("intro", "2026-11-10", wholeDay, { open: ["2026-11-10"], us: true }).includes("21:00"), false);
});

test("one rule can close several time ranges on the same day", () => {
  const split = [rule({ ranges: [{ startMinute: 11 * 60, endMinute: 12 * 60 }, { startMinute: 13 * 60, endMinute: 14 * 60 }] })];
  assert.deepEqual(times("intro", "2026-11-10", split), ["12:00", "12:30", "14:00", "14:30"]);
});

test("optional start and end dates bound a closure", () => {
  const bounded = [rule({ from: "2026-11-11", until: "2026-11-20" })];
  assert.ok(times("intro", "2026-11-10", bounded).length > 0);
  assert.deepEqual(times("intro", "2026-11-17", bounded), []);
  assert.ok(times("intro", "2026-11-24", bounded).length > 0);
});

test("in-person meetings ignore closures", () => {
  const all = [rule({ weekdays: [0, 1, 2, 3, 4, 5, 6] })];
  assert.deepEqual(times("inperson", "2026-11-10", all, { us: true }), times("inperson", "2026-11-10", [], { us: true }));
});

test("parseClosure validates every field", () => {
  const ok = { weekdays: [3, 1, 1], ranges: [{ startMinute: 960, endMinute: 1080 }, { startMinute: 540, endMinute: 720 }], meetings: ["45"], from: "", until: null };
  assert.deepEqual(parseClosure(ok), {
    weekdays: [1, 3],
    ranges: [{ startMinute: 540, endMinute: 720 }, { startMinute: 960, endMinute: 1080 }],
    meetings: ["45"],
    from: null,
    until: null,
  });
  // Rules saved before multiple ranges existed keep working.
  assert.deepEqual((parseClosure({ weekdays: [1], startMinute: 540, endMinute: 720, meetings: ["intro"] }) as RegularClosure).ranges, [{ startMinute: 540, endMinute: 720 }]);
  assert.deepEqual((parseClosure({ weekdays: [1], startMinute: null, endMinute: null, meetings: ["intro"] }) as RegularClosure).ranges, []);
  const one = (startMinute: unknown, endMinute: unknown) => ({ ...ok, ranges: [{ startMinute, endMinute }] });
  const bad: unknown[] = [
    null,
    "x",
    { ...ok, weekdays: [] },
    { ...ok, weekdays: [7] },
    { ...ok, weekdays: ["1"] },
    one("540", 720),
    one(540, 2000),
    one(720, 540),
    one(null, 720),
    { ...ok, ranges: [{ startMinute: 540, endMinute: 720 }, { startMinute: 700, endMinute: 800 }] },
    { ...ok, ranges: "x" },
    { ...ok, ranges: Array.from({ length: 9 }, (_, i) => ({ startMinute: i * 60, endMinute: i * 60 + 30 })) },
    { weekdays: [1], startMinute: 540, meetings: ["intro"] },
    { ...ok, meetings: [] },
    { ...ok, meetings: ["inperson"] },
    { ...ok, meetings: ["intro", "nope"] },
    { ...ok, from: "2026-02-30" },
    { ...ok, from: "2026-12-10", until: "2026-12-01" },
  ];
  for (const input of bad) assert.ok("error" in parseClosure(input), JSON.stringify(input));
  assert.equal(describeClosure(parseClosure({ ...ok, meetings: ["intro", "45"], ranges: [] }) as RegularClosure), "Mon, Wed · All day · Intro and 45-minute");
  assert.equal(describeClosure(parseClosure(ok) as RegularClosure), "Mon, Wed · 09:00–12:00, 16:00–18:00 · 45-minute");
});

test("stored closures load backward compatibly", () => {
  assert.deepEqual(normalizeStore({ admin: { usSlotsOpen: false } } as never).admin.regularClosures, []);
  const loaded = normalizeStore({
    admin: {
      regularClosures: [
        rule({ id: "keep" }),
        { id: "legacy", weekdays: [1], startMinute: 600, endMinute: 660, meetings: ["intro"], from: null, until: null },
        { id: "drop", weekdays: [] },
        { weekdays: [1], meetings: ["intro"] },
      ],
    },
  } as never).admin.regularClosures;
  assert.deepEqual(loaded.map((c) => c.id), ["keep", "legacy"]);
  assert.deepEqual(loaded[1].ranges, [{ startMinute: 600, endMinute: 660 }]);
});
