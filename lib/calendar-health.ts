import { del, put } from "@vercel/blob";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { calendarDisconnectedAlert } from "./email-templates";
import { deliverEmail, notifyEmail } from "./mail";
import { appOrigin } from "./origin";
import { blobConfigured } from "./store";

/**
 * One persisted "calendar disconnected" marker. Creating it is create-only, so across
 * instances exactly one caller wins and sends the alert. Reconnecting deletes it.
 */
const BLOB_PATH = "schedule/calendar-disconnected.json";
const FILE_PATH = path.join(process.cwd(), ".data", "calendar-disconnected.json");
const RECHECK_MS = 60 * 60 * 1000;

let markerSeenAt = 0;

async function createMarker(body: string): Promise<boolean> {
  if (blobConfigured()) {
    try {
      await put(BLOB_PATH, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
      });
      return true;
    } catch (error) {
      // Normally "already exists". Any other failure also skips the email rather than risk repeats.
      console.error("calendar alert marker not created:", error instanceof Error ? error.message : "unknown error");
      return false;
    }
  }
  try {
    await mkdir(path.dirname(FILE_PATH), { recursive: true });
    await writeFile(FILE_PATH, body, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

/** First failure sends one alert to the booking-notice inbox. Never throws. */
export async function reportCalendarDisconnected(reason: string, now = Date.now()): Promise<void> {
  if (now - markerSeenAt < RECHECK_MS) return;
  markerSeenAt = now;
  const code = /^[a-z_]{1,40}$/.test(reason) ? reason : "authorization failed";
  try {
    if (!(await createMarker(JSON.stringify({ at: new Date(now).toISOString(), reason: code })))) return;
    console.error("calendar disconnected:", code);
    const to = notifyEmail();
    if (!to) return;
    await deliverEmail({
      kind: "calendar_alert",
      to,
      ...calendarDisconnectedAlert({ reason: code, adminUrl: `${appOrigin()}/admin` }),
    });
  } catch (error) {
    console.error("calendar alert failed:", error instanceof Error ? error.message : "unknown error");
  }
}

/** Called after a working grant is confirmed, so the next failure alerts again. */
export async function clearCalendarDisconnected(): Promise<void> {
  markerSeenAt = 0;
  try {
    if (blobConfigured()) await del(BLOB_PATH);
    else await rm(FILE_PATH, { force: true });
  } catch (error) {
    console.error("calendar alert marker not cleared:", error instanceof Error ? error.message : "unknown error");
  }
}
