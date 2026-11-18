import { shiftMonth } from "./time";

export type Slot = { start: string; end: string; label: string };
export type Day = { date: string; slots: Slot[] };

export type SlotsResponse = {
  meeting: { name: string; durationMinutes: number };
  timeZone: string;
  timeZoneLabel: string;
  month: string;
  days: Day[];
  /** The server says this meeting type is not open to this visitor. */
  closed?: boolean;
};

export type SlotsQuery = {
  slug: string;
  timeZone: string;
  month: string;
  unlockKey: string;
  rescheduleId: string;
  rescheduleToken: string;
};

/** Cached months are shown at once; older than this they are also refetched in the background. */
export const SLOTS_FRESH_MS = 60_000;

type Entry = { at: number; body: SlotsResponse };

/** Browser-session cache shared by the home list and the scheduler, so a tap renders from memory. */
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<SlotsResponse>>();

export function slotsKey(query: SlotsQuery): string {
  return [query.slug, query.timeZone, query.month, query.unlockKey, query.rescheduleId, query.rescheduleToken].join("|");
}

function urlOf(query: SlotsQuery): string {
  const search = new URLSearchParams({ meeting: query.slug, timeZone: query.timeZone, month: query.month });
  if (query.unlockKey) search.set("k", query.unlockKey);
  if (query.rescheduleId) search.set("reschedule", query.rescheduleId);
  if (query.rescheduleToken) search.set("t", query.rescheduleToken);
  return `/api/slots?${search}`;
}

/** Last known answer for this month, however old. */
export function cachedSlots(query: SlotsQuery): SlotsResponse | null {
  return cache.get(slotsKey(query))?.body ?? null;
}

export function forgetSlots(query: SlotsQuery): void {
  cache.delete(slotsKey(query));
}

/** Fresh cached answer, an already running request, or one new request. Never two at once. Pass maxAgeMs 0 to refetch. */
export function loadSlots(query: SlotsQuery, now = Date.now(), maxAgeMs = SLOTS_FRESH_MS): Promise<SlotsResponse> {
  const key = slotsKey(query);
  const hit = cache.get(key);
  if (hit && now - hit.at < maxAgeMs) return Promise.resolve(hit.body);
  const running = inflight.get(key);
  if (running) return running;

  const request = fetch(urlOf(query), { cache: "no-store" })
    .then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load times.");
      cache.set(key, { at: Date.now(), body });
      return body as SlotsResponse;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** Warm the cache without surfacing errors; the screen that needs the data reports them. */
export function prefetchSlots(query: SlotsQuery): void {
  void loadSlots(query).catch(() => undefined);
}

/** The months a visitor can reach next from `month`: the one after, and the one before unless it is past. */
export function neighbourMonths(month: string, currentMonth: string): string[] {
  const previous = shiftMonth(month, -1);
  return previous >= currentMonth ? [shiftMonth(month, 1), previous] : [shiftMonth(month, 1)];
}

export function visitorTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function monthInZone(timeZone: string, date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(date).slice(0, 7);
}
