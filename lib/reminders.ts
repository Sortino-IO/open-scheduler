import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDays, formatIsoDate } from "./time";

function hourInZone(date: Date, timeZone: string): number {
  return Number(formatInTimeZone(date, timeZone, "H"));
}

/**
 * About 3 hours before the meeting.
 * If that moment is before 08:00 in the guest's zone, send at 19:00 the evening before.
 * Skip when the send time is already too close to when they booked.
 */
export function computeReminderSendAt(start: Date, guestTimeZone: string, bookedAt: Date): Date | null {
  const threeHoursBefore = new Date(start.getTime() - 3 * 60 * 60 * 1000);
  let send = threeHoursBefore;
  if (hourInZone(threeHoursBefore, guestTimeZone) < 8) {
    const meetingDate = formatIsoDate(start, guestTimeZone);
    const previous = addDays(meetingDate, -1, guestTimeZone);
    send = fromZonedTime(`${previous}T19:00:00`, guestTimeZone);
  }
  if (send.getTime() <= bookedAt.getTime() + 15 * 60 * 1000) return null;
  if (send.getTime() >= start.getTime() - 10 * 60 * 1000) return null;
  return send;
}

export function isEveningBefore(sendAt: Date, start: Date, guestTimeZone: string): boolean {
  return formatIsoDate(sendAt, guestTimeZone) < formatIsoDate(start, guestTimeZone);
}
