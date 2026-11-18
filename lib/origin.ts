/**
 * Origin for OAuth redirects and links in emails. Production never trusts the request Host:
 * it uses APP_ORIGIN, else the Vercel production URL. Only local development reads the Host header.
 */
export function appOrigin(request?: Request): string {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (vercel) return `https://${vercel}`;
    // next build prerenders some route handlers with NODE_ENV=production before a deploy origin exists.
    if (process.env.NEXT_PHASE === "phase-production-build") return "http://127.0.0.1:43123";
    throw new Error("APP_ORIGIN must be set in production.");
  }
  const host = request?.headers.get("host");
  const hostname = host?.split(":")[0]?.toLowerCase();
  if (host && (hostname === "localhost" || hostname === "127.0.0.1")) return `http://${host}`;
  return "http://127.0.0.1:43123";
}

/** Same-site relative path for post-login redirects. Anything else falls back. */
export function safeRedirectPath(next: string | null | undefined, fallback = "/admin"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\r\n]/.test(next)) return fallback;
  try {
    const base = "http://same-site.invalid";
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
