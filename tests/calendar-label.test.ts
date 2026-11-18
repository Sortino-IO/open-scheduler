import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDetail } from "../lib/calendar-label";

test("same-named calendars get a subtitle that tells them apart", () => {
  assert.equal(calendarDetail("owner@example.com"), "owner@example.com");
  const a = calendarDetail("abc123def456ghi@group.calendar.google.com");
  const b = calendarDetail("zzz999yyy888xxx@group.calendar.google.com");
  assert.equal(a, "Shared calendar · abc123def4");
  assert.notEqual(a, b);
  assert.equal(calendarDetail("en.jewish#holiday@group.v.calendar.google.com"), "en.jewish#holiday@group.v.calendar.google.com");
  assert.equal(calendarDetail("feed123@import.calendar.google.com"), "Subscribed calendar · feed123");
});
