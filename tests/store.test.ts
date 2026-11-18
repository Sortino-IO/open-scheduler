import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeStore } from "../lib/store";
import { isIsoDate } from "../lib/time";

test("stored admin state without usOpenDates loads as an empty list", () => {
  const store = normalizeStore({ admin: { usSlotsOpen: true, manualOpens: ["2026-11-18"] } } as never);
  assert.deepEqual(store.admin.usOpenDates, []);
  assert.equal(store.admin.usSlotsOpen, true);
  assert.deepEqual(store.admin.manualOpens, ["2026-11-18"]);
});

test("usOpenDates keeps only YYYY-MM-DD strings, deduplicated and sorted", () => {
  const store = normalizeStore({
    admin: { usOpenDates: ["2026-11-19", "2026-11-16", "2026-11-19", "16/11/2026", 42, null] },
  } as never);
  assert.deepEqual(store.admin.usOpenDates, ["2026-11-16", "2026-11-19"]);
});

test("isIsoDate accepts only real YYYY-MM-DD dates", () => {
  assert.equal(isIsoDate("2026-11-23"), true);
  assert.equal(isIsoDate("2028-02-29"), true);
  for (const bad of ["0000-00-00", "2026-02-30", "2026-13-01", "2026-11-23\n", "2026-11-23T00:00", "2026-1-3", "", null, 20261123, ["2026-11-23"]]) {
    assert.equal(isIsoDate(bad), false, String(bad));
  }
});
