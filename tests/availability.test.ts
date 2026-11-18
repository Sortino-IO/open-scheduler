import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSlots, groupByVisitorDate } from "../lib/availability";
import { MEETINGS } from "../lib/meetings";
import { zonedDateTime } from "../lib/time";

const now = new Date("2026-11-05T08:00:00.000Z");

function days(meeting: "intro" | "45" | "inperson", us: boolean, month: string, tz: string, extra?: { blocked?: string[]; open?: string[]; usOpen?: string[]; ranges?: { date: string; startMinute: number; endMinute: number }[]; busy?: { start: Date; end: Date; dayRules?: boolean; physical?: boolean }[] }) {
  const slots = generateSlots({
    now,
    meeting: MEETINGS[meeting],
    usSlotsOpen: us,
    busy: extra?.busy ?? [],
    blockedHostDates: new Set(extra?.blocked ?? []),
    openHostDates: extra?.open ? new Set(extra.open) : undefined,
    usOpenHostDates: extra?.usOpen ? new Set(extra.usOpen) : undefined,
    rangeBlocks: extra?.ranges?.map((range) => ({ ...range, wholeDay: false, source: "manual" })),
  });
  return groupByVisitorDate(slots, tz, month);
}

function starts(meeting: "intro" | "45", us: boolean, date: string) {
  const found = days(meeting, us, date.slice(0, 7), "Asia/Jerusalem").find((day) => day.date === date);
  return (found?.slots ?? []).map((slot) => slot.start.toISOString());
}

test("intro skips today, Friday, and Saturday, and stays inside 11:00–15:00", () => {
  const jerusalem = days("intro", false, "2026-11", "Asia/Jerusalem");
  const dates = jerusalem.map((day) => day.date);
  assert.equal(dates.includes("2026-11-05"), false);
  assert.equal(dates.includes("2026-11-06"), false);
  assert.equal(dates.includes("2026-11-07"), false);
  assert.equal(dates.includes("2026-11-08"), true);
  assert.equal(dates.includes("2026-11-11"), true);
  const sunday = starts("intro", false, "2026-11-08");
  assert.equal(sunday[0], "2026-11-08T09:00:00.000Z");
  assert.equal(sunday.at(-1), "2026-11-08T12:30:00.000Z");
  assert.equal(sunday.includes("2026-11-08T19:00:00.000Z"), false);
});

test("US evening slots appear only when the toggle is on, and end by midnight", () => {
  const off = starts("intro", false, "2026-11-09");
  assert.equal(off.includes("2026-11-09T19:00:00.000Z"), false);
  const on = starts("intro", true, "2026-11-09");
  assert.equal(on.includes("2026-11-09T19:00:00.000Z"), true);
  assert.equal(on.includes("2026-11-09T21:30:00.000Z"), true);
  assert.equal(on.includes("2026-11-09T21:45:00.000Z"), false);
  const sunday = starts("intro", true, "2026-11-08");
  assert.equal(sunday.includes("2026-11-08T19:00:00.000Z"), false);
  const thursday = starts("intro", true, "2026-11-12");
  assert.equal(thursday.includes("2026-11-12T19:00:00.000Z"), false);
});

test("45 minute meetings use Mon/Tue/Thu by day and Mon/Tue/Wed for US evenings", () => {
  const offDates = days("45", false, "2026-11", "Asia/Jerusalem").map((day) => day.date);
  assert.deepEqual(
    offDates.filter((date) => date <= "2026-11-12"),
    ["2026-11-09", "2026-11-10", "2026-11-12"],
  );
  assert.equal(offDates.includes("2026-11-11"), false);
  assert.equal(offDates.includes("2026-11-18"), false);

  const onDates = days("45", true, "2026-11", "Asia/Jerusalem").map((day) => day.date);
  assert.equal(onDates.includes("2026-11-11"), true);
  const wednesday = starts("45", true, "2026-11-11");
  assert.equal(wednesday[0], "2026-11-11T19:00:00.000Z");
  assert.equal(wednesday.at(-1), "2026-11-11T21:15:00.000Z");
  assert.equal(wednesday.includes("2026-11-11T09:00:00.000Z"), false);
  assert.equal(wednesday.includes("2026-11-11T21:30:00.000Z"), false);

  const thursday = starts("45", true, "2026-11-12");
  assert.equal(thursday[0], "2026-11-12T09:00:00.000Z");
  assert.equal(thursday.at(-1), "2026-11-12T12:15:00.000Z");
  assert.equal(thursday.includes("2026-11-12T19:00:00.000Z"), false);
});

test("manual blocks and holidays close the whole Israel day", () => {
  const blocked = days("intro", true, "2026-11", "Asia/Jerusalem", { blocked: ["2026-11-08", "2026-11-09"] });
  const dates = blocked.map((day) => day.date);
  assert.equal(dates.includes("2026-11-08"), false);
  assert.equal(dates.includes("2026-11-09"), false);
  assert.equal(dates.includes("2026-11-10"), true);
});

test("a timed conflict removes only the overlapping start", () => {
  const busy = [{ start: zonedDateTime("2026-11-08", 12 * 60, "Asia/Jerusalem"), end: zonedDateTime("2026-11-08", 12 * 60 + 30, "Asia/Jerusalem") }];
  const sunday = days("intro", false, "2026-11", "Asia/Jerusalem", { busy }).find((day) => day.date === "2026-11-08");
  const iso = sunday?.slots.map((slot) => slot.start.toISOString()) ?? [];
  assert.equal(iso.includes("2026-11-08T09:30:00.000Z"), true);
  assert.equal(iso.includes("2026-11-08T10:00:00.000Z"), false);
  assert.equal(iso.includes("2026-11-08T10:30:00.000Z"), true);
});

test("evening Israel slots can fall on the next calendar day for a visitor ahead of Israel", () => {
  const tokyo = days("intro", true, "2026-11", "Asia/Tokyo");
  const monday = tokyo.find((day) => day.date === "2026-11-09");
  const tuesday = tokyo.find((day) => day.date === "2026-11-10");
  assert.equal(monday?.slots.some((slot) => slot.start.toISOString() === "2026-11-09T21:30:00.000Z"), false);
  assert.equal(tuesday?.slots.some((slot) => slot.start.toISOString() === "2026-11-09T21:30:00.000Z"), true);
});

test("a Sunday morning Israel slot can show on Saturday for a visitor in Hawaii", () => {
  const hawaii = days("intro", false, "2026-11", "Pacific/Honolulu");
  const saturday = hawaii.find((day) => day.date === "2026-11-07");
  assert.equal(saturday?.slots.some((slot) => slot.start.toISOString() === "2026-11-08T09:00:00.000Z"), true);
});

test("summer slots use Israel daylight time", () => {
  const summerNow = new Date("2027-07-01T08:00:00.000Z");
  const slots = generateSlots({
    now: summerNow,
    meeting: MEETINGS.intro,
    usSlotsOpen: false,
    busy: [],
    blockedHostDates: new Set(),
  });
  const monday = slots.find((slot) => slot.start.toISOString() === "2027-07-05T08:00:00.000Z");
  assert.ok(monday);
});

function isoStarts(day: { slots: { start: Date }[] } | undefined) {
  return (day?.slots ?? []).map((slot) => slot.start.toISOString());
}

test("online mid-day events keep the day open with a 30-minute buffer, and do not use a 4h buffer", () => {
  const at = (date: string, h: number, m = 0) => zonedDateTime(date, h * 60 + m, "Asia/Jerusalem");

  // A mid-afternoon online event used to close the whole day.
  const doctor = { start: at("2026-11-08", 16, 30), end: at("2026-11-08", 17, 30), dayRules: true };
  const sundayDoctor = days("intro", false, "2026-11", "Asia/Jerusalem", { busy: [doctor] }).find((day) => day.date === "2026-11-08");
  assert.equal(sundayDoctor?.slots.length, 8);

  // Evening online event at 17:00: 30-min buffer does not reach the 11:00–15:00 window (previously a 4h pre-buffer cut 13:30–15:00).
  const evening = { start: at("2026-11-16", 17), end: at("2026-11-16", 18), dayRules: true };
  const monday = days("intro", false, "2026-11", "Asia/Jerusalem", { busy: [evening] }).find((day) => day.date === "2026-11-16");
  assert.equal(monday?.slots.length, 8);
  assert.equal(isoStarts(monday).includes("2026-11-16T11:30:00.000Z"), true);

  const morning = { start: at("2026-11-17", 7, 30), end: at("2026-11-17", 8, 30), dayRules: true };
  const tuesday = days("intro", false, "2026-11", "Asia/Jerusalem", { busy: [morning] }).find((day) => day.date === "2026-11-17");
  assert.equal(tuesday?.slots.length, 8);

  const ownBooking = { start: at("2026-11-18", 12), end: at("2026-11-18", 12, 30) };
  const wednesday = days("intro", false, "2026-11", "Asia/Jerusalem", { busy: [ownBooking] }).find((day) => day.date === "2026-11-18");
  assert.equal(wednesday?.slots.length, 7);
});

test("Tue 17 Nov: an untitled in-day event (no location) and a morning Meet event leave the day open, with only 11:30–13:30 blocked", () => {
  const at = (date: string, h: number, m = 0) => zonedDateTime(date, h * 60 + m, "Asia/Jerusalem");
  const midday = { start: at("2026-11-17", 12), end: at("2026-11-17", 13), dayRules: true };
  const vaccine = { start: at("2026-11-17", 7, 30), end: at("2026-11-17", 8, 30), dayRules: true };
  const tuesday = days("intro", false, "2026-11", "Asia/Jerusalem", { busy: [midday, vaccine] }).find((day) => day.date === "2026-11-17");
  assert.ok(tuesday);
  assert.deepEqual(isoStarts(tuesday), [
    "2026-11-17T09:00:00.000Z", // 11:00 Israel, ends at the 11:30 buffer
    "2026-11-17T11:30:00.000Z", // 13:30 Israel, starts at the end of the after-buffer
    "2026-11-17T12:00:00.000Z",
    "2026-11-17T12:30:00.000Z",
  ]);
  assert.equal(isoStarts(tuesday).includes("2026-11-17T09:30:00.000Z"), false); // 11:30
  assert.equal(isoStarts(tuesday).includes("2026-11-17T10:00:00.000Z"), false); // 12:00
  assert.equal(isoStarts(tuesday).includes("2026-11-17T11:00:00.000Z"), false); // 13:00

  // The 45-minute type's standardDays are Mon/Tue/Thu only — Wednesday stays closed even with these events gone.
  const wednesday = days("45", false, "2026-11", "Asia/Jerusalem", { busy: [midday, vaccine] }).find((day) => day.date === "2026-11-18");
  assert.equal(wednesday, undefined);
});

test("a physical event blocks 4 hours before and 4 hours after; a Meet URL in the location is online", () => {
  const at = (date: string, h: number, m = 0) => zonedDateTime(date, h * 60 + m, "Asia/Jerusalem");

  // 12:00–13:00 physical: padded 08:00–17:00, so the entire 11:00–15:00 intro window is closed.
  const clinic = { start: at("2026-11-17", 12), end: at("2026-11-17", 13), dayRules: true, physical: true };
  const physicalDay = days("intro", false, "2026-11", "Asia/Jerusalem", { busy: [clinic] }).find((day) => day.date === "2026-11-17");
  assert.equal(physicalDay, undefined);

  // Morning physical 07:30–08:30: padded 03:30–12:30. 12:30 Israel (10:30Z) is open; 12:00 (10:00Z) is not.
  const morningPhysical = { start: at("2026-11-16", 7, 30), end: at("2026-11-16", 8, 30), dayRules: true, physical: true };
  const monday = days("intro", false, "2026-11", "Asia/Jerusalem", { busy: [morningPhysical] }).find((day) => day.date === "2026-11-16");
  assert.deepEqual(isoStarts(monday), [
    "2026-11-16T10:30:00.000Z",
    "2026-11-16T11:00:00.000Z",
    "2026-11-16T11:30:00.000Z",
    "2026-11-16T12:00:00.000Z",
    "2026-11-16T12:30:00.000Z",
  ]);

  // Same times as the midday event, but location is a Meet URL — treated as online in generateSlots when physical is unset.
  const meetInLocation = { start: at("2026-11-10", 12), end: at("2026-11-10", 13), dayRules: true };
  const tuesday = days("intro", false, "2026-11", "Asia/Jerusalem", { busy: [meetInLocation] }).find((day) => day.date === "2026-11-10");
  assert.deepEqual(isoStarts(tuesday), [
    "2026-11-10T09:00:00.000Z",
    "2026-11-10T11:30:00.000Z",
    "2026-11-10T12:00:00.000Z",
    "2026-11-10T12:30:00.000Z",
  ]);
});

test("a one-off open offers the 45-minute daytime window on a Wednesday, and still respects calendar rules", () => {
  const at = (date: string, h: number, m = 0) => zonedDateTime(date, h * 60 + m, "Asia/Jerusalem");

  // Without an exception, Wed 18 stays closed (standardDays are Mon/Tue/Thu).
  assert.equal(days("45", false, "2026-11", "Asia/Jerusalem").find((day) => day.date === "2026-11-18"), undefined);

  const opened = days("45", false, "2026-11", "Asia/Jerusalem", { open: ["2026-11-18"] }).find((day) => day.date === "2026-11-18");
  assert.ok(opened);
  assert.equal(opened.slots[0].start.toISOString(), "2026-11-18T09:00:00.000Z"); // 11:00 Israel
  assert.equal(opened.slots.at(-1)?.start.toISOString(), "2026-11-18T12:15:00.000Z"); // 14:15 Israel, ends 15:00
  assert.equal(opened.slots.length, 14);

  // Friday and a holiday/manual whole-day block stay closed even if listed as a one-off open.
  const friday = days("45", false, "2026-11", "Asia/Jerusalem", { open: ["2026-11-13"] }).find((day) => day.date === "2026-11-13");
  assert.equal(friday, undefined);
  const holiday = days("45", false, "2026-11", "Asia/Jerusalem", { open: ["2026-11-18"], blocked: ["2026-11-18"] }).find((day) => day.date === "2026-11-18");
  assert.equal(holiday, undefined);

  // Calendar events and the 30-minute online buffer still apply on an opened Wednesday.
  const meeting = { start: at("2026-11-18", 12), end: at("2026-11-18", 13), dayRules: true };
  const withBusy = days("45", false, "2026-11", "Asia/Jerusalem", { open: ["2026-11-18"], busy: [meeting] }).find((day) => day.date === "2026-11-18");
  const iso = isoStarts(withBusy);
  assert.equal(iso.includes("2026-11-18T09:00:00.000Z"), false); // 11:00 45-min overlaps 11:30
  assert.deepEqual(
    iso.filter((start) => start >= "2026-11-18T11:30:00.000Z"),
    ["2026-11-18T11:30:00.000Z", "2026-11-18T11:45:00.000Z", "2026-11-18T12:00:00.000Z", "2026-11-18T12:15:00.000Z"],
  );

  // A one-off open does not add US evening slots on a weekday that is not in usDays (Sunday).
  const sunday = days("45", true, "2026-11", "Asia/Jerusalem", { open: ["2026-11-22"] }).find((day) => day.date === "2026-11-22");
  assert.equal(sunday?.slots[0].start.toISOString(), "2026-11-22T09:00:00.000Z");
  assert.equal(isoStarts(sunday).includes("2026-11-22T19:00:00.000Z"), false);
  // Intro already includes Wednesday; a one-off does not duplicate or change its 8 daytime slots.
  const intro = days("intro", false, "2026-11", "Asia/Jerusalem", { open: ["2026-11-18"] }).find((day) => day.date === "2026-11-18");
  assert.equal(intro?.slots.length, 8);
});

test("a one-day US open offers 21:00–24:00 on that date only, with the global toggle off", () => {
  const usOpen = ["2026-11-16"];
  const monday = days("intro", false, "2026-11", "Asia/Jerusalem", { usOpen }).find((day) => day.date === "2026-11-16");
  const iso = isoStarts(monday);
  assert.deepEqual(
    iso.filter((start) => start >= "2026-11-16T19:00:00.000Z"),
    ["2026-11-16T19:00:00.000Z", "2026-11-16T19:30:00.000Z", "2026-11-16T20:00:00.000Z", "2026-11-16T20:30:00.000Z", "2026-11-16T21:00:00.000Z", "2026-11-16T21:30:00.000Z"],
  );
  assert.equal(iso[0], "2026-11-16T09:00:00.000Z"); // daytime unchanged
  // The next Monday stays daytime-only.
  const nextMonday = days("intro", false, "2026-11", "Asia/Jerusalem", { usOpen }).find((day) => day.date === "2026-11-23");
  assert.equal(isoStarts(nextMonday).some((start) => start >= "2026-11-23T19:00:00.000Z"), false);
  // Global toggle plus a one-day open does not duplicate starts.
  const both = days("intro", true, "2026-11", "Asia/Jerusalem", { usOpen }).find((day) => day.date === "2026-11-16");
  assert.deepEqual(isoStarts(both), iso);
});

test("a one-day US open works on weekdays outside usDays, but never Friday, Saturday, or blocked days", () => {
  const sunday = days("intro", false, "2026-11", "Asia/Jerusalem", { usOpen: ["2026-11-22"] }).find((day) => day.date === "2026-11-22");
  assert.equal(isoStarts(sunday).includes("2026-11-22T19:00:00.000Z"), true);
  const thursday = days("45", false, "2026-11", "Asia/Jerusalem", { usOpen: ["2026-11-19"] }).find((day) => day.date === "2026-11-19");
  const thursdayIso = isoStarts(thursday);
  assert.equal(thursdayIso[0], "2026-11-19T09:00:00.000Z");
  assert.equal(thursdayIso.includes("2026-11-19T19:00:00.000Z"), true);
  assert.equal(thursdayIso.at(-1), "2026-11-19T21:15:00.000Z"); // last 45-minute start ends at midnight

  const friday = days("intro", false, "2026-11", "Asia/Jerusalem", { usOpen: ["2026-11-20"] }).find((day) => day.date === "2026-11-20");
  assert.equal(friday, undefined);
  const saturday = days("intro", false, "2026-11", "Asia/Jerusalem", { usOpen: ["2026-11-21"] }).find((day) => day.date === "2026-11-21");
  assert.equal(saturday, undefined);
  const blocked = days("intro", false, "2026-11", "Asia/Jerusalem", { usOpen: ["2026-11-16"], blocked: ["2026-11-16"] }).find((day) => day.date === "2026-11-16");
  assert.equal(blocked, undefined);
});

test("a one-day US open still respects calendar events, buffers, and hour blocks", () => {
  const at = (date: string, h: number, m = 0) => zonedDateTime(date, h * 60 + m, "Asia/Jerusalem");
  const event = { start: at("2026-11-16", 21, 30), end: at("2026-11-16", 22), dayRules: true };
  const monday = days("intro", false, "2026-11", "Asia/Jerusalem", {
    usOpen: ["2026-11-16"],
    busy: [event],
    ranges: [{ date: "2026-11-16", startMinute: 23 * 60, endMinute: 24 * 60 }],
  }).find((day) => day.date === "2026-11-16");
  // 21:00 overlaps the 30-minute buffer before 21:30; 22:00 overlaps the buffer after; 23:00+ is hour-blocked.
  assert.deepEqual(
    isoStarts(monday).filter((start) => start >= "2026-11-16T19:00:00.000Z"),
    ["2026-11-16T20:30:00.000Z"],
  );
});

test("a one-day US open does not open in-person evenings", () => {
  const inPerson = days("inperson", false, "2026-11", "Asia/Jerusalem", { usOpen: ["2026-11-16"] });
  assert.deepEqual(inPerson, []);
});
