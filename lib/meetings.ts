export type MeetingSlug = "intro" | "45" | "inperson";
export type MeetingMode = "meet" | "phone" | "inperson";

export type MeetingType = {
  slug: MeetingSlug;
  name: string;
  durationMinutes: number;
  /** Minutes between candidate start times. */
  stepMinutes: number;
  /** 0 = Sunday … 6 = Saturday. Standard window only. */
  standardDays: number[];
  standardStart: number;
  standardEnd: number;
  /** Evening window (US or in-person). Gated by the matching admin toggle. */
  usDays: number[];
  usStart: number;
  usEnd: number;
  path: string;
  /** When true, only the evening window is used, gated by inPersonOpen. */
  eveningOnly?: boolean;
  /** Booker must enter a location; stored on the calendar event. */
  requiresLocation?: boolean;
};

const STANDARD_START = 11 * 60;
const STANDARD_END = 15 * 60;
const US_START = 21 * 60;
const US_END = 24 * 60;
const INPERSON_START = 21 * 60 + 30;

export const MEETINGS: Record<MeetingSlug, MeetingType> = {
  intro: {
    slug: "intro",
    name: "Intro call",
    durationMinutes: 30,
    stepMinutes: 30,
    standardDays: [0, 1, 2, 3, 4],
    standardStart: STANDARD_START,
    standardEnd: STANDARD_END,
    usDays: [1, 2, 3],
    usStart: US_START,
    usEnd: US_END,
    path: "/intro",
  },
  "45": {
    slug: "45",
    name: "45 Minute Meeting",
    durationMinutes: 45,
    stepMinutes: 15,
    standardDays: [1, 2, 4],
    standardStart: STANDARD_START,
    standardEnd: STANDARD_END,
    usDays: [1, 2, 3],
    usStart: US_START,
    usEnd: US_END,
    path: "/45-minute",
  },
  inperson: {
    slug: "inperson",
    name: "In-person meeting",
    durationMinutes: 60,
    stepMinutes: 30,
    standardDays: [],
    standardStart: 0,
    standardEnd: 0,
    usDays: [1, 2, 3],
    usStart: INPERSON_START,
    usEnd: US_END,
    path: "/in-person",
    eveningOnly: true,
    requiresLocation: true,
  },
};

export function getMeeting(slug: string | null | undefined): MeetingType | null {
  if (slug === "intro" || slug === "30" || slug === "intro-call") return MEETINGS.intro;
  if (slug === "45" || slug === "45-minute") return MEETINGS["45"];
  if (slug === "inperson" || slug === "in-person" || slug === "frontal") return MEETINGS.inperson;
  return null;
}

export const TIME_ZONES = [
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export function cityName(timeZone: string): string {
  return timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
}

export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}
