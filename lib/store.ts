import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import type { RecurringBlock, TimeBlock } from "./blocks";
import { parseClosure, type RegularClosure } from "./closures";
import type { PersonUnlock } from "./unlocks";
import type { HolidayBlock } from "./holidays";
import type { MeetingMode, MeetingSlug } from "./meetings";

export type { RecurringBlock, TimeBlock };
export type { PersonUnlock };

export type AdminState = {
  usSlotsOpen: boolean;
  inPersonOpen: boolean;
  /** Whole Israel days blocked once. */
  manualBlocks: string[];
  /** Whole Israel days opened once (inverse of a manual block): offers the standard daytime window even if the meeting type's weekday list would skip the date. Friday, Saturday, and auto-holidays still stay closed. */
  manualOpens: string[];
  /** Israel days that offer the US evening window once (Intro and 45-minute), as if the US toggle were on for that date only. Friday, Saturday, and auto-holidays still stay closed. */
  usOpenDates: string[];
  /** Partial-day (or whole-day) one-off ranges. */
  timeBlocks: TimeBlock[];
  /** Repeating whole-day or time-range blocks. */
  recurringBlocks: RecurringBlock[];
  /** Blanket weekly closures per meeting type, in the order they were added. */
  regularClosures: RegularClosure[];
  /** Per-person US / in-person unlocks. */
  unlocks: PersonUnlock[];
};

export type Booking = {
  id: string;
  token: string;
  meetingSlug: MeetingSlug;
  startUtc: string;
  endUtc: string;
  visitorTimeZone: string;
  name: string;
  email: string;
  company: string;
  mode: MeetingMode;
  phone: string;
  location?: string;
  notes?: string;
  status: "confirmed" | "cancelled";
  meetLink: string | null;
  calendarEventId: string | null;
  calendarDryRun: boolean;
  emailDryRun: boolean;
  reminderSendAt: string | null;
  reminderSentAt: string | null;
  reminderAttempts: number;
  createdAt: string;
  cancelledAt: string | null;
};

export type QueuedEmail = {
  id: string;
  kind: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  createdAt: string;
  status: "queued" | "sent" | "failed";
  error?: string;
};

export type HolidayCache = {
  fetchedAt: string;
  blocks: HolidayBlock[];
};

export type StoreData = {
  admin: AdminState;
  bookings: Booking[];
  emails: QueuedEmail[];
  holidayCache: HolidayCache | null;
};

const BLOB_PATH = "schedule/store.json";
const FILE_PATH = path.join(process.cwd(), ".data", "store.json");

let memory: StoreData | null = null;
let queue: Promise<unknown> = Promise.resolve();

function empty(): StoreData {
  return {
    admin: {
      usSlotsOpen: false,
      inPersonOpen: false,
      manualBlocks: [],
      manualOpens: [],
      usOpenDates: [],
      timeBlocks: [],
      recurringBlocks: [],
      regularClosures: [],
      unlocks: [],
    },
    bookings: [],
    emails: [],
    holidayCache: null,
  };
}

function normalizeTimeBlocks(value: unknown): TimeBlock[] {
  if (!Array.isArray(value)) return [];
  const out: TimeBlock[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<TimeBlock>;
    if (typeof row.id !== "string" || typeof row.date !== "string") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const startMinute = Number(row.startMinute);
    const endMinute = Number(row.endMinute);
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) continue;
    if (endMinute <= startMinute) continue;
    out.push({ id: row.id, date: row.date, startMinute, endMinute });
  }
  return out;
}

function normalizeRecurring(value: unknown): RecurringBlock[] {
  if (!Array.isArray(value)) return [];
  const out: RecurringBlock[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<RecurringBlock>;
    if (typeof row.id !== "string" || typeof row.anchorDate !== "string") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.anchorDate)) continue;
    if (row.frequency !== "weekly" && row.frequency !== "monthly" && row.frequency !== "yearly") continue;
    const startMinute = row.startMinute == null ? null : Number(row.startMinute);
    const endMinute = row.endMinute == null ? null : Number(row.endMinute);
    if (startMinute != null && (!Number.isFinite(startMinute) || !Number.isFinite(endMinute as number))) continue;
    if (startMinute != null && (endMinute as number) <= startMinute) continue;
    const until =
      typeof row.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.until) ? row.until : null;
    out.push({
      id: row.id,
      frequency: row.frequency,
      anchorDate: row.anchorDate,
      startMinute,
      endMinute: startMinute == null ? null : (endMinute as number),
      until,
    });
  }
  return out;
}

/** Stored closures that still pass the admin API's rules; anything else is dropped rather than guessed at. */
function normalizeClosures(value: unknown): RegularClosure[] {
  if (!Array.isArray(value)) return [];
  const out: RegularClosure[] = [];
  for (const item of value) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !id) continue;
    const parsed = parseClosure(item);
    if (!("error" in parsed)) out.push({ id, ...parsed });
  }
  return out;
}

function normalizeUnlocks(value: unknown): PersonUnlock[] {
  if (!Array.isArray(value)) return [];
  const out: PersonUnlock[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<PersonUnlock>;
    if (typeof row.id !== "string" || typeof row.email !== "string") continue;
    if (typeof row.createdAt !== "string" || typeof row.expiresAt !== "string") continue;
    const email = row.email.trim().toLowerCase();
    if (!email.includes("@")) continue;
    const token = typeof row.token === "string" && row.token.includes(".") ? row.token : "";
    out.push({
      id: row.id,
      email,
      name: typeof row.name === "string" ? row.name.trim() : "",
      usSlots: Boolean(row.usSlots),
      inPerson: Boolean(row.inPerson),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: typeof row.revokedAt === "string" ? row.revokedAt : null,
      token,
    });
  }
  return out;
}

function normalizeDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

export function normalizeStore(value: Partial<StoreData> | null | undefined): StoreData {
  const base = empty();
  if (!value || typeof value !== "object") return base;
  return {
    admin: {
      usSlotsOpen: Boolean(value.admin?.usSlotsOpen),
      inPersonOpen: Boolean(value.admin?.inPersonOpen),
      manualBlocks: Array.isArray(value.admin?.manualBlocks)
        ? [...new Set(value.admin.manualBlocks.filter((date) => typeof date === "string"))].sort()
        : [],
      manualOpens: normalizeDates(value.admin?.manualOpens),
      usOpenDates: normalizeDates(value.admin?.usOpenDates),
      timeBlocks: normalizeTimeBlocks(value.admin?.timeBlocks),
      recurringBlocks: normalizeRecurring(value.admin?.recurringBlocks),
      regularClosures: normalizeClosures(value.admin?.regularClosures),
      unlocks: normalizeUnlocks(value.admin?.unlocks),
    },
    bookings: Array.isArray(value.bookings) ? value.bookings : [],
    emails: Array.isArray(value.emails) ? value.emails : [],
    holidayCache: value.holidayCache ?? null,
  };
}

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

async function readRaw(): Promise<StoreData> {
  if (blobConfigured()) {
    try {
      const blob = await get(BLOB_PATH, { access: "private", useCache: false });
      if (!blob) return empty();
      const text = await new Response(blob.stream).text();
      return normalizeStore(JSON.parse(text) as StoreData);
    } catch (error) {
      if (error instanceof BlobNotFoundError) return empty();
      throw error;
    }
  }

  try {
    const text = await readFile(FILE_PATH, "utf8");
    return normalizeStore(JSON.parse(text) as StoreData);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EROFS") {
      return structuredClone(memory ?? empty());
    }
    throw error;
  }
}

async function writeRaw(data: StoreData): Promise<void> {
  data.emails = data.emails.slice(-40);
  if (blobConfigured()) {
    await put(BLOB_PATH, JSON.stringify(data), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }

  try {
    await mkdir(path.dirname(FILE_PATH), { recursive: true });
    await writeFile(FILE_PATH, JSON.stringify(data, null, 2));
    memory = null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EROFS" || code === "ENOENT") {
      memory = structuredClone(data);
      return;
    }
    throw error;
  }
}

/** Bounds how long another server instance can serve settings older than an admin change. */
const STORE_READ_CACHE_MS = 5_000;
let storeReadCache: { at: number; value: StoreData; inflight?: Promise<StoreData> } | null = null;

export function invalidateStoreCache(): void {
  storeReadCache = null;
}

export async function readStore(): Promise<StoreData> {
  if (storeReadCache && Date.now() - storeReadCache.at < STORE_READ_CACHE_MS) {
    return structuredClone(storeReadCache.value);
  }
  if (storeReadCache?.inflight) return structuredClone(await storeReadCache.inflight);

  const inflight = readRaw().then((value) => {
    storeReadCache = { at: Date.now(), value };
    return value;
  });
  storeReadCache = { at: 0, value: storeReadCache?.value ?? empty(), inflight };
  try {
    return structuredClone(await inflight);
  } finally {
    if (storeReadCache?.inflight === inflight) storeReadCache.inflight = undefined;
  }
}

export function updateStore<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const data = await readRaw();
    const result = await fn(data);
    await writeRaw(data);
    storeReadCache = { at: Date.now(), value: structuredClone(data) };
    return result;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function newId(bytes = 9): string {
  return randomBytes(bytes).toString("base64url");
}
