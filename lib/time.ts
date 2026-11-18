import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const HOST_TZ = "Asia/Jerusalem";

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function assertTimeZone(timeZone: string): string {
  Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  return timeZone;
}

export function formatIsoDate(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30, 0000-00-00, extra characters). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().startsWith(value);
}

export function addDays(isoDate: string, days: number, timeZone: string): string {
  const noon = fromZonedTime(`${isoDate}T12:00:00`, timeZone);
  const next = new Date(noon.getTime() + days * 24 * 60 * 60 * 1000);
  return formatInTimeZone(next, timeZone, "yyyy-MM-dd");
}

/** 0 = Sunday … 6 = Saturday, for a civil date in `timeZone`. */
export function weekdayIndex(isoDate: string, timeZone: string): number {
  const noon = fromZonedTime(`${isoDate}T12:00:00`, timeZone);
  const label = formatInTimeZone(noon, timeZone, "EEE");
  const index = WEEKDAY[label];
  if (index === undefined) throw new Error(`Bad weekday ${label}`);
  return index;
}

export function zonedDateTime(isoDate: string, minutes: number, timeZone: string): Date {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const hm = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  return fromZonedTime(`${isoDate}T${hm}:00`, timeZone);
}

export function eachDate(start: string, end: string, timeZone: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1, timeZone);
    if (dates.length > 400) break;
  }
  return dates;
}

export function timeZoneLabel(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  const clock = `${pick("hour")}:${pick("minute")}${pick("dayPeriod") ? ` ${pick("dayPeriod")}` : ""}`;
  const abbr = pick("timeZoneName");
  return `${city} (${abbr}) · ${clock}`;
}

export function zoneAbbrev(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

export function formatWhen(date: Date, timeZone: string): string {
  const when = formatInTimeZone(date, timeZone, "EEE, MMM d, yyyy · h:mm a");
  return `${when} ${zoneAbbrev(date, timeZone)}`;
}

export function formatTime(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "h:mm a");
}

export function formatDayHeading(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "EEEE, MMMM d");
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyInZone(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM");
}
