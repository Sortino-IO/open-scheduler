import { BlobNotFoundError, get, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { adminSecret, safeEqual } from "./admin-auth";
import { appOrigin } from "./origin";
import { blobConfigured, newId } from "./store";

const BLOB_PATH = "secrets/google-calendar-connections.json";
const FILE_PATH = path.join(process.cwd(), ".data", "google-calendar-connections.json");
export const STATE_COOKIE = "gcal_oauth_state";
const MAX_ACCOUNTS = 4;

export type ConnectedCalendar = {
  id: string;
  summary: string;
  primary: boolean;
  checkConflicts: boolean;
};

export type ConnectedAccount = {
  id: string;
  email: string;
  refresh_token: string;
  scope?: string;
  obtained_at: string;
  calendars: ConnectedCalendar[];
};

export type CalendarConnections = {
  version: 2;
  accounts: ConnectedAccount[];
  bookingTarget: { accountId: string; calendarId: string } | null;
};

export function googleRedirectUri(request: Request): string {
  return `${appOrigin(request)}/api/oauth/google/callback`;
}

export function googleAuthUrl(request: Request, state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(request),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar openid email",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function newOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

const OAUTH_STATE_TTL_MS = 20 * 60 * 1000;

/** Signed `state.expiry.mac` cookie value. No secret means no OAuth flow. */
export function signOAuthState(state: string, now = Date.now()): string {
  const secret = adminSecret();
  if (!secret) throw new Error("Admin secret is not configured");
  const payload = `${state}.${now + OAUTH_STATE_TTL_MS}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifyOAuthStateCookie(cookie: string | undefined, state: string, now = Date.now()): boolean {
  const secret = adminSecret();
  if (!secret || !cookie || !state) return false;
  const [raw, exp, mac] = cookie.split(".");
  if (!raw || !exp || !mac || raw !== state) return false;
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < now) return false;
  return safeEqual(mac, createHmac("sha256", secret).update(`${raw}.${exp}`).digest("base64url"));
}

function emptyConnections(): CalendarConnections {
  return { version: 2, accounts: [], bookingTarget: null };
}

async function readRawJson(blobPath: string, filePath: string): Promise<unknown | null> {
  if (blobConfigured()) {
    try {
      const blob = await get(blobPath, { access: "private", useCache: false });
      if (!blob) return null;
      return JSON.parse(await new Response(blob.stream).text());
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeRawJson(blobPath: string, filePath: string, data: unknown): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  if (blobConfigured()) {
    await put(blobPath, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
}

const CONNECTIONS_CACHE_MS = 60_000;
let connectionsCache: { at: number; value: CalendarConnections; inflight?: Promise<CalendarConnections> } | null =
  null;

async function loadCalendarConnections(): Promise<CalendarConnections> {
  const current = await readRawJson(BLOB_PATH, FILE_PATH);
  if (current && typeof current === "object" && (current as CalendarConnections).version === 2) {
    const conn = current as CalendarConnections;
    conn.accounts = Array.isArray(conn.accounts) ? conn.accounts : [];
    return conn;
  }
  return emptyConnections();
}

export async function readCalendarConnections(): Promise<CalendarConnections> {
  if (connectionsCache && Date.now() - connectionsCache.at < CONNECTIONS_CACHE_MS) {
    return structuredClone(connectionsCache.value);
  }
  if (connectionsCache?.inflight) return structuredClone(await connectionsCache.inflight);

  const inflight = loadCalendarConnections().then((value) => {
    connectionsCache = { at: Date.now(), value };
    return value;
  });
  connectionsCache = { at: 0, value: connectionsCache?.value ?? emptyConnections(), inflight };
  try {
    return structuredClone(await inflight);
  } finally {
    if (connectionsCache?.inflight === inflight) connectionsCache.inflight = undefined;
  }
}

export async function writeCalendarConnections(data: CalendarConnections): Promise<void> {
  await writeRawJson(BLOB_PATH, FILE_PATH, data);
  connectionsCache = { at: Date.now(), value: structuredClone(data) };
}

/** Back-compat for older callers. */
export async function loadGoogleRefreshToken(): Promise<string | null> {
  if (process.env.GOOGLE_REFRESH_TOKEN) return process.env.GOOGLE_REFRESH_TOKEN;
  const conn = await readCalendarConnections();
  const target = conn.bookingTarget
    ? conn.accounts.find((a) => a.id === conn.bookingTarget!.accountId)
    : conn.accounts[0];
  return target?.refresh_token || conn.accounts[0]?.refresh_token || null;
}

export async function upsertConnectedAccount(input: {
  email: string;
  refresh_token: string;
  scope?: string;
  calendars: ConnectedCalendar[];
}): Promise<CalendarConnections> {
  const conn = await readCalendarConnections();
  const email = input.email.trim().toLowerCase();
  const existing = conn.accounts.find((a) => a.email === email);
  if (existing) {
    existing.refresh_token = input.refresh_token;
    existing.scope = input.scope;
    existing.obtained_at = new Date().toISOString();
    // Merge calendars: keep checkConflicts prefs by id
    const prev = new Map(existing.calendars.map((c) => [c.id, c]));
    existing.calendars = input.calendars.map((c) => ({
      ...c,
      checkConflicts: prev.get(c.id)?.checkConflicts ?? c.checkConflicts,
    }));
  } else {
    if (conn.accounts.length >= MAX_ACCOUNTS) {
      throw new Error(`You can connect up to ${MAX_ACCOUNTS} Google accounts.`);
    }
    const account: ConnectedAccount = {
      id: newId(),
      email,
      refresh_token: input.refresh_token,
      scope: input.scope,
      obtained_at: new Date().toISOString(),
      calendars: input.calendars,
    };
    conn.accounts.push(account);
    if (!conn.bookingTarget) {
      const primary = account.calendars.find((c) => c.primary) || account.calendars[0];
      if (primary) conn.bookingTarget = { accountId: account.id, calendarId: primary.id };
    }
  }
  await writeCalendarConnections(conn);
  return conn;
}

export async function disconnectAccount(accountId: string): Promise<CalendarConnections> {
  const conn = await readCalendarConnections();
  conn.accounts = conn.accounts.filter((a) => a.id !== accountId);
  if (conn.bookingTarget?.accountId === accountId) {
    const fallback = conn.accounts[0];
    const cal = fallback?.calendars.find((c) => c.primary) || fallback?.calendars[0];
    conn.bookingTarget = fallback && cal ? { accountId: fallback.id, calendarId: cal.id } : null;
  }
  await writeCalendarConnections(conn);
  return conn;
}

export async function updateCalendarPrefs(input: {
  accountId: string;
  calendarId: string;
  checkConflicts?: boolean;
  setBookingTarget?: boolean;
}): Promise<CalendarConnections> {
  const conn = await readCalendarConnections();
  const account = conn.accounts.find((a) => a.id === input.accountId);
  if (!account) throw new Error("Account not found.");
  const cal = account.calendars.find((c) => c.id === input.calendarId);
  if (!cal) throw new Error("Calendar not found.");
  if (typeof input.checkConflicts === "boolean") cal.checkConflicts = input.checkConflicts;
  if (input.setBookingTarget) conn.bookingTarget = { accountId: account.id, calendarId: cal.id };
  await writeCalendarConnections(conn);
  return conn;
}

export async function exchangeGoogleCode(request: Request, code: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: googleRedirectUri(request),
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    throw new Error(json.error_description || json.error || `Token exchange failed (${response.status})`);
  }
  return json;
}

export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await response.json()) as { email?: string };
  if (!response.ok || !json.email) throw new Error("Could not read Google account email.");
  return json.email.toLowerCase();
}

export async function listGoogleCalendars(accessToken: string): Promise<ConnectedCalendar[]> {
  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await response.json()) as {
    items?: { id?: string; summary?: string; primary?: boolean; accessRole?: string }[];
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(json.error?.message || "Could not list calendars.");
  return (json.items || [])
    .filter((item) => item.id)
    .map((item) => ({
      id: item.id as string,
      summary: item.summary || (item.id as string),
      primary: Boolean(item.primary),
      checkConflicts: Boolean(item.primary) || item.accessRole === "owner",
    }));
}

export function publicConnectionsView(conn: CalendarConnections) {
  return {
    maxAccounts: MAX_ACCOUNTS,
    accounts: conn.accounts.map((a) => ({
      id: a.id,
      email: a.email,
      obtainedAt: a.obtained_at,
      calendars: a.calendars,
    })),
    bookingTarget: conn.bookingTarget,
  };
}

export { MAX_ACCOUNTS };
