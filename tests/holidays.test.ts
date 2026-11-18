import assert from "node:assert/strict";
import { test } from "node:test";
import { blockedDaysFromHebcal, fetchHebcalItems, type HebcalItem } from "../lib/holidays";

const items: HebcalItem[] = [
  { title: "Sigd", date: "2026-11-09", category: "holiday" },
  { title: "Chanukah: 1 Candle", date: "2026-12-04", category: "holiday" },
  { title: "Erev Purim", date: "2027-03-22", category: "holiday", hebrew: "ערב פורים" },
  { title: "Purim", date: "2027-03-23", category: "holiday", hebrew: "פורים" },
  { title: "Erev Pesach", date: "2027-04-21", category: "holiday", hebrew: "ערב פסח" },
  { title: "Pesach I", date: "2027-04-22", category: "holiday", yomtov: true, hebrew: "פסח א׳" },
  { title: "Pesach II (CH''M)", date: "2027-04-23", category: "holiday" },
  { title: "Pesach VI (CH''M)", date: "2027-04-27", category: "holiday" },
  { title: "Pesach VII", date: "2027-04-28", category: "holiday", yomtov: true },
  { title: "Yom HaShoah", date: "2027-05-04", category: "holiday" },
  { title: "Yom HaZikaron", date: "2027-05-11", category: "holiday" },
  { title: "Yom HaAtzma’ut", date: "2027-05-12", category: "holiday" },
  { title: "Rosh Hashana 5788", date: "2027-10-02", category: "holiday", yomtov: true },
  { title: "Rosh Hashana II", date: "2027-10-03", category: "holiday", yomtov: true },
];

test("blocks yom tov, erev chag, and Israeli closures, and leaves chol hamoed and Chanukah open", () => {
  const blocks = blockedDaysFromHebcal(items);
  const byDate = new Map(blocks.map((block) => [block.date, block]));
  assert.equal(byDate.get("2027-04-21")?.kind, "erev");
  assert.equal(byDate.get("2027-04-22")?.kind, "yomtov");
  assert.equal(byDate.get("2027-04-27")?.kind, "erev");
  assert.equal(byDate.get("2027-04-28")?.kind, "yomtov");
  assert.equal(byDate.has("2027-04-23"), false);
  assert.equal(byDate.has("2026-12-04"), false);
  assert.equal(byDate.has("2027-03-22"), false);
  assert.equal(byDate.get("2027-03-23")?.kind, "closure");
  assert.equal(byDate.get("2027-03-23")?.hebrew, "פורים");
  assert.equal(byDate.has("2026-11-09"), false);
  assert.equal(byDate.has("2027-05-04"), true);
  assert.equal(byDate.has("2027-05-11"), true);
  assert.equal(byDate.has("2027-05-12"), true);
  assert.equal(byDate.get("2027-10-01")?.kind, "erev");
  assert.equal(byDate.has("2027-10-02"), true);
  assert.equal(byDate.get("2027-10-02")?.kind, "yomtov");
  assert.equal(byDate.has("2027-10-03"), true);
});

test("Hebcal Israel calendar blocks Pesach I, Pesach VII, and erev, not chol hamoed or Chanukah", { timeout: 20_000 }, async () => {
  const [pesach, chanukah] = await Promise.all([
    fetchHebcalItems("2027-04-01", "2027-04-30"),
    fetchHebcalItems("2026-12-01", "2026-12-15"),
  ]);
  const blocks = blockedDaysFromHebcal([...pesach, ...chanukah]);
  const dates = new Set(blocks.map((block) => block.date));
  assert.equal(dates.has("2027-04-21"), true);
  assert.equal(dates.has("2027-04-22"), true);
  assert.equal(dates.has("2027-04-28"), true);
  assert.equal(dates.has("2027-04-23"), false);
  assert.equal([...dates].some((date) => date.startsWith("2026-12")), false);
});
