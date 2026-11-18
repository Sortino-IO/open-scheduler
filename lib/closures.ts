/**
 * Regular closures: blanket weekly rules ("no Intro calls on Sunday mornings") that apply on top of
 * calendar conflicts, buffers, holidays, and per-day blocks. Times are Israel civil time.
 *
 * Precedence: a closure wins over the standard weekly hours and the global US switch, but an explicit
 * per-day switch for that date overrides it for the window it opens — "Open this day once" for the
 * daytime window, "Open US evening slots on this day" for the US evening window — because those are
 * deliberate one-off decisions for that date. In-person meetings are not affected by closures.
 */

import { isIsoDate } from "./time";

export const CLOSURE_MEETINGS = ["intro", "45"] as const;
export type ClosureMeeting = (typeof CLOSURE_MEETINGS)[number];

export type ClosureRange = { startMinute: number; endMinute: number };

/** At most this many time ranges per rule. */
export const MAX_CLOSURE_RANGES = 8;

export type RegularClosure = {
  id: string;
  /** Israel weekdays, 0 = Sunday … 6 = Saturday; sorted, unique, at least one. */
  weekdays: number[];
  /** Closed time ranges in minutes from Israel midnight, sorted and non-overlapping. Empty = the whole day. */
  ranges: ClosureRange[];
  /** Meeting types it closes; at least one. */
  meetings: ClosureMeeting[];
  /** Optional inclusive Israel date range. */
  from: string | null;
  until: string | null;
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isMinute(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 24 * 60;
}

/**
 * The closure fields from untrusted input, cleaned, or an error message. Used for the admin API and
 * for rows loaded from storage, so both follow the same rules.
 */
export function parseClosure(input: unknown): Omit<RegularClosure, "id"> | { error: string } {
  if (!input || typeof input !== "object") return { error: "Send the closure details." };
  const row = input as Record<string, unknown>;
  const weekdays = Array.isArray(row.weekdays)
    ? [...new Set(row.weekdays)].filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  if (!Array.isArray(row.weekdays) || weekdays.length === 0 || weekdays.length !== new Set(row.weekdays).size) {
    return { error: "Pick at least one weekday." };
  }
  const ranges = parseRanges(row);
  if ("error" in ranges) return ranges;
  const meetings = Array.isArray(row.meetings)
    ? CLOSURE_MEETINGS.filter((slug) => (row.meetings as unknown[]).includes(slug))
    : [];
  if (meetings.length === 0 || (row.meetings as unknown[]).length !== meetings.length) {
    return { error: "Choose Intro, 45-minute, or both." };
  }
  const from = row.from == null || row.from === "" ? null : row.from;
  const until = row.until == null || row.until === "" ? null : row.until;
  for (const date of [from, until]) {
    if (date !== null && !isIsoDate(date)) {
      return { error: "Dates must be real dates." };
    }
  }
  if (from && until && until < (from as string)) return { error: "The end date is before the start date." };
  return {
    weekdays: weekdays.sort((a, b) => a - b),
    ranges: ranges.ranges,
    meetings: [...meetings],
    from: from as string | null,
    until: until as string | null,
  };
}

/**
 * `ranges` (empty = whole day). Rules saved before multiple ranges existed carry a single
 * `startMinute`/`endMinute` pair (both null = whole day); those are read as one range.
 */
function parseRanges(row: Record<string, unknown>): { ranges: ClosureRange[] } | { error: string } {
  let raw: unknown[];
  if (Array.isArray(row.ranges)) raw = row.ranges;
  else if (row.ranges !== undefined) return { error: "Each time range needs a start before its end." };
  else if (row.startMinute == null && row.endMinute == null) raw = [];
  else raw = [{ startMinute: row.startMinute, endMinute: row.endMinute }];
  if (raw.length > MAX_CLOSURE_RANGES) return { error: `Use at most ${MAX_CLOSURE_RANGES} time ranges.` };
  const ranges: ClosureRange[] = [];
  for (const item of raw) {
    const range = (item ?? {}) as Record<string, unknown>;
    if (!isMinute(range.startMinute) || !isMinute(range.endMinute) || range.endMinute <= range.startMinute) {
      return { error: "Each time range needs a start before its end." };
    }
    ranges.push({ startMinute: range.startMinute, endMinute: range.endMinute });
  }
  ranges.sort((a, b) => a.startMinute - b.startMinute);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].startMinute < ranges[i - 1].endMinute) return { error: "Time ranges in one rule can't overlap." };
  }
  return { ranges };
}

/** Closures that apply to this meeting type on this Israel date (weekday is that date's Israel weekday). */
export function closuresOn(closures: RegularClosure[], meetingSlug: string, hostDate: string, weekday: number): RegularClosure[] {
  return closures.filter(
    (closure) =>
      (closure.meetings as string[]).includes(meetingSlug) &&
      closure.weekdays.includes(weekday) &&
      (!closure.from || hostDate >= closure.from) &&
      (!closure.until || hostDate <= closure.until),
  );
}

/** True when [startMinute, endMinute) on that day falls inside any of the given closures. */
export function closedBy(closures: RegularClosure[], startMinute: number, endMinute: number): boolean {
  return closures.some(
    (closure) =>
      closure.ranges.length === 0 ||
      closure.ranges.some((range) => startMinute < range.endMinute && endMinute > range.startMinute),
  );
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** e.g. "Sun, Mon · 09:00–12:00, 16:00–18:00 · Intro · from 2026-12-01" */
export function describeClosure(closure: Omit<RegularClosure, "id">): string {
  const days = closure.weekdays.map((day) => WEEKDAY_SHORT[day]).join(", ");
  const when =
    closure.ranges.length === 0
      ? "All day"
      : closure.ranges.map((range) => `${clock(range.startMinute)}–${clock(range.endMinute)}`).join(", ");
  const applies = closure.meetings.length === CLOSURE_MEETINGS.length ? "Intro and 45-minute" : closure.meetings[0] === "intro" ? "Intro" : "45-minute";
  const range = [closure.from ? `from ${closure.from}` : "", closure.until ? `until ${closure.until}` : ""].filter(Boolean).join(" ");
  return [days, when, applies, range].filter(Boolean).join(" · ");
}
