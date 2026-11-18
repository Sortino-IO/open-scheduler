import { createSign } from "node:crypto";
import { eventsToBusy, type BusyInterval, type RawEvent } from "./busy";
import { HOST_TZ, addDays, formatIsoDate, weekdayIndex, zonedDateTime } from "./time";
import { newId } from "./store";
import { revalidateTag, unstable_cache } from "next/cache";
import {
  loadGoogleRefreshToken,
  readCalendarConnections,
  type ConnectedAccount,
} from "./google-oauth";

export type EventDraft = {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  attendeeEmail: string;
  attendeeName: string;
  withMeet: boolean;
  location?: string;
};

export type CreatedEvent = {
  id: string;
  meetLink: string | null;
  htmlLink: string | null;
  dryRun: boolean;
};

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/** Token endpoint errors that only a fresh Google consent fixes (revoked, expired, or wrong client). */
const GRANT_ERRORS = new Set(["invalid_grant", "unauthorized_client", "invalid_client"]);

export class CalendarAuthError extends Error {
  name = "CalendarAuthError";
}

export function isCalendarAuthError(error: unknown): error is Error {
  return error instanceof Error && (error.name === "CalendarAuthError" || GRANT_ERRORS.has(error.message));
}

export function calendarIds(): string[] {
  const raw = process.env.GOOGLE_CALENDAR_IDS || process.env.GOOGLE_CALENDAR_ID || "";
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

export function ownerEmails(): string[] {
  const owner = (process.env.GOOGLE_CALENDAR_OWNER || "").trim();
  return [...new Set([owner, ...calendarIds()].map((email) => email.toLowerCase()).filter(Boolean))];
}

export function bookingCalendarId(): string {
  const id = (process.env.GOOGLE_BOOKING_CALENDAR_ID || "").trim();
  if (id) return id;
  const first = calendarIds()[0];
  if (first) return first;
  throw new Error("Set GOOGLE_BOOKING_CALENDAR_ID or GOOGLE_CALENDAR_IDS, or connect a Google calendar in admin.");
}

async function oauthConfigured(): Promise<boolean> {
  if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) return false;
  const conn = await readCalendarConnections();
  return conn.accounts.length > 0 || Boolean(await loadGoogleRefreshToken());
}

function serviceAccountConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

export async function calendarIsDryRun(): Promise<boolean> {
  if (process.env.CALENDAR_DRY_RUN === "true") return true;
  return !(await oauthConfigured()) && !serviceAccountConfigured();
}

function privateKey(): string {
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "";
  if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
  return key.replace(/\\n/g, "\n");
}

const tokenCache = new Map<string, { token: string; exp: number }>();

async function fetchAccessTokenForRefresh(refresh: string): Promise<string> {
  const cached = tokenCache.get(refresh);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !json.access_token) {
    if (json.error && GRANT_ERRORS.has(json.error)) throw new CalendarAuthError(json.error);
    throw new Error(json.error || `Google token request failed (${response.status})`);
  }
  tokenCache.set(refresh, {
    token: json.access_token,
    exp: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
  });
  return json.access_token;
}

/** One account's grant, checked through the same cached token path the slots use. */
export async function accountGrantStatus(refresh: string): Promise<"ok" | "disconnected" | "unknown"> {
  try {
    await fetchAccessTokenForRefresh(refresh);
    return "ok";
  } catch (error) {
    return isCalendarAuthError(error) ? "disconnected" : "unknown";
  }
}

async function fetchAccessToken(): Promise<string> {
  if (await oauthConfigured()) {
    const refresh = (await loadGoogleRefreshToken()) ?? "";
    if (!refresh) throw new Error("No Google refresh token configured.");
    return fetchAccessTokenForRefresh(refresh);
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
  const subject = process.env.GOOGLE_IMPERSONATE_USER?.trim();
  if (!subject) {
    throw new Error("GOOGLE_IMPERSONATE_USER must be set when using a service account.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claim = Buffer.from(
    JSON.stringify({
      iss: email,
      scope: CALENDAR_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      sub: subject,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey()).toString("base64url");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${signature}`,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error || `Google token request failed (${response.status})`);
  }
  return json.access_token;
}

function mapEvent(item: {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  transparency?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: { email?: string; responseStatus?: string; self?: boolean }[];
}): RawEvent | null {
  if (!item.start) return null;
  const allDay = Boolean(item.start.date && !item.start.dateTime);
  const start = item.start.dateTime || item.start.date;
  const end = item.end?.dateTime || item.end?.date;
  if (!start || !end) return null;
  return {
    id: item.id,
    summary: item.summary,
    description: item.description,
    location: item.location,
    status: item.status,
    transparency: item.transparency,
    eventType: item.eventType,
    allDay,
    start,
    end,
    organizerEmail: item.organizer?.email,
    organizerSelf: item.organizer?.self,
    attendees: item.attendees
      ?.filter((a): a is { email: string; responseStatus?: string; self?: boolean } => Boolean(a.email))
      .map((a) => ({ email: a.email, responseStatus: a.responseStatus, self: a.self })),
  };
}

async function listEvents(calendarId: string, start: Date, end: Date, token: string): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", start.toISOString());
    url.searchParams.set("timeMax", end.toISOString());
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = (await response.json()) as {
      items?: Parameters<typeof mapEvent>[0][];
      nextPageToken?: string;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(json.error?.message || `Calendar list failed (${response.status})`);
    for (const item of json.items || []) {
      const mapped = mapEvent(item);
      if (mapped) events.push(mapped);
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return events;
}

function mockRawEvents(now: Date): RawEvent[] {
  const today = formatIsoDate(now, HOST_TZ);
  const mondayOffset = (7 + weekdayIndex(today, HOST_TZ) - 1) % 7;
  const monday = addDays(today, -mondayOffset, HOST_TZ);
  const at = (date: string, minute: number) => zonedDateTime(date, minute, HOST_TZ);
  return [
    {
      summary: "Focus block",
      allDay: false,
      start: at(monday, 11 * 60).toISOString(),
      end: at(monday, 12 * 60).toISOString(),
      organizerEmail: "host@example.com",
      organizerSelf: true,
      attendees: [{ email: "host@example.com", responseStatus: "accepted", self: true }],
      status: "confirmed",
    },
    {
      summary: "Maybe coffee",
      allDay: false,
      start: at(monday, 13 * 60).toISOString(),
      end: at(monday, 13 * 60 + 30).toISOString(),
      organizerEmail: "friend@example.com",
      attendees: [{ email: "host@example.com", responseStatus: "tentative", self: true }],
      status: "confirmed",
    },
  ];
}

async function resolveOwners(connAccounts: ConnectedAccount[]): Promise<string[]> {
  const emails = new Set(ownerEmails());
  for (const account of connAccounts) emails.add(account.email.toLowerCase());
  return [...emails];
}

const BUSY_CACHE_MS = 45_000;
let busyCache: { key: string; at: number; value: BusyInterval[]; inflight?: Promise<BusyInterval[]> } | null = null;

export function invalidateBusyCache(): void {
  busyCache = null;
  try {
    revalidateTag("calendar-busy", "max");
  } catch {
    // Outside a Next request scope (tests / scripts) this is a no-op.
  }
}

async function fetchBusyIntervalsUncached(start: Date, end: Date, now: Date): Promise<BusyInterval[]> {
  if (await calendarIsDryRun()) return eventsToBusy(mockRawEvents(now), ownerEmails());

  const conn = await readCalendarConnections();
  if (conn.accounts.length === 0) {
    const token = await fetchAccessToken();
    const batches = await Promise.all(calendarIds().map((id) => listEvents(id, start, end, token)));
    return eventsToBusy(batches.flat(), ownerEmails());
  }

  const accountBatches = await Promise.all(
    conn.accounts.map(async (account) => {
      const selected = account.calendars.filter((c) => c.checkConflicts);
      if (selected.length === 0) return [] as RawEvent[];
      const token = await fetchAccessTokenForRefresh(account.refresh_token);
      const listed = await Promise.all(selected.map((c) => listEvents(c.id, start, end, token)));
      return listed.flat();
    }),
  );
  return eventsToBusy(accountBatches.flat(), await resolveOwners(conn.accounts));
}

/** Shared across warm serverless isolates via Next data cache (~45s). */
async function fetchBusyIntervals(start: Date, end: Date, now: Date): Promise<BusyInterval[]> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const cached = unstable_cache(
    async () => {
      const intervals = await fetchBusyIntervalsUncached(new Date(startMs), new Date(endMs), new Date(now.getTime()));
      return intervals.map((interval) => ({
        ...interval,
        start: interval.start.toISOString(),
        end: interval.end.toISOString(),
      }));
    },
    ["calendar-busy", String(startMs), String(endMs)],
    { revalidate: 45, tags: ["calendar-busy"] },
  );
  const rows = await cached();
  return rows.map((interval) => ({
    ...interval,
    start: new Date(interval.start),
    end: new Date(interval.end),
  }));
}

function roundBusyWindow(start: Date, end: Date): { start: Date; end: Date; key: string } {
  // Bucket to one-minute windows so every /api/slots call shares the same busy cache.
  const startMs = Math.floor(start.getTime() / 60_000) * 60_000;
  const endMs = Math.ceil(end.getTime() / 60_000) * 60_000;
  return {
    start: new Date(startMs),
    end: new Date(endMs),
    key: `${startMs}|${endMs}`,
  };
}

export async function getBusyIntervals(start: Date, end: Date, now = new Date()): Promise<BusyInterval[]> {
  const window = roundBusyWindow(start, end);
  const key = window.key;
  if (busyCache && busyCache.key === key && Date.now() - busyCache.at < BUSY_CACHE_MS) {
    return busyCache.value.map((interval) => ({ ...interval, start: new Date(interval.start), end: new Date(interval.end) }));
  }
  if (busyCache && busyCache.key === key && busyCache.inflight) return busyCache.inflight;

  const inflight = fetchBusyIntervals(window.start, window.end, now).then((value) => {
    busyCache = { key, at: Date.now(), value };
    return value;
  });
  busyCache = { key, at: 0, value: busyCache?.value ?? [], inflight };
  try {
    return await inflight;
  } finally {
    if (busyCache?.inflight === inflight) busyCache.inflight = undefined;
  }
}

async function bookingDestination(): Promise<{ calendarId: string; token: string }> {
  const conn = await readCalendarConnections();
  if (conn.bookingTarget) {
    const account = conn.accounts.find((a) => a.id === conn.bookingTarget!.accountId);
    if (account) {
      return {
        calendarId: conn.bookingTarget.calendarId,
        token: await fetchAccessTokenForRefresh(account.refresh_token),
      };
    }
  }
  if (conn.accounts[0]) {
    const account = conn.accounts[0];
    const cal = account.calendars.find((c) => c.primary) || account.calendars[0];
    return {
      calendarId: cal?.id || bookingCalendarId(),
      token: await fetchAccessTokenForRefresh(account.refresh_token),
    };
  }
  return { calendarId: bookingCalendarId(), token: await fetchAccessToken() };
}

function eventBody(draft: EventDraft, createMeet: boolean) {
  return {
    summary: draft.summary,
    description: draft.description,
    start: { dateTime: draft.start.toISOString(), timeZone: "UTC" },
    end: { dateTime: draft.end.toISOString(), timeZone: "UTC" },
    attendees: [{ email: draft.attendeeEmail, displayName: draft.attendeeName }],
    ...(draft.location ? { location: draft.location } : {}),
    ...(createMeet
      ? {
          conferenceData: {
            createRequest: {
              requestId: newId(12),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }
      : {}),
  };
}

function meetLinkOf(event: {
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const video = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video");
  return video?.uri ?? null;
}

export async function createCalendarEvent(draft: EventDraft): Promise<CreatedEvent> {
  if (await calendarIsDryRun()) {
    return { id: `dry_${newId()}`, meetLink: null, htmlLink: null, dryRun: true };
  }
  const { calendarId, token } = await bookingDestination();
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("sendUpdates", "all");
  if (draft.withMeet) url.searchParams.set("conferenceDataVersion", "1");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(draft, draft.withMeet)),
  });
  const json = (await response.json()) as {
    id?: string;
    htmlLink?: string;
    error?: { message?: string };
  } & Parameters<typeof meetLinkOf>[0];
  if (!response.ok || !json.id) throw new Error(json.error?.message || `Calendar create failed (${response.status})`);
  return { id: json.id, meetLink: draft.withMeet ? meetLinkOf(json) : null, htmlLink: json.htmlLink ?? null, dryRun: false };
}

export async function updateCalendarEvent(id: string, draft: EventDraft, createMeet: boolean): Promise<CreatedEvent> {
  if (id.startsWith("dry_") || (await calendarIsDryRun())) {
    return { id, meetLink: null, htmlLink: null, dryRun: true };
  }
  const { calendarId, token } = await bookingDestination();
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
  );
  url.searchParams.set("sendUpdates", "all");
  if (createMeet) url.searchParams.set("conferenceDataVersion", "1");
  const response = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(draft, createMeet)),
  });
  const json = (await response.json()) as {
    id?: string;
    htmlLink?: string;
    error?: { message?: string };
  } & Parameters<typeof meetLinkOf>[0];
  if (!response.ok || !json.id) throw new Error(json.error?.message || `Calendar update failed (${response.status})`);
  return { id: json.id, meetLink: draft.withMeet ? meetLinkOf(json) : null, htmlLink: json.htmlLink ?? null, dryRun: false };
}

export async function cancelCalendarEvent(id: string): Promise<void> {
  if (id.startsWith("dry_") || (await calendarIsDryRun())) return;
  const { calendarId, token } = await bookingDestination();
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
  );
  url.searchParams.set("sendUpdates", "all");
  const response = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Calendar cancel failed (${response.status})`);
  }
}
