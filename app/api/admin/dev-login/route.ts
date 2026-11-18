import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminCookieOptions, adminSecret, signAdminCookie } from "@/lib/admin-auth";
import { safeRedirectPath } from "@/lib/origin";

/** Local screenshot / QA helper. Disabled in production. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || !adminSecret()) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const url = new URL(request.url);
  const next = safeRedirectPath(url.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.set(ADMIN_COOKIE, signAdminCookie(), adminCookieOptions);
  return response;
}
