import assert from "node:assert/strict";
import { test } from "node:test";
import { SLOTS_FRESH_MS, cachedSlots, forgetSlots, loadSlots, neighbourMonths } from "../lib/slots-client";

const query = { slug: "intro", timeZone: "Asia/Jerusalem", month: "2026-11", unlockKey: "", rescheduleId: "", rescheduleToken: "" };

function stubFetch() {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ month: "2026-11", days: [], call: calls.length }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test("concurrent loads of one month share a single request, then serve from memory", async () => {
  forgetSlots(query);
  const calls = stubFetch();
  const [a, b] = await Promise.all([loadSlots(query), loadSlots(query)]);
  assert.equal(calls.length, 1);
  assert.equal(a, b);
  assert.equal(cachedSlots(query), a);
  await loadSlots(query);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "/api/slots?meeting=intro&timeZone=Asia%2FJerusalem&month=2026-11");
});

test("a stale month is refetched while the old answer stays visible", async () => {
  forgetSlots(query);
  const calls = stubFetch();
  const first = await loadSlots(query);
  const refreshed = await loadSlots(query, Date.now() + SLOTS_FRESH_MS + 1);
  assert.equal(calls.length, 2);
  assert.notEqual(first, refreshed);
  assert.equal(cachedSlots(query), refreshed);
});

test("a failed load is reported and not cached", async () => {
  const other = { ...query, slug: "45" };
  forgetSlots(other);
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 })) as typeof fetch;
  await assert.rejects(loadSlots(other), /nope/);
  assert.equal(cachedSlots(other), null);
});

test("personal tokens are separate cache entries", async () => {
  forgetSlots(query);
  const calls = stubFetch();
  await loadSlots(query);
  await loadSlots({ ...query, unlockKey: "abc.secret" });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /k=abc\.secret/);
});

test("neighbour months skip the past", () => {
  assert.deepEqual(neighbourMonths("2026-11", "2026-11"), ["2026-12"]);
  assert.deepEqual(neighbourMonths("2026-12", "2026-11"), ["2027-01", "2026-11"]);
  assert.deepEqual(neighbourMonths("2027-01", "2026-11"), ["2027-02", "2026-12"]);
});

test("maxAgeMs 0 refetches a fresh month (tab refocus) and asks the browser not to cache", async () => {
  forgetSlots(query);
  const inits: (RequestInit | undefined)[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    inits.push(init);
    return new Response(JSON.stringify({ month: "2026-11", days: [], call: inits.length }), { status: 200 });
  }) as typeof fetch;
  const first = await loadSlots(query);
  const again = await loadSlots(query, Date.now(), 0);
  assert.equal(inits.length, 2);
  assert.notEqual(first, again);
  assert.equal(inits[0]?.cache, "no-store");
});
