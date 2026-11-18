import assert from "node:assert/strict";
import { test } from "node:test";
import { eachOccurrence, expandBlocks, nextOccurrence, overlapsRanges } from "../lib/blocks";
import { generateSlots } from "../lib/availability";
import { MEETINGS } from "../lib/meetings";

test("weekly recurrence advances by 7 days", () => {
  assert.equal(nextOccurrence("2026-11-09", "weekly"), "2026-11-16");
});

test("monthly recurrence clamps day 31", () => {
  assert.equal(nextOccurrence("2026-01-31", "monthly"), "2026-02-28");
});

test("expandBlocks merges whole-day manual and recurring ranges", () => {
  const { wholeDays, ranges } = expandBlocks({
    manualBlocks: ["2026-11-10"],
    timeBlocks: [{ id: "t1", date: "2026-11-11", startMinute: 11 * 60, endMinute: 13 * 60 }],
    recurringBlocks: [
      {
        id: "r1",
        frequency: "weekly",
        anchorDate: "2026-11-09",
        startMinute: null,
        endMinute: null,
        until: "2026-11-30",
      },
    ],
    from: "2026-11-08",
    to: "2026-11-30",
  });
  assert.equal(wholeDays.has("2026-11-10"), true);
  assert.equal(wholeDays.has("2026-11-09"), true);
  assert.equal(wholeDays.has("2026-11-16"), true);
  assert.equal(ranges.some((r) => r.date === "2026-11-11" && !r.wholeDay), true);
});

test("partial time block removes overlapping intro slots", () => {
  const now = new Date("2026-11-05T08:00:00.000Z");
  const slots = generateSlots({
    now,
    meeting: MEETINGS.intro,
    usSlotsOpen: false,
    busy: [],
    blockedHostDates: new Set(),
    rangeBlocks: [
      { date: "2026-11-09", startMinute: 11 * 60, endMinute: 12 * 60, wholeDay: false, source: "time", id: "x" },
    ],
  });
  const day = slots.filter((s) => s.start.toISOString().startsWith("2026-11-09"));
  // 11:00 and 11:30 Israel = 09:00 and 09:30Z should be gone; 12:00 Israel = 10:00Z remains
  assert.equal(day.some((s) => s.start.toISOString() === "2026-11-09T09:00:00.000Z"), false);
  assert.equal(day.some((s) => s.start.toISOString() === "2026-11-09T09:30:00.000Z"), false);
  assert.equal(day.some((s) => s.start.toISOString() === "2026-11-09T10:00:00.000Z"), true);
});

test("in-person slots only appear evenings from 21:30 when evening toggle is on", () => {
  const now = new Date("2026-11-05T08:00:00.000Z");
  const off = generateSlots({
    now,
    meeting: MEETINGS.inperson,
    usSlotsOpen: false,
    busy: [],
    blockedHostDates: new Set(),
  });
  assert.equal(off.length, 0);
  const on = generateSlots({
    now,
    meeting: MEETINGS.inperson,
    usSlotsOpen: true,
    busy: [],
    blockedHostDates: new Set(),
  });
  const monday = on.filter((s) => s.start.toISOString().startsWith("2026-11-09"));
  assert.equal(monday[0]?.start.toISOString(), "2026-11-09T19:30:00.000Z");
  assert.equal(monday.some((s) => s.start.toISOString() === "2026-11-09T19:00:00.000Z"), false);
});

test("overlapsRanges detects partial overlap", () => {
  assert.equal(
    overlapsRanges("2026-11-09", 11 * 60, 12 * 60, [
      { date: "2026-11-09", startMinute: 11 * 60 + 30, endMinute: 13 * 60, wholeDay: false, source: "time" },
    ]),
    true,
  );
});

test("eachOccurrence yearly respects until", () => {
  const dates = eachOccurrence(
    {
      id: "y",
      frequency: "yearly",
      anchorDate: "2026-11-09",
      startMinute: null,
      endMinute: null,
      until: "2028-01-01",
    },
    "2026-01-01",
    "2030-01-01",
  );
  assert.deepEqual(dates, ["2026-11-09", "2027-11-09"]);
});
