import { NextResponse } from "next/server";
import { newOAuthState, signOAuthState } from "@/lib/google-oauth";
import {
  ADMIN_OAUTH_NONCE_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  adminGoogleAuthUrl,
  newOAuthNonce,
} from "@/lib/admin-google-oauth";
import { appOrigin } from "@/lib/origin";

export async function GET(request: Request) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/admin?google=not_configured", appOrigin(request)), 302);
  }
  const state = newOAuthState();
  const nonce = newOAuthNonce();
  const response = NextResponse.redirect(adminGoogleAuthUrl(request, state, nonce), 302);
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  };
  response.cookies.set(ADMIN_OAUTH_STATE_COOKIE, signOAuthState(state), cookie);
  response.cookies.set(ADMIN_OAUTH_NONCE_COOKIE, nonce, cookie);
  return response;
}
