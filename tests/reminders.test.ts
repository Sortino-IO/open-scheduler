import assert from "node:assert/strict";
import { test } from "node:test";
import { computeReminderSendAt } from "../lib/reminders";

test("a morning meeting reminds the evening before when 3 hours prior is before 08:00", () => {
  const send = computeReminderSendAt(
    new Date("2026-11-09T07:00:00.000Z"),
    "Asia/Jerusalem",
    new Date("2026-11-08T06:00:00.000Z"),
  );
  assert.equal(send?.toISOString(), "2026-11-08T17:00:00.000Z");
});

test("an afternoon meeting reminds 3 hours prior in the guest zone", () => {
  const send = computeReminderSendAt(
    new Date("2026-11-09T12:00:00.000Z"),
    "Asia/Jerusalem",
    new Date("2026-11-08T06:00:00.000Z"),
  );
  assert.equal(send?.toISOString(), "2026-11-09T09:00:00.000Z");
});

test("a meeting booked inside the reminder window does not schedule another reminder", () => {
  const start = new Date("2026-11-09T15:00:00.000Z");
  const send = computeReminderSendAt(start, "America/New_York", new Date(start.getTime() - 60 * 60 * 1000));
  assert.equal(send, null);
});
