import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { googleAuthUrl, newOAuthState, signOAuthState, STATE_COOKIE } from "@/lib/google-oauth";


function htmlPage(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
    code{background:#f4f4f5;padding:.1rem .35rem;border-radius:.25rem}</style></head>
    <body><h1>${title}</h1>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return htmlPage("Not ready", "<p>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> first.</p>", 503);
  }
  if (!(await isAdmin())) {
    return htmlPage("Admin only", "<p>Sign in at <code>/admin</code> first.</p>", 401);
  }

  const state = newOAuthState();
  const response = NextResponse.redirect(googleAuthUrl(request, state), 302);
  response.cookies.set(STATE_COOKIE, signOAuthState(state), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 20,
  });
  return response;
}
