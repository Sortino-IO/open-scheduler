import { isAdmin } from "@/lib/admin-auth";
import type { RecurringFrequency } from "@/lib/blocks";
import { calendarIsDryRun } from "@/lib/calendar";
import { parseClosure } from "@/lib/closures";
import { jsonError, HttpError, readJsonObject } from "@/lib/http";
import { kindLabel } from "@/lib/holidays";
import { deliverEmail, emailIsDryRun } from "@/lib/mail";
import { guestUnlockNotice } from "@/lib/email-templates";
import { MEETINGS } from "@/lib/meetings";
import { holidayBlocks } from "@/lib/scheduling";
import { blobConfigured, newId, readStore, updateStore, type AdminState } from "@/lib/store";
import { withDayBlocked, withDayOpen, withDayUsOpen } from "@/lib/day-settings";
import { isUnlockActive, issueUnlockToken, normalizeEmail, personalLinks } from "@/lib/unlocks";
import { appOrigin } from "@/lib/origin";
import { HOST_TZ, formatIsoDate, formatWhen, isIsoDate, weekdayIndex } from "@/lib/time";

async function requireAdmin() {
  if (!(await isAdmin())) throw new HttpError(401, "Sign in required.");
}

/** The availability settings the admin panel edits. Unlock tokens stay out of mutation responses. */
function availabilityOf(admin: AdminState) {
  return {
    usSlotsOpen: admin.usSlotsOpen,
    inPersonOpen: admin.inPersonOpen,
    manualBlocks: admin.manualBlocks,
    manualOpens: admin.manualOpens,
    usOpenDates: admin.usOpenDates,
    timeBlocks: admin.timeBlocks,
    recurringBlocks: admin.recurringBlocks,
    regularClosures: admin.regularClosures,
  };
}

/** Validated closure fields from a request, or a 400 with the reason. */
function requireClosure(input: unknown) {
  const parsed = parseClosure(input);
  if ("error" in parsed) throw new HttpError(400, parsed.error);
  return parsed;
}

/** Minutes from midnight on an Israel day, 0–1440 inclusive. */
function isDayMinute(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 24 * 60;
}

function requireDate(value: unknown): string {
  if (!isIsoDate(value)) throw new HttpError(400, "Date must be a real YYYY-MM-DD date.");
  return value;
}

/** One-off opens never apply to Friday, Saturday, or a day that has passed. */
function requireOpenableDay(date: string): void {
  const weekday = weekdayIndex(date, HOST_TZ);
  if (weekday === 5 || weekday === 6) throw new HttpError(400, "Friday and Saturday stay closed.");
  if (date < formatIsoDate(new Date(), HOST_TZ)) throw new HttpError(400, "That date has passed.");
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 64) throw new HttpError(400, "Unknown item.");
  return value;
}

function activityLine(email: {
  kind: string;
  to: string;
  subject: string;
  status: string;
  createdAt: string;
  error?: string;
  text: string;
}) {
  const when = formatWhen(new Date(email.createdAt), HOST_TZ);
  let title = email.subject;
  if (email.kind === "guest-reminder") title = `Reminder sent to ${email.to}`;
  else if (email.kind === "guest-confirmation") title = `Confirmation sent to ${email.to}`;
  else if (email.kind === "guest-update") title = `Update sent to ${email.to}`;
  else if (email.kind === "guest-cancel") title = `Cancellation sent to ${email.to}`;
  else if (email.kind === "guest-unlock") title = `Unlock link sent to ${email.to}`;
  else if (email.kind.startsWith("internal")) title = `Internal notice · ${email.subject.replace(/^[^:]+:\s*/, "")}`;
  return {
    id: email.kind + email.createdAt + email.to,
    title,
    detail: email.subject,
    to: email.to,
    kind: email.kind,
    status: email.status,
    when,
    createdAt: email.createdAt,
    error: email.error,
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const now = new Date();
    const today = formatIsoDate(now, HOST_TZ);
    const [store, holidays] = await Promise.all([
      readStore(),
      holidayBlocks(now).catch(() => []),
    ]);
    const upcoming = store.bookings
      .filter((booking) => booking.status === "confirmed" && booking.endUtc >= now.toISOString())
      .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
      .slice(0, 30)
      .map((booking) => ({
        id: booking.id,
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
        company: booking.company,
        location: booking.location ?? "",
        mode: booking.mode,
        meeting: MEETINGS[booking.meetingSlug]?.name ?? booking.meetingSlug,
        meetingSlug: booking.meetingSlug,
        when: formatWhen(new Date(booking.startUtc), HOST_TZ),
        startUtc: booking.startUtc,
        reminderSendAt: booking.reminderSendAt,
        reminderSentAt: booking.reminderSentAt,
      }));

    const origin = appOrigin(request);

    return Response.json({
      ...availabilityOf(store.admin),
      today,
      holidays: holidays
        .filter((holiday) => holiday.date >= today)
        .slice(0, 24)
        .map((holiday) => ({ ...holiday, kindLabel: kindLabel(holiday.kind) })),
      bookings: upcoming,
      activity: store.emails
        .slice(-30)
        .reverse()
        .map((email) =>
          activityLine({
            kind: email.kind,
            to: email.to,
            subject: email.subject,
            status: email.status,
            createdAt: email.createdAt,
            error: email.error,
            text: email.text,
          }),
        ),
      links: [
        { slug: "intro", name: MEETINGS.intro.name, path: MEETINGS.intro.path, url: `${origin}${MEETINGS.intro.path}` },
        { slug: "45", name: MEETINGS["45"].name, path: MEETINGS["45"].path, url: `${origin}${MEETINGS["45"].path}` },
        {
          slug: "inperson",
          name: MEETINGS.inperson.name,
          path: MEETINGS.inperson.path,
          url: `${origin}${MEETINGS.inperson.path}`,
          gated: true,
          open: store.admin.inPersonOpen,
        },
      ],
      unlocks: store.admin.unlocks
        .filter((u) => isUnlockActive(u, now) && u.token)
        .map((u) => ({
          ...u,
          links: personalLinks(origin, u),
        })),
      calendarDryRun: await calendarIsDryRun(),
      emailDryRun: emailIsDryRun(),
      blob: blobConfigured(),
      cron: true,
    });
  } catch (error) {
    return jsonError(error);
  }
}

type PostBody = {
  usSlotsOpen?: boolean;
  inPersonOpen?: boolean;
  setDayBlocked?: { date: string; blocked: boolean };
  setDayOpen?: { date: string; open: boolean };
  setDayUsOpen?: { date: string; open: boolean };
  addTimeBlock?: { date: string; startMinute: number; endMinute: number };
  removeTimeBlock?: string;
  addRecurring?: {
    frequency: RecurringFrequency;
    anchorDate: string;
    startMinute?: number | null;
    endMinute?: number | null;
    until?: string | null;
  };
  removeRecurring?: string;
  addClosure?: unknown;
  updateClosure?: { id?: unknown };
  removeClosure?: string;
  addUnlock?: {
    email: string;
    name?: string;
    usSlots?: boolean;
    inPerson?: boolean;
    expiresInDays?: number;
  };
  revokeUnlock?: string;
  sendUnlockEmail?: string;
};

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await readJsonObject<PostBody>(request);

    if (typeof body.usSlotsOpen === "boolean") {
      const admin = await updateStore((data) => {
        data.admin.usSlotsOpen = body.usSlotsOpen as boolean;
        return data.admin;
      });
      return Response.json(availabilityOf(admin));
    }

    if (typeof body.inPersonOpen === "boolean") {
      const admin = await updateStore((data) => {
        data.admin.inPersonOpen = body.inPersonOpen as boolean;
        return data.admin;
      });
      return Response.json(availabilityOf(admin));
    }

    if (body.setDayBlocked) {
      const date = requireDate(body.setDayBlocked.date);
      const { blocked } = body.setDayBlocked;
      if (typeof blocked !== "boolean") throw new HttpError(400, "blocked must be true or false.");
      const admin = await updateStore((data) => {
        data.admin = withDayBlocked(data.admin, date, blocked);
        return data.admin;
      });
      return Response.json(availabilityOf(admin));
    }

    if (body.setDayOpen) {
      const date = requireDate(body.setDayOpen.date);
      const { open } = body.setDayOpen;
      if (typeof open !== "boolean") throw new HttpError(400, "open must be true or false.");
      if (open) requireOpenableDay(date);
      const admin = await updateStore((data) => {
        data.admin = withDayOpen(data.admin, date, open);
        return data.admin;
      });
      return Response.json(availabilityOf(admin));
    }

    if (body.setDayUsOpen) {
      const date = requireDate(body.setDayUsOpen.date);
      const { open } = body.setDayUsOpen;
      if (typeof open !== "boolean") throw new HttpError(400, "open must be true or false.");
      if (open) requireOpenableDay(date);
      const admin = await updateStore((data) => {
        data.admin = withDayUsOpen(data.admin, date, open);
        return data.admin;
      });
      return Response.json(availabilityOf(admin));
    }

    if (body.addTimeBlock) {
      const { startMinute, endMinute } = body.addTimeBlock;
      const date = requireDate(body.addTimeBlock.date);
      if (!isDayMinute(startMinute) || !isDayMinute(endMinute) || endMinute <= startMinute) {
        throw new HttpError(400, "Need a valid time range.");
      }
      const created = { id: newId(), date, startMinute, endMinute };
      const admin = await updateStore((data) => {
        data.admin.timeBlocks.push(created);
        return data.admin;
      });
      return Response.json({ ...availabilityOf(admin), created });
    }

    if (body.removeTimeBlock) {
      const admin = await updateStore((data) => {
        const id = requireId(body.removeTimeBlock);
        data.admin.timeBlocks = data.admin.timeBlocks.filter((block) => block.id !== id);
        return data.admin;
      });
      return Response.json(availabilityOf(admin));
    }

    if (body.addRecurring) {
      const { frequency } = body.addRecurring;
      if (!["weekly", "monthly", "yearly"].includes(frequency)) {
        throw new HttpError(400, "Frequency must be weekly, monthly, or yearly.");
      }
      const anchorDate = requireDate(body.addRecurring.anchorDate);
      const startMinute = body.addRecurring.startMinute ?? null;
      const endMinute = body.addRecurring.endMinute ?? null;
      const wholeDay = startMinute == null && endMinute == null;
      if (!wholeDay && (!isDayMinute(startMinute) || !isDayMinute(endMinute) || endMinute <= startMinute)) {
        throw new HttpError(400, "Need a valid time range, or leave both empty for the whole day.");
      }
      const until = body.addRecurring.until ? requireDate(body.addRecurring.until) : null;
      if (until && until < anchorDate) throw new HttpError(400, "The end date is before the first day.");
      const created = {
        id: newId(),
        frequency,
        anchorDate,
        startMinute: wholeDay ? null : startMinute,
        endMinute: wholeDay ? null : endMinute,
        until,
      };
      const admin = await updateStore((data) => {
        data.admin.recurringBlocks.push(created);
        return data.admin;
      });
      return Response.json({ ...availabilityOf(admin), created });
    }

    if (body.removeRecurring) {
      const admin = await updateStore((data) => {
        const id = requireId(body.removeRecurring);
        data.admin.recurringBlocks = data.admin.recurringBlocks.filter((block) => block.id !== id);
        return data.admin;
      });
      return Response.json(availabilityOf(admin));
    }
    if (body.addClosure) {
      const created = { id: newId(), ...requireClosure(body.addClosure) };
      const admin = await updateStore((data) => {
        data.admin.regularClosures.push(created);
        return data.admin;
      });
      return Response.json({ ...availabilityOf(admin), created });
    }

    if (body.updateClosure) {
      const id = requireId(body.updateClosure.id);
      const fields = requireClosure(body.updateClosure);
      const admin = await updateStore((data) => {
        const index = data.admin.regularClosures.findIndex((closure) => closure.id === id);
        if (index < 0) throw new HttpError(404, "That closure is gone.");
        data.admin.regularClosures[index] = { id, ...fields };
        return data.admin;
      });
      return Response.json(availabilityOf(admin));
    }

    if (body.removeClosure) {
      const id = requireId(body.removeClosure);
      const admin = await updateStore((data) => {
        data.admin.regularClosures = data.admin.regularClosures.filter((closure) => closure.id !== id);
        return data.admin;
      });
      return Response.json(availabilityOf(admin));
    }

    if (body.addUnlock) {
      const email = normalizeEmail(typeof body.addUnlock.email === "string" ? body.addUnlock.email : "");
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email.");
      const name = typeof body.addUnlock.name === "string" ? body.addUnlock.name.trim().slice(0, 100) : "";
      const usSlots = Boolean(body.addUnlock.usSlots);
      const inPerson = Boolean(body.addUnlock.inPerson);
      if (!usSlots && !inPerson) throw new HttpError(400, "Pick US evenings, in-person, or both.");
      let days = Number(body.addUnlock.expiresInDays ?? 14);
      if (!Number.isFinite(days) || days < 1) days = 14;
      if (days > 365) days = 365;
      const now = new Date();
      const id = newId();
      const unlock = {
        id,
        email,
        name,
        usSlots,
        inPerson,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
        revokedAt: null as string | null,
        token: issueUnlockToken(id),
      };
      await updateStore((data) => {
        data.admin.unlocks.push(unlock);
      });
      const origin = appOrigin(request);
      return Response.json({
        unlock: { ...unlock, links: personalLinks(origin, unlock) },
      });
    }

    if (body.revokeUnlock) {
      const id = requireId(body.revokeUnlock);
      await updateStore((data) => {
        const found = data.admin.unlocks.find((u) => u.id === id);
        if (found && !found.revokedAt) found.revokedAt = new Date().toISOString();
      });
      return Response.json({ ok: true });
    }


    if (body.sendUnlockEmail) {
      const id = requireId(body.sendUnlockEmail);
      const store = await readStore();
      const unlock = store.admin.unlocks.find((u) => u.id === id);
      if (!unlock || unlock.revokedAt) throw new HttpError(404, "That unlock is gone.");
      if (!unlock.token) throw new HttpError(400, "This unlock has no personal link. Create a new one.");
      if (!isUnlockActive(unlock)) throw new HttpError(409, "That unlock has expired.");
      const origin = appOrigin(request);
      const links = personalLinks(origin, unlock);
      const linkUrl = links[0]?.url || `${origin}/?k=${encodeURIComponent(unlock.token)}`;
      const message = guestUnlockNotice({
        name: unlock.name,
        usSlots: unlock.usSlots,
        inPerson: unlock.inPerson,
        linkUrl,
      });
      const result = await deliverEmail({
        kind: "guest-unlock",
        to: unlock.email,
        ...message,
      });
      return Response.json({ ok: true, dryRun: result.dryRun, to: unlock.email });
    }

    throw new HttpError(400, "Nothing to update.");
  } catch (error) {
    return jsonError(error);
  }
}
