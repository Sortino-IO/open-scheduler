import { ownerName, siteOrigin } from "./brand";

/** Public pages a visitor may forward. Query strings are never part of these URLs. */
const PUBLIC_PATHS = new Set(["/", "/intro", "/45-minute", "/in-person"]);

/**
 * Canonical link for a meeting page. Strips unlock keys, booking tokens,
 * reschedule params, and any other query or hash.
 */
export function canonicalPublicUrl(input: string): string {
  let pathname = input.trim();
  if (pathname.startsWith("http://") || pathname.startsWith("https://")) {
    pathname = new URL(pathname).pathname;
  }
  pathname = pathname.split("?")[0]?.split("#")[0] ?? "";
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (!PUBLIC_PATHS.has(pathname)) {
    throw new Error("Refusing to share a non-public URL");
  }
  return `${siteOrigin()}${pathname === "/" ? "" : pathname}`;
}

/** Friend-facing share payload. The meeting name is the existing label; the URL is public only. */
export function publicSharePayload(name: string, path: string): { title: string; text: string; url: string } {
  const url = canonicalPublicUrl(path);
  const title = `${name} with ${ownerName()}`;
  return { title, text: title, url };
}

export function isShareCancellation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error as { name?: string }).name === "AbortError";
}
