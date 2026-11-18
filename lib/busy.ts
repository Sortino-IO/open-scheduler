import { fromZonedTime } from "date-fns-tz";
import { HOST_TZ, addDays } from "./time";

export type BusyInterval = {
  start: Date;
  end: Date;
  reason?: string;
  /** Google event id, when the interval came from the calendar. */
  eventId?: string;
  /**
   * True for real timed calendar events that trigger the day rules in availability.ts
   * (30-minute buffers when online; 4-hour buffers when physical).
   * Off for all-day blocks, this app's own bookings, and Todoist task sync events.
   */
  dayRules?: boolean;
  /**
   * True only when the source event has a real physical address or an explicit
   * in-person signal. Meet/Zoom URLs are not addresses. Default is online.
   */
  physical?: boolean;
};

export type Attendee = {
  email: string;
  responseStatus?: string;
  self?: boolean;
};

/** A calendar event normalized from Google (or the mock). */
export type RawEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  transparency?: string;
  eventType?: string;
  allDay: boolean;
  /** ISO dateTime, or YYYY-MM-DD when allDay. End is exclusive for all-day. */
  start: string;
  end: string;
  organizerEmail?: string;
  organizerSelf?: boolean;
  attendees?: Attendee[];
};

function textOf(event: RawEvent): string {
  return `${event.summary ?? ""} ${event.description ?? ""} ${event.location ?? ""}`.toLowerCase();
}

/** Video-call URLs and obvious Meet/Zoom location strings — not a physical address. */
const VIDEO_CONFERENCE =
  /meet\.google\.com|hangouts\.google\.com|hangouts?\.meet|\bzoom\.us\b|\bzoom\.com\/|teams\.microsoft\.com|teams\.live\.com|\bwebex\.com\b|meet\.jit\.si|\bwhereby\.com\b/i;

export function isVideoConferenceText(value: string): boolean {
  return VIDEO_CONFERENCE.test(value);
}

/**
 * Explicit in-person wording only. Do not infer travel from a title or a city name.
 */
export function hasExplicitInPersonSignal(event: RawEvent): boolean {
  const text = textOf(event);
  return /\bin[\s-]?person\b/.test(text) || /\bfrontal\b/.test(text);
}

/**
 * A real street-style address in the location field. Meet/Zoom URLs are stripped first.
 * Conservative: a city or venue name alone is not enough.
 */
export function hasPhysicalAddress(location: string | undefined): boolean {
  if (!location) return false;
  const stripped = location
    .replace(/https?:\/\/[^\s]+/gi, (url) => (isVideoConferenceText(url) ? " " : url))
    .replace(VIDEO_CONFERENCE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return false;
  if (/maps\.google\.|google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|\bwaze\.com\b/i.test(stripped)) {
    return true;
  }
  const hasNumber = /\d/.test(stripped);
  const hasStreet =
    /\b(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|court|ct\.?|place|pl\.?|square|suite|ste\.?|floor|fl\.?|רחוב|שדרות|דרך)\b/i.test(
      stripped,
    );
  if (hasNumber && hasStreet) return true;
  // "12 Rothschild, Tel Aviv" — number, comma, and several words, not a leftover URL.
  if (hasNumber && stripped.includes(",") && stripped.split(/\s+/).length >= 3 && !isVideoConferenceText(stripped)) {
    return true;
  }
  return false;
}

/** Physical (4h travel buffer) only with a real address or an explicit in-person signal. Otherwise online. */
export function isPhysicalEvent(event: RawEvent): boolean {
  if (hasPhysicalAddress(event.location)) return true;
  if (hasExplicitInPersonSignal(event)) return true;
  return false;
}

export function mentionsCalendly(event: RawEvent): boolean {
  return textOf(event).includes("calendly");
}

function csvEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Optional operator-configured free events. Comma-separated
 * CALENDAR_FREE_KEYWORDS match summary/description/location.
 * CALENDAR_FREE_EMAIL_DOMAINS match the organizer or an attendee domain.
 */
export function isConfiguredFreeEvent(event: RawEvent): boolean {
  const keywords = csvEnv("CALENDAR_FREE_KEYWORDS");
  const domains = csvEnv("CALENDAR_FREE_EMAIL_DOMAINS");
  if (!keywords.length && !domains.length) return false;
  const text = textOf(event);
  if (keywords.some((keyword) => text.includes(keyword))) return true;
  if (!domains.length) return false;
  const emails = [event.organizerEmail, ...(event.attendees ?? []).map((attendee) => attendee.email)];
  return emails.some((email) => {
    const lower = email?.toLowerCase() ?? "";
    const at = lower.lastIndexOf("@");
    if (at < 0) return false;
    const domain = lower.slice(at + 1);
    return domains.some((item) => domain === item || domain.endsWith(`.${item}`));
  });
}

function isOwn(event: RawEvent, owners: Set<string>): boolean {
  if (event.organizerSelf) return true;
  if (event.organizerEmail && owners.has(event.organizerEmail.toLowerCase())) return true;
  return false;
}

function selfResponse(event: RawEvent, owners: Set<string>): string | undefined {
  const self = event.attendees?.find(
    (attendee) => attendee.self || owners.has(attendee.email.toLowerCase()),
  );
  return self?.responseStatus;
}

/** All-day blocks that mean "do not book", as opposed to weddings and reminders. */
export function isAllDayBlock(event: RawEvent): boolean {
  if (event.eventType === "outOfOffice") return true;
  const title = (event.summary ?? "").trim().toLowerCase();
  if (/\bblocked\b/.test(title)) return true;
  if (title.includes("no meetings") || title.includes("no meeting")) return true;
  if (title.includes("out of office") || title.includes("out-of-office")) return true;
  if (title === "ooo" || /^ooo\b/.test(title)) return true;
  return false;
}

/**
 * Block only timed events the host owns or accepted, plus all-day "blocked / no meetings / OOO".
 */
export function shouldBlock(event: RawEvent, owners: Set<string>): boolean {
  if (event.status === "cancelled" || event.status === "tentative") return false;
  if (mentionsCalendly(event) || isConfiguredFreeEvent(event)) return false;
  if (event.allDay) return isAllDayBlock(event);

  const response = selfResponse(event, owners);
  if (response === "declined" || response === "tentative" || response === "needsAction") return false;
  if (isOwn(event, owners)) return true;
  return response === "accepted";
}

export function eventsToBusy(events: RawEvent[], ownEmails: string[], hostTz = HOST_TZ): BusyInterval[] {
  const owners = new Set(ownEmails.map((email) => email.toLowerCase()));
  const intervals: BusyInterval[] = [];

  for (const event of events) {
    if (!shouldBlock(event, owners)) continue;
    if (event.allDay) {
      let cursor = event.start.slice(0, 10);
      const endDate = event.end.slice(0, 10);
      let guard = 0;
      while (cursor < endDate && guard < 40) {
        const next = addDays(cursor, 1, hostTz);
        intervals.push({
          start: fromZonedTime(`${cursor}T00:00:00`, hostTz),
          end: fromZonedTime(`${next}T00:00:00`, hostTz),
          reason: event.summary,
        });
        cursor = next;
        guard += 1;
      }
      continue;
    }
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    const isTodoistTask = Boolean(event.id?.startsWith("todoist"));
    intervals.push({
      start,
      end,
      reason: event.summary,
      eventId: event.id,
      dayRules: !isTodoistTask,
      physical: !isTodoistTask && isPhysicalEvent(event),
    });
  }

  return intervals;
}

export function overlaps(start: Date, end: Date, busy: BusyInterval[]): boolean {
  const from = start.getTime();
  const to = end.getTime();
  return busy.some((interval) => from < interval.end.getTime() && to > interval.start.getTime());
}
