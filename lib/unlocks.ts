import { randomBytes } from "node:crypto";
import { safeEqual } from "./secret";
import type { Booking } from "./store";

export type PersonUnlock = {
  id: string;
  email: string;
  name: string;
  usSlots: boolean;
  inPerson: boolean;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Full personal token `id.secret` — private blob only; needed to rebuild copy links. */
  token: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function issueUnlockToken(unlockId: string): string {
  const secret = randomBytes(24).toString("base64url");
  return `${unlockId}.${secret}`;
}

export function parseUnlockId(token: string | null | undefined): string | null {
  if (!token) return null;
  const [id, secret] = token.split(".");
  if (!id || !secret || id.length < 8 || secret.length < 16) return null;
  return id;
}

export function tokenMatches(unlock: PersonUnlock, token: string | null | undefined): boolean {
  if (!token || !unlock.token) return false;
  return safeEqual(unlock.token, token);
}

export function isUnlockActive(unlock: PersonUnlock, now = new Date()): boolean {
  if (unlock.revokedAt) return false;
  if (!unlock.usSlots && !unlock.inPerson) return false;
  return new Date(unlock.expiresAt).getTime() > now.getTime();
}

export function findUnlockById(unlocks: PersonUnlock[], id: string, now = new Date()): PersonUnlock | null {
  const found = unlocks.find((u) => u.id === id);
  if (!found || !isUnlockActive(found, now)) return null;
  return found;
}

export function findUnlockByEmail(unlocks: PersonUnlock[], email: string, now = new Date()): PersonUnlock | null {
  const needle = normalizeEmail(email);
  const matches = unlocks.filter((u) => normalizeEmail(u.email) === needle && isUnlockActive(u, now));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => {
    const score = (u: PersonUnlock) => (u.usSlots ? 1 : 0) + (u.inPerson ? 1 : 0);
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime();
  })[0];
}

export type AccessFlags = {
  usSlotsOpen: boolean;
  inPersonOpen: boolean;
  unlock: PersonUnlock | null;
};

export function resolveAccess(input: {
  admin: { usSlotsOpen: boolean; inPersonOpen: boolean };
  unlocks: PersonUnlock[];
  unlockToken?: string | null;
  booking?: Pick<Booking, "email" | "token" | "id"> | null;
  bookingToken?: string | null;
  now?: Date;
}): AccessFlags {
  const now = input.now ?? new Date();
  let unlock: PersonUnlock | null = null;

  const unlockId = parseUnlockId(input.unlockToken);
  if (unlockId) {
    const found = findUnlockById(input.unlocks, unlockId, now);
    if (found && tokenMatches(found, input.unlockToken)) unlock = found;
  }

  if (!unlock && input.booking && input.bookingToken && safeEqual(input.booking.token, input.bookingToken)) {
    unlock = findUnlockByEmail(input.unlocks, input.booking.email, now);
  }

  return {
    usSlotsOpen: input.admin.usSlotsOpen || Boolean(unlock?.usSlots),
    inPersonOpen: input.admin.inPersonOpen || Boolean(unlock?.inPerson),
    unlock,
  };
}

export function personalLinks(origin: string, unlock: PersonUnlock): { label: string; url: string }[] {
  const k = unlock.token;
  const links: { label: string; url: string }[] = [{ label: "Personal home", url: `${origin}/?k=${encodeURIComponent(k)}` }];
  if (unlock.usSlots) {
    links.push(
      { label: "Intro call", url: `${origin}/intro?k=${encodeURIComponent(k)}` },
      { label: "45 Minute Meeting", url: `${origin}/45-minute?k=${encodeURIComponent(k)}` },
    );
  }
  if (unlock.inPerson) {
    links.push({ label: "In-person meeting", url: `${origin}/in-person?k=${encodeURIComponent(k)}` });
  }
  return links;
}

/** @deprecated kept for any stray imports */
export function signUnlockToken(unlockId: string): string {
  return issueUnlockToken(unlockId);
}
