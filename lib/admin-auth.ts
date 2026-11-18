import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { safeEqual } from "./secret";

export { safeEqual };

export const ADMIN_COOKIE = "schedule_admin";
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export function adminSecret(): string | null {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  if (process.env.NODE_ENV !== "production") return "dev-admin-secret";
  return null;
}

export function signAdminCookie(now = Date.now()): string {
  const secret = adminSecret();
  if (!secret) throw new Error("Admin secret is not configured");
  const exp = String(now + FOURTEEN_DAYS_MS);
  const mac = createHmac("sha256", secret).update(exp).digest("base64url");
  return `${exp}.${mac}`;
}

export function verifyAdminCookie(value: string | undefined, now = Date.now()): boolean {
  const secret = adminSecret();
  if (!secret || !value) return false;
  const [exp, mac] = value.split(".");
  if (!exp || !mac) return false;
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < now) return false;
  const expected = createHmac("sha256", secret).update(exp).digest("base64url");
  return safeEqual(mac, expected);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifyAdminCookie(jar.get(ADMIN_COOKIE)?.value);
}

export const adminCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: FOURTEEN_DAYS_MS / 1000,
};
