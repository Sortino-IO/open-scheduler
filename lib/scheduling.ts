import { generateSlots, groupByVisitorDate, isStartOpen } from "./availability";
import { expandBlocks } from "./blocks";
import type { BusyInterval } from "./busy";
import {
  calendarIsDryRun,
  cancelCalendarEvent,
  createCalendarEvent,
  getBusyIntervals,
  invalidateBusyCache,
  isCalendarAuthError,
  updateCalendarEvent,
  type EventDraft,
} from "./calendar";
import {
  guestCancelled,
  guestConfirmation,
  guestReminder,
  guestUpdated,
  internalNotice,
  oneLine,
} from "./email-templates";
import { reportCalendarDisconnected } from "./calendar-health";
import { blockedDaysFromHebcal, fetchHebcalItems, type HolidayBlock } from "./holidays";
import { HttpError } from "./http";
import { ownerName } from "./brand";
import { deliverEmail, emailIsDryRun, notifyEmail } from "./mail";
import { getMeeting, type MeetingMode, type MeetingSlug } from "./meetings";
import { computeReminderSendAt, isEveningBefore } from "./reminders";
import { safeEqual } from "./secret";
import { newId, readStore, updateStore, type Booking } from "./store";
import { normalizeEmail, resolveAccess, type AccessFlags } from "./unlocks";
import { HOST_TZ, addDays, assertTimeZone, formatIsoDate, formatTime, timeZoneLabel } from "./time";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIX_HOURS = 6 * 60 * 60 * 1000;

export type PublicBooking = {
  id: string;
  status: Booking["status"];
  meetingSlug: MeetingSlug;
  meetingName: string;
  durationMinutes: number;
  startUtc: string;
  endUtc: string;
  visitorTimeZone: string;
  name: string;
  email: string;
  company: string;
  mode: MeetingMode;
  phone: string;
  location: string;
  notes: string;
  meetLink: string | null;
  calendarDryRun: boolean;
  emailDryRun: boolean;
};

export function toPublic(booking: Booking): PublicBooking {
  const meeting = getMeeting(booking.meetingSlug);
  return {
    id: booking.id,
    status: booking.status,
    meetingSlug: booking.meetingSlug,
    meetingName: meeting?.name ?? booking.meetingSlug,
    durationMinutes: meeting?.durationMinutes ?? 30,
    startUtc: booking.startUtc,
    endUtc: booking.endUtc,
    visitorTimeZone: booking.visitorTimeZone,
    name: booking.name,
    email: booking.email,
    company: booking.company,
    mode: booking.mode,
    phone: booking.phone,
    location: booking.location ?? "",
    notes: booking.notes ?? "",
    meetLink: booking.meetLink,
    calendarDryRun: booking.calendarDryRun,
    emailDryRun: booking.emailDryRun,
  };
}

export async function holidayBlocks(now = new Date()): Promise<HolidayBlock[]> {
  const store = await readStore();
  const cached = store.holidayCache;
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < SIX_HOURS) return cached.blocks;

  try {
    const start = formatIsoDate(now, HOST_TZ);
    const mid = addDays(start, 180, HOST_TZ);
    const end = addDays(start, 370, HOST_TZ);
    const [first, second] = await Promise.all([
      fetchHebcalItems(start, mid),
      fetchHebcalItems(addDays(mid, 1, HOST_TZ), end),
    ]);
    const blocks = blockedDaysFromHebcal([...first, ...second]);
    await updateStore((data) => {
      data.holidayCache = { fetchedAt: new Date().toISOString(), blocks };
    });
    return blocks;
  } catch (error) {
    console.error("Hebcal fetch failed", error);
    if (cached?.blocks.length) return cached.blocks;
    throw new HttpError(503, "Holiday calendar is unavailable. Try again shortly.");
  }
}

function bookingsToBusy(bookings: Booking[], ignoreId?: string): BusyInterval[] {
  return bookings
    .filter((booking) => booking.status === "confirmed" && booking.id !== ignoreId)
    .map((booking) => ({ start: new Date(booking.startUtc), end: new Date(booking.endUtc) }));
}


function adminBlocks(admin: Awaited<ReturnType<typeof readStore>>["admin"], now: Date) {
  const today = formatIsoDate(now, HOST_TZ);
  const to = addDays(today, 70, HOST_TZ);
  const expanded = expandBlocks({
    manualBlocks: admin.manualBlocks,
    timeBlocks: admin.timeBlocks,
    recurringBlocks: admin.recurringBlocks,
    from: today,
    to,
  });
  return expanded;
}

function eveningOpenFor(meeting: NonNullable<ReturnType<typeof getMeeting>>, access: AccessFlags) {
  return meeting.eveningOnly ? access.inPersonOpen : access.usSlotsOpen;
}


/** This app's own booked calls show up on the calendar too; they block their time but not the whole day. */
function withoutOwnDayRules(external: BusyInterval[], bookings: Booking[]): BusyInterval[] {
  const own = new Set(bookings.map((booking) => booking.calendarEventId).filter(Boolean));
  return external.map((interval) =>
    interval.dayRules && interval.eventId && own.has(interval.eventId) ? { ...interval, dayRules: false } : interval,
  );
}

async function calendarBusy(now: Date): Promise<BusyInterval[]> {
  try {
    const end = new Date(now.getTime() + 70 * 24 * 60 * 60 * 1000);
    return await getBusyIntervals(now, end, now);
  } catch (error) {
    console.error(error);
    if (isCalendarAuthError(error)) await reportCalendarDisconnected(error.message);
    throw new HttpError(503, "Calendar is temporarily unavailable. Try again shortly.");
  }
}

function requireZone(timeZone: string): string {
  try {
    return assertTimeZone(timeZone);
  } catch {
    throw new HttpError(400, "Unknown time zone.");
  }
}

/** Computed per request: the store, calendar, and holiday reads are cached at their own layers, so an admin change shows on the next load. */
export async function getMonthSlots(input: {
  meetingSlug: string;
  timeZone: string;
  month: string;
  now?: Date;
  unlockToken?: string | null;
  rescheduleId?: string | null;
  rescheduleToken?: string | null;
}) {
  const meeting = getMeeting(input.meetingSlug);
  if (!meeting) throw new HttpError(404, "Unknown meeting type.");
  const timeZone = requireZone(input.timeZone || "UTC");
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new HttpError(400, "Month must be YYYY-MM.");

  const now = input.now ?? new Date();
  const [store, holidays, external] = await Promise.all([readStore(), holidayBlocks(now), calendarBusy(now)]);
  // A valid reschedule link frees the visitor's own booking, matching what booking a new time allows.
  const candidate = input.rescheduleId ? store.bookings.find((item) => item.id === input.rescheduleId) : undefined;
  const booking = candidate && input.rescheduleToken && safeEqual(candidate.token, input.rescheduleToken) ? candidate : null;
  const access = resolveAccess({
    admin: store.admin,
    unlocks: store.admin.unlocks,
    unlockToken: input.unlockToken,
    booking,
    bookingToken: input.rescheduleToken,
    now,
  });

  if (meeting.eveningOnly && !access.inPersonOpen) {
    return {
      meeting: {
        slug: meeting.slug,
        name: meeting.name,
        durationMinutes: meeting.durationMinutes,
        path: meeting.path,
      },
      timeZone,
      timeZoneLabel: timeZoneLabel(timeZone, now),
      month: input.month,
      usSlotsOpen: access.usSlotsOpen,
      inPersonOpen: access.inPersonOpen,
      personal: Boolean(access.unlock),
      days: [],
      closed: true,
    };
  }
  const expanded = adminBlocks(store.admin, now);
  const blocked = new Set([...expanded.wholeDays, ...holidays.map((holiday) => holiday.date)]);
  const slots = generateSlots({
    now,
    meeting,
    usSlotsOpen: eveningOpenFor(meeting, access),
    busy: [...withoutOwnDayRules(external, store.bookings), ...bookingsToBusy(store.bookings, booking?.id)],
    blockedHostDates: blocked,
    rangeBlocks: expanded.ranges,
    openHostDates: new Set(store.admin.manualOpens),
    usOpenHostDates: new Set(store.admin.usOpenDates),
    closures: store.admin.regularClosures,
  });

  return {
    meeting: {
      slug: meeting.slug,
      name: meeting.name,
      durationMinutes: meeting.durationMinutes,
      path: meeting.path,
    },
    timeZone,
    timeZoneLabel: timeZoneLabel(timeZone, now),
    month: input.month,
    usSlotsOpen: access.usSlotsOpen,
    inPersonOpen: access.inPersonOpen,
    personal: Boolean(access.unlock),
    days: groupByVisitorDate(slots, timeZone, input.month).map((day) => ({
      date: day.date,
      slots: day.slots.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        label: formatTime(slot.start, timeZone),
      })),
    })),
  };
}

export type BookingRequest = {
  meetingSlug: string;
  start: string;
  timeZone: string;
  name: string;
  email: string;
  company?: string;
  mode: string;
  phone?: string;
  location?: string;
  notes?: string;
  rescheduleId?: string;
  rescheduleToken?: string;
  unlockToken?: string;
};

/** A submitted field as text; anything that is not a string counts as empty. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanRequest(input: BookingRequest) {
  const meeting = getMeeting(input.meetingSlug);
  if (!meeting) throw new HttpError(404, "Unknown meeting type.");
  const timeZone = requireZone(input.timeZone);
  const name = oneLine(text(input.name)).slice(0, 120);
  const email = oneLine(text(input.email)).toLowerCase().slice(0, 200);
  const company = oneLine(text(input.company)).slice(0, 200);
  const phone = oneLine(text(input.phone)).slice(0, 40);
  const location = oneLine(text(input.location)).slice(0, 300);
  const notes = text(input.notes).replace(/\r\n?/g, "\n").trim().slice(0, 2000);
  let mode: MeetingMode | "" =
    input.mode === "phone" ? "phone" : input.mode === "meet" ? "meet" : input.mode === "inperson" ? "inperson" : "";
  if (meeting.requiresLocation) mode = "inperson";
  if (name.length < 2) throw new HttpError(400, "Enter your name.");
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email.");
  if (mode !== "meet" && mode !== "phone" && mode !== "inperson") {
    throw new HttpError(400, "Choose Google Meet, a phone call, or in person.");
  }
  if (mode === "phone" && !/^[+\d\s().-]{7,40}$/.test(phone)) {
    throw new HttpError(400, "Enter a phone number for the call.");
  }
  const digits = phone.replace(/\D/g, "");
  if (mode === "phone" && (digits.length < 7 || digits.length > 15)) {
    throw new HttpError(400, "Enter a phone number for the call.");
  }
  if (mode === "inperson" && location.length < 3) {
    throw new HttpError(400, "Enter a location or address for the meeting.");
  }
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw new HttpError(400, "That time is not valid.");
  return {
    meeting,
    timeZone,
    name,
    email,
    company,
    phone: mode === "phone" ? phone : "",
    location: mode === "inperson" ? location : "",
    notes,
    mode: mode as MeetingMode,
    start,
  };
}

function draftFor(booking: Booking): EventDraft {
  const meeting = getMeeting(booking.meetingSlug)!;
  const modeLabel =
    booking.mode === "meet" ? "Google Meet" : booking.mode === "inperson" ? "In person" : "Phone call";
  const lines = [
    `Meeting: ${meeting.name} (${meeting.durationMinutes} min)`,
    `Guest: ${booking.name}`,
    `Email: ${booking.email}`,
    booking.company ? `Company: ${booking.company}` : "",
    `Mode: ${modeLabel}`,
    booking.phone ? `Phone: ${booking.phone}` : "",
    booking.location ? `Location: ${booking.location}` : "",
    booking.notes ? `\nNotes:\n${booking.notes}` : "",
    "",
    `Scheduled from ${ownerName()}’s scheduling page.`,
  ].filter((line) => line !== "");
  return {
    summary: `${meeting.name} — ${oneLine(booking.name)}`.slice(0, 180),
    description: lines.join("\n"),
    start: new Date(booking.startUtc),
    end: new Date(booking.endUtc),
    attendeeEmail: booking.email,
    attendeeName: booking.name,
    withMeet: booking.mode === "meet",
    ...(booking.location ? { location: booking.location } : {}),
  };
}

function linksFor(origin: string, booking: Booking) {
  const meeting = getMeeting(booking.meetingSlug)!;
  const token = encodeURIComponent(booking.token);
  return {
    confirmUrl: `${origin}/booking/${booking.id}?t=${token}&confirmed=1`,
    rescheduleUrl: `${origin}${meeting.path}?reschedule=${booking.id}&t=${token}`,
    cancelUrl: `${origin}/booking/${booking.id}/cancel?t=${token}`,
  };
}

async function sendPair(
  booking: Booking,
  origin: string,
  kind: "new" | "updated" | "cancelled",
) {
  const start = new Date(booking.startUtc);
  const links = linksFor(origin, booking);
  const facts = {
    name: booking.name,
    meetingSlug: booking.meetingSlug,
    start,
    end: new Date(booking.endUtc),
    guestTimeZone: booking.visitorTimeZone,
    mode: booking.mode,
    phone: booking.phone,
    location: booking.location,
    meetLink: booking.meetLink,
    links,
  };
  const guest =
    kind === "new" ? guestConfirmation(facts) : kind === "updated" ? guestUpdated(facts) : guestCancelled({ ...facts, bookUrl: `${origin}${getMeeting(booking.meetingSlug)!.path}` });
  const internal = internalNotice({
    kind,
    name: booking.name,
    email: booking.email,
    company: booking.company,
    phone: booking.phone,
    location: booking.location,
    notes: booking.notes ?? "",
    meetingSlug: booking.meetingSlug,
    mode: booking.mode,
    start,
    meetLink: booking.meetLink,
  });
  const guestKind = kind === "new" ? "guest-confirmation" : kind === "updated" ? "guest-update" : "guest-cancel";
  const internalKind = kind === "new" ? "internal-notice" : kind === "updated" ? "internal-update" : "internal-cancel";
  const tasks = [deliverEmail({ kind: guestKind, to: booking.email, ...guest })];
  const noticeTo = notifyEmail();
  if (noticeTo) tasks.push(deliverEmail({ kind: internalKind, to: noticeTo, ...internal }));
  await Promise.allSettled(tasks);
}

export async function book(input: BookingRequest, origin: string, now = new Date()): Promise<PublicBooking & { token: string }> {
  const cleaned = cleanRequest(input);
  const rescheduleId = input.rescheduleId?.trim();
  const [holidays, external] = await Promise.all([holidayBlocks(now), calendarBusy(now)]);

  if (rescheduleId) {
    return reschedule(rescheduleId, input.rescheduleToken ?? "", cleaned, holidays, external, origin, now);
  }

  const end = new Date(cleaned.start.getTime() + cleaned.meeting.durationMinutes * 60_000);
  const booking: Booking = {
    id: newId(),
    token: newId(24),
    meetingSlug: cleaned.meeting.slug,
    startUtc: cleaned.start.toISOString(),
    endUtc: end.toISOString(),
    visitorTimeZone: cleaned.timeZone,
    name: cleaned.name,
    email: cleaned.email,
    company: cleaned.company,
    mode: cleaned.mode,
    phone: cleaned.phone,
    ...(cleaned.location ? { location: cleaned.location } : {}),
    ...(cleaned.notes ? { notes: cleaned.notes } : {}),
    status: "confirmed",
    meetLink: null,
    calendarEventId: null,
    calendarDryRun: await calendarIsDryRun(),
    emailDryRun: emailIsDryRun(),
    reminderSendAt: computeReminderSendAt(cleaned.start, cleaned.timeZone, now)?.toISOString() ?? null,
    reminderSentAt: null,
    reminderAttempts: 0,
    createdAt: now.toISOString(),
    cancelledAt: null,
  };

  await updateStore((data) => {
    const access = resolveAccess({
      admin: data.admin,
      unlocks: data.admin.unlocks,
      unlockToken: input.unlockToken,
      now,
    });
    if (access.unlock && normalizeEmail(access.unlock.email) !== normalizeEmail(cleaned.email)) {
      throw new HttpError(403, "This personal link is for a different email. Use the address that was unlocked.");
    }
    if (cleaned.meeting.eveningOnly && !access.inPersonOpen) {
      throw new HttpError(409, "In-person meetings are closed right now.");
    }
    const expanded = adminBlocks(data.admin, now);
    const blocked = new Set([...expanded.wholeDays, ...holidays.map((holiday) => holiday.date)]);
    const open = isStartOpen({
      now,
      meeting: cleaned.meeting,
      usSlotsOpen: eveningOpenFor(cleaned.meeting, access),
      busy: [...withoutOwnDayRules(external, data.bookings), ...bookingsToBusy(data.bookings)],
      blockedHostDates: blocked,
      rangeBlocks: expanded.ranges,
      openHostDates: new Set(data.admin.manualOpens),
      usOpenHostDates: new Set(data.admin.usOpenDates),
      closures: data.admin.regularClosures,
      start: cleaned.start,
    });
    if (!open) throw new HttpError(409, "That time is no longer open. Pick another.");
    data.bookings.push(booking);
  });

  try {
    const created = await createCalendarEvent(draftFor(booking));
    booking.calendarEventId = created.id;
    booking.meetLink = created.meetLink;
    booking.calendarDryRun = created.dryRun;
    await updateStore((data) => {
      const found = data.bookings.find((item) => item.id === booking.id);
      if (!found) return;
      found.calendarEventId = created.id;
      found.meetLink = created.meetLink;
      found.calendarDryRun = created.dryRun;
    });
  } catch (error) {
    console.error(error);
    await updateStore((data) => {
      const found = data.bookings.find((item) => item.id === booking.id);
      if (found) {
        found.status = "cancelled";
        found.cancelledAt = new Date().toISOString();
      }
    });
    throw new HttpError(502, "Could not add this to the calendar. The time was not booked.");
  }

  invalidateBusyCache();
  await sendPair(booking, origin, "new");
  return { ...toPublic(booking), token: booking.token };
}

async function reschedule(
  id: string,
  token: string,
  cleaned: ReturnType<typeof cleanRequest>,
  holidays: HolidayBlock[],
  external: BusyInterval[],
  origin: string,
  now: Date,
): Promise<PublicBooking & { token: string }> {
  const existing = (await readStore()).bookings.find((item) => item.id === id);
  if (!existing || !safeEqual(existing.token, token)) throw new HttpError(404, "That booking link is not valid.");
  if (existing.status !== "confirmed") throw new HttpError(409, "This meeting is already cancelled.");
  if (existing.meetingSlug !== cleaned.meeting.slug) {
    throw new HttpError(400, "Keep the same meeting type, or cancel and book the other one.");
  }

  const end = new Date(cleaned.start.getTime() + cleaned.meeting.durationMinutes * 60_000);
  const previous = {
    startUtc: existing.startUtc,
    endUtc: existing.endUtc,
    visitorTimeZone: existing.visitorTimeZone,
    name: existing.name,
    email: existing.email,
    company: existing.company,
    mode: existing.mode,
    phone: existing.phone,
    notes: existing.notes,
    reminderSendAt: existing.reminderSendAt,
    reminderSentAt: existing.reminderSentAt,
    meetLink: existing.meetLink,
  };

  let updated: Booking | null = null;
  await updateStore((data) => {
    const found = data.bookings.find((item) => item.id === id);
    if (!found || found.status !== "confirmed") throw new HttpError(409, "This meeting is already cancelled.");
    const access = resolveAccess({
      admin: data.admin,
      unlocks: data.admin.unlocks,
      unlockToken: undefined,
      booking: found,
      bookingToken: token,
      now,
    });
    if (cleaned.meeting.eveningOnly && !access.inPersonOpen) {
      throw new HttpError(409, "In-person meetings are closed right now.");
    }
    const expanded = adminBlocks(data.admin, now);
    const blocked = new Set([...expanded.wholeDays, ...holidays.map((holiday) => holiday.date)]);
    const open = isStartOpen({
      now,
      meeting: cleaned.meeting,
      usSlotsOpen: eveningOpenFor(cleaned.meeting, access),
      busy: [...withoutOwnDayRules(external, data.bookings), ...bookingsToBusy(data.bookings, id)],
      blockedHostDates: blocked,
      rangeBlocks: expanded.ranges,
      openHostDates: new Set(data.admin.manualOpens),
      usOpenHostDates: new Set(data.admin.usOpenDates),
      closures: data.admin.regularClosures,
      start: cleaned.start,
    });
    if (!open) throw new HttpError(409, "That time is no longer open. Pick another.");
    found.startUtc = cleaned.start.toISOString();
    found.endUtc = end.toISOString();
    found.visitorTimeZone = cleaned.timeZone;
    found.name = cleaned.name;
    found.email = cleaned.email;
    found.company = cleaned.company;
    found.mode = cleaned.mode;
    found.phone = cleaned.phone;
    if (cleaned.location) found.location = cleaned.location;
    else delete found.location;
    if (cleaned.notes) found.notes = cleaned.notes;
    else delete found.notes;
    found.reminderSendAt = computeReminderSendAt(cleaned.start, cleaned.timeZone, now)?.toISOString() ?? null;
    found.reminderSentAt = null;
    found.reminderAttempts = 0;
    found.emailDryRun = emailIsDryRun();
    updated = { ...found };
  });
  if (!updated) throw new HttpError(404, "That booking link is not valid.");
  const saved: Booking = updated;

  try {
    if (saved.calendarEventId) {
      const createMeet = saved.mode === "meet" && !previous.meetLink;
      const result = await updateCalendarEvent(saved.calendarEventId, draftFor(saved), createMeet);
      saved.meetLink = result.meetLink ?? (saved.mode === "meet" ? previous.meetLink : null);
      saved.calendarDryRun = result.dryRun;
      if (saved.mode !== "meet") saved.meetLink = null;
      await updateStore((data) => {
        const found = data.bookings.find((item) => item.id === id);
        if (!found) return;
        found.meetLink = saved.meetLink;
        found.calendarDryRun = saved.calendarDryRun;
      });
    }
  } catch (error) {
    console.error(error);
    await updateStore((data) => {
      const found = data.bookings.find((item) => item.id === id);
      if (!found) return;
      Object.assign(found, previous);
    });
    throw new HttpError(502, "Could not update the calendar event. Your original time is unchanged.");
  }

  invalidateBusyCache();
  await sendPair(saved, origin, "updated");
  return { ...toPublic(saved), token: saved.token };
}

export async function getPublicBooking(id: string, token: string): Promise<PublicBooking> {
  const booking = (await readStore()).bookings.find((item) => item.id === id);
  if (!booking || !safeEqual(booking.token, token)) throw new HttpError(404, "That booking link is not valid.");
  return toPublic(booking);
}

export async function cancelBooking(id: string, token: string, origin: string): Promise<PublicBooking> {
  const existing = (await readStore()).bookings.find((item) => item.id === id);
  if (!existing || !safeEqual(existing.token, token)) throw new HttpError(404, "That booking link is not valid.");
  if (existing.status === "cancelled") return toPublic(existing);

  if (existing.calendarEventId) await cancelCalendarEvent(existing.calendarEventId);

  let cancelled: Booking | null = null;
  await updateStore((data) => {
    const found = data.bookings.find((item) => item.id === id);
    if (!found) return;
    found.status = "cancelled";
    found.cancelledAt = new Date().toISOString();
    cancelled = { ...found };
  });
  if (!cancelled) throw new HttpError(404, "That booking link is not valid.");
  invalidateBusyCache();
  await sendPair(cancelled, origin, "cancelled");
  return toPublic(cancelled);
}

async function sendReminder(booking: Booking, origin: string) {
  const start = new Date(booking.startUtc);
  const sendAt = booking.reminderSendAt ? new Date(booking.reminderSendAt) : start;
  const message = guestReminder({
    name: booking.name,
    meetingSlug: booking.meetingSlug,
    start,
    end: new Date(booking.endUtc),
    guestTimeZone: booking.visitorTimeZone,
    mode: booking.mode,
    phone: booking.phone,
    location: booking.location,
    meetLink: booking.meetLink,
    links: linksFor(origin, booking),
    eveningBefore: isEveningBefore(sendAt, start, booking.visitorTimeZone),
  });
  await deliverEmail({ kind: "guest-reminder", to: booking.email, ...message });
}

let lastSweep = 0;

export async function maybeSweepReminders(origin?: string) {
  if (Date.now() - lastSweep < 60_000) return { sent: 0 };
  lastSweep = Date.now();
  return sendDueReminders(origin);
}

export async function sendDueReminders(origin = process.env.APP_ORIGIN || "http://127.0.0.1:43123") {
  const now = new Date();
  const due = (await readStore()).bookings.filter((booking) => {
    if (booking.status !== "confirmed" || !booking.reminderSendAt || booking.reminderSentAt) return false;
    if (booking.reminderAttempts >= 3) return false;
    return new Date(booking.reminderSendAt).getTime() <= now.getTime();
  });

  let sent = 0;
  for (const booking of due) {
    const claimed = await updateStore((data) => {
      const found = data.bookings.find((item) => item.id === booking.id);
      if (!found || found.reminderSentAt || found.status !== "confirmed") return null;
      found.reminderSentAt = new Date().toISOString();
      return { ...found };
    });
    if (!claimed) continue;
    try {
      await sendReminder(claimed, origin);
      sent += 1;
    } catch (error) {
      console.error(error);
      await updateStore((data) => {
        const found = data.bookings.find((item) => item.id === booking.id);
        if (!found) return;
        found.reminderSentAt = null;
        found.reminderAttempts += 1;
      });
    }
  }
  return { sent };
}
