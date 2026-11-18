import { NextResponse } from "next/server";
import {
  exchangeGoogleCode,
  fetchGoogleEmail,
  listGoogleCalendars,
  STATE_COOKIE,
  upsertConnectedAccount,
  verifyOAuthStateCookie,
} from "@/lib/google-oauth";
import { handleAdminGoogleCallback, isAdminGoogleCallback } from "@/lib/admin-google-callback";
import { appOrigin } from "@/lib/origin";
import { clearCalendarDisconnected } from "@/lib/calendar-health";

function clearState(res: NextResponse) {
  res.cookies.set(STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

function adminRedirect(request: Request, params: Record<string, string>) {
  const target = new URL("/admin", appOrigin(request));
  target.searchParams.set("tab", "overview");
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return clearState(NextResponse.redirect(target.toString(), 302));
}

function htmlPage(title: string, body: string, status = 200) {
  const res = new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
    .ok{color:#166534}.bad{color:#991b1b} a{color:#5856d6}</style></head>
    <body><h1 class="${status >= 400 ? "bad" : "ok"}">${title}</h1>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
  return clearState(res);
}

function isUnapproved(message: string) {
  return /access_denied|403|not.*registered|test user|has not completed|verification/i.test(message);
}

export async function GET(request: Request) {
  if (isAdminGoogleCallback(request)) return handleAdminGoogleCallback(request);
  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) {
    return adminRedirect(request, {
      connectError: err === "access_denied" || isUnapproved(err) ? "unapproved" : "failed",
    });
  }
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${STATE_COOKIE}=`));
  const stateCookie = match ? decodeURIComponent(match.slice(STATE_COOKIE.length + 1)) : undefined;
  if (!code || !verifyOAuthStateCookie(stateCookie, state)) {
    return adminRedirect(request, { connectError: "failed" });
  }

  try {
    const tok = await exchangeGoogleCode(request, code);
    const scope = tok.scope || "";
    if (!tok.refresh_token) {
      return htmlPage(
        "Couldn't finish connecting",
        "<p>Google did not return a lasting connection. Remove this app under your Google Account permissions, then try Connect again.</p><p><a href=\"/admin?tab=overview\">Back to admin</a></p>",
        400,
      );
    }
    if (!scope.includes("calendar")) {
      return adminRedirect(request, { connectError: "failed" });
    }
    if (!tok.access_token) {
      return adminRedirect(request, { connectError: "failed" });
    }
    const email = await fetchGoogleEmail(tok.access_token);
    const calendars = await listGoogleCalendars(tok.access_token);
    await upsertConnectedAccount({
      email,
      refresh_token: tok.refresh_token,
      scope,
      calendars: calendars.length
        ? calendars
        : [{ id: email, summary: "Primary", primary: true, checkConflicts: true }],
    });
    await clearCalendarDisconnected();
    return adminRedirect(request, { connected: "1" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return adminRedirect(request, {
      connectError: isUnapproved(message) ? "unapproved" : "failed",
    });
  }
}
