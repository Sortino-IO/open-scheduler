import assert from "node:assert/strict";
import { test } from "node:test";
import { withDayBlocked, withDayOpen, withDayUsOpen } from "../lib/day-settings";

const base = { manualBlocks: ["2026-11-30"], manualOpens: ["2026-11-25"], usOpenDates: ["2026-11-24"], other: 1 };

test("blocking a day clears its one-off opens; unblocking leaves them", () => {
  const blocked = withDayBlocked({ ...base, manualOpens: ["2026-11-24"] }, "2026-11-24", true);
  assert.deepEqual(blocked.manualBlocks, ["2026-11-24", "2026-11-30"]);
  assert.deepEqual(blocked.manualOpens, []);
  assert.deepEqual(blocked.usOpenDates, []);
  assert.equal(blocked.other, 1);
  const unblocked = withDayBlocked(base, "2026-11-30", false);
  assert.deepEqual(unblocked.manualBlocks, []);
  assert.deepEqual(unblocked.usOpenDates, ["2026-11-24"]);
});

test("opening a day (daytime or US) lifts its manual block, and is idempotent", () => {
  const open = withDayOpen(base, "2026-11-30", true);
  assert.deepEqual(open.manualOpens, ["2026-11-25", "2026-11-30"]);
  assert.deepEqual(open.manualBlocks, []);
  const us = withDayUsOpen(withDayUsOpen(base, "2026-11-30", true), "2026-11-30", true);
  assert.deepEqual(us.usOpenDates, ["2026-11-24", "2026-11-30"]);
  assert.deepEqual(us.manualBlocks, []);
  assert.deepEqual(withDayUsOpen(base, "2026-11-24", false).usOpenDates, []);
  assert.deepEqual(base.usOpenDates, ["2026-11-24"]); // inputs are not mutated
});
