import assert from "node:assert/strict";
import { test } from "node:test";
import { isDayEditorInUsableView, planDayEditorScroll } from "../lib/day-editor-scroll";

const phone = {
  viewportHeight: 844,
  stickyHeaderHeight: 132,
  stickyHeaderVisible: true,
  safeAreaTop: 0,
  reduceMotion: false,
};

test("a selected-day editor below the phone fold should scroll under the sticky header", () => {
  const plan = planDayEditorScroll({
    ...phone,
    rect: { top: 980, bottom: 1680, height: 700 },
  });
  assert.equal(plan.action, "scroll");
  assert.equal(plan.scrollMarginTop, 144);
  assert.equal(plan.behavior, "smooth");
  assert.equal(isDayEditorInUsableView({ top: 980, bottom: 1680, height: 700 }, 844, 144), false);
});

test("safe area is kept when it is taller than the sticky header", () => {
  const plan = planDayEditorScroll({
    ...phone,
    stickyHeaderHeight: 40,
    safeAreaTop: 59,
    rect: { top: 900, bottom: 1600, height: 700 },
  });
  assert.equal(plan.scrollMarginTop, 71);
  assert.equal(plan.action, "scroll");
});

test("reduced motion scrolls without animation", () => {
  const plan = planDayEditorScroll({
    ...phone,
    reduceMotion: true,
    rect: { top: 980, bottom: 1680, height: 700 },
  });
  assert.equal(plan.action, "scroll");
  assert.equal(plan.behavior, "auto");
});

test("does not scroll when the editor is already in view on a phone", () => {
  const plan = planDayEditorScroll({
    ...phone,
    rect: { top: 150, bottom: 850, height: 700 },
  });
  assert.equal(plan.action, "none");
});

test("does not scroll on desktop when the side-by-side editor is already visible", () => {
  const plan = planDayEditorScroll({
    rect: { top: 180, bottom: 880, height: 700 },
    viewportHeight: 1000,
    stickyHeaderHeight: 132,
    stickyHeaderVisible: false,
    safeAreaTop: 0,
    reduceMotion: false,
  });
  assert.equal(plan.action, "none");
  assert.equal(plan.scrollMarginTop, 12);
});

test("does scroll a short desktop window when the editor is below the fold", () => {
  const plan = planDayEditorScroll({
    rect: { top: 760, bottom: 1460, height: 700 },
    viewportHeight: 700,
    stickyHeaderHeight: 0,
    stickyHeaderVisible: false,
    safeAreaTop: 0,
    reduceMotion: false,
  });
  assert.equal(plan.action, "scroll");
});
