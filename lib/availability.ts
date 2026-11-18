import type { RangeBlock } from "./blocks";
import { overlapsRanges } from "./blocks";
import type { BusyInterval } from "./busy";
import { closedBy, closuresOn, type RegularClosure } from "./closures";
import { overlaps } from "./busy";
import type { MeetingType } from "./meetings";
import { HOST_TZ, addDays, eachDate, formatIsoDate, weekdayIndex, zonedDateTime } from "./time";

export type Slot = { start: Date; end: Date };

export type DaySlots = { date: string; slots: Slot[] };

const HORIZON_DAYS = 62;

/**
 * Day rules for real calendar events (BusyInterval.dayRules), evaluated in Asia/Jerusalem:
 *
 * - Online events (default): block the event itself plus 30 minutes before and after.
 * - Physical / in-person events (BusyInterval.physical): 4 hours before and 4 hours after.
 * - Mid-day events no longer close the whole day.
 */
export const ONLINE_BUFFER_MS = 30 * 60 * 1000;
export const PHYSICAL_BUFFER_MS = 4 * 60 * 60 * 1000;

function bufferMs(event: BusyInterval): number {
  return event.physical ? PHYSICAL_BUFFER_MS : ONLINE_BUFFER_MS;
}

/** True when the slot overlaps the event's padded window. Boundaries are exclusive: a slot ending exactly at start−buffer, or starting exactly at end+buffer, is open. */
function overlapsBuffered(start: Date, end: Date, events: BusyInterval[]): boolean {
  const from = start.getTime();
  const to = end.getTime();
  return events.some((event) => {
    const pad = bufferMs(event);
    const paddedStart = event.start.getTime() - pad;
    const paddedEnd = event.end.getTime() + pad;
    return from < paddedEnd && to > paddedStart;
  });
}

type GenerateInput = {
  now: Date;
  meeting: MeetingType;
  /** For intro/45: US evening toggle. For in-person: inPersonOpen (passed the same way). */
  usSlotsOpen: boolean;
  busy: BusyInterval[];
  blockedHostDates: Set<string>;
  /** Partial-day admin blocks (already expanded for the horizon). */
  rangeBlocks?: RangeBlock[];
  /** One-off Israel dates that may offer the standard daytime window even if standardDays would skip them. Friday, Saturday, and blockedHostDates still stay closed. Busy times, buffers, and hour-blocks still apply. */
  openHostDates?: Set<string>;
  /** One-off Israel dates that offer the US evening window as if the US toggle were on, even on a weekday outside usDays. Ignored for evening-only (in-person) meetings. Friday, Saturday, and blockedHostDates still stay closed. Busy times, buffers, and hour-blocks still apply. */
  usOpenHostDates?: Set<string>;
  /** Blanket weekly closures (see lib/closures.ts). A window opened for a date by openHostDates or usOpenHostDates ignores them on that date. */
  closures?: RegularClosure[];
  horizonDays?: number;
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** usOpenDate: this one date offers the US window on any weekday (Friday/Saturday are skipped before this is called). */
function windowsFor(meeting: MeetingType, usSlotsOpen: boolean, usOpenDate: boolean) {
  const windows: { days: number[]; start: number; end: number }[] = [];
  if (meeting.standardDays.length > 0) {
    windows.push({
      days: meeting.standardDays,
      start: meeting.standardStart,
      end: meeting.standardEnd,
    });
  }
  if ((usSlotsOpen || usOpenDate) && meeting.usDays.length > 0) {
    windows.push({ days: usOpenDate ? EVERY_DAY : meeting.usDays, start: meeting.usStart, end: meeting.usEnd });
  }
  return windows;
}

/** Open start times inside the booking horizon. Rules are evaluated in Asia/Jerusalem. */
export function generateSlots(input: GenerateInput): Slot[] {
  const horizon = input.horizonDays ?? HORIZON_DAYS;
  const today = formatIsoDate(input.now, HOST_TZ);
  const earliest = addDays(today, 1, HOST_TZ);
  const latest = addDays(today, horizon, HOST_TZ);
  const slots: Slot[] = [];
  const ruleEvents = input.busy.filter((interval) => interval.dayRules);
  const ranges = input.rangeBlocks ?? [];

  for (const hostDate of eachDate(earliest, latest, HOST_TZ)) {
    if (input.blockedHostDates.has(hostDate)) continue;
    const weekday = weekdayIndex(hostDate, HOST_TZ);
    if (weekday === 5 || weekday === 6) continue;

    const oneOffDaytime = Boolean(input.openHostDates?.has(hostDate));
    const oneOffUs = !input.meeting.eveningOnly && Boolean(input.usOpenHostDates?.has(hostDate));
    const dayClosures = closuresOn(input.closures ?? [], input.meeting.slug, hostDate, weekday);

    for (const window of windowsFor(input.meeting, input.usSlotsOpen, oneOffUs)) {
      const daytime = window.start === input.meeting.standardStart && window.end === input.meeting.standardEnd;
      const allowDaytimeException = oneOffDaytime && input.meeting.standardDays.length > 0 && daytime;
      // A deliberate one-off switch for this date overrides blanket closures for the window it opens.
      const closures = (daytime ? oneOffDaytime : oneOffUs) ? [] : dayClosures;
      if (!window.days.includes(weekday) && !allowDaytimeException) continue;
      const lastStart = window.end - input.meeting.durationMinutes;
      for (let minute = window.start; minute <= lastStart; minute += input.meeting.stepMinutes) {
        const start = zonedDateTime(hostDate, minute, HOST_TZ);
        const end = new Date(start.getTime() + input.meeting.durationMinutes * 60_000);
        if (start.getTime() <= input.now.getTime()) continue;
        if (overlaps(start, end, input.busy)) continue;
        if (overlapsBuffered(start, end, ruleEvents)) continue;
        const endMinute = minute + input.meeting.durationMinutes;
        if (overlapsRanges(hostDate, minute, endMinute, ranges)) continue;
        if (closedBy(closures, minute, endMinute)) continue;
        slots.push({ start, end });
      }
    }
  }

  return slots;
}

export function isStartOpen(input: GenerateInput & { start: Date }): boolean {
  return generateSlots(input).some((slot) => Math.abs(slot.start.getTime() - input.start.getTime()) < 1000);
}

export function groupByVisitorDate(slots: Slot[], visitorTimeZone: string, month: string): DaySlots[] {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const start = `${month}-01`;
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  const grouped = new Map<string, Slot[]>();

  for (const slot of slots) {
    const date = formatIsoDate(slot.start, visitorTimeZone);
    if (date < start || date > end) continue;
    const list = grouped.get(date);
    if (list) list.push(slot);
    else grouped.set(date, [slot]);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySlots]) => ({
      date,
      slots: daySlots.sort((a, b) => a.start.getTime() - b.start.getTime()),
    }));
}

export const BOOKING_HORIZON_DAYS = HORIZON_DAYS;
