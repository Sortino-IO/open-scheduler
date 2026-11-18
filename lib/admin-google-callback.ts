import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminCookieOptions, adminSecret, signAdminCookie } from "./admin-auth";
import { verifyOAuthStateCookie } from "./google-oauth";
import {
  ADMIN_OAUTH_NONCE_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  adminEmailAllowed,
  exchangeAdminGoogleCode,
  readAdminStateCookie,
  readCookie,
} from "./admin-google-oauth";
import { adminSignInReturnUrl } from "./pwa";
import { appOrigin } from "./origin";

function back(request: Request, query = "") {
  const res = NextResponse.redirect(adminSignInReturnUrl(appOrigin(request), query), 302);
  res.cookies.set(ADMIN_OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(ADMIN_OAUTH_NONCE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

/** True when this callback belongs to an admin Google sign-in (admin state cookie matches). */
export function isAdminGoogleCallback(request: Request): boolean {
  const state = new URL(request.url).searchParams.get("state") || "";
  return verifyOAuthStateCookie(readAdminStateCookie(request), state);
}

export async function handleAdminGoogleCallback(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return back(request, "?google=denied");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const nonce = readCookie(request, ADMIN_OAUTH_NONCE_COOKIE);
  if (!code || !nonce || !verifyOAuthStateCookie(readAdminStateCookie(request), state)) return back(request, "?google=expired");
  if (!adminSecret()) return back(request, "?google=not_configured");
  try {
    const { email, emailVerified } = await exchangeAdminGoogleCode(request, code, nonce);
    if (!adminEmailAllowed(email, emailVerified)) return back(request, "?google=not_allowed");
    const res = back(request);
    res.cookies.set(ADMIN_COOKIE, signAdminCookie(), adminCookieOptions);
    return res;
  } catch (error) {
    console.error("admin google login failed", error instanceof Error ? error.message : "unknown error");
    return back(request, "?google=failed");
  }
}
