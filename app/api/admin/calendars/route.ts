import { isAdmin } from "@/lib/admin-auth";
import { accountGrantStatus, calendarIsDryRun } from "@/lib/calendar";
import { clearCalendarDisconnected, reportCalendarDisconnected } from "@/lib/calendar-health";
import {
  disconnectAccount,
  publicConnectionsView,
  readCalendarConnections,
  updateCalendarPrefs,
} from "@/lib/google-oauth";
import { HttpError, jsonError } from "@/lib/http";

async function requireAdmin() {
  if (!(await isAdmin())) throw new HttpError(401, "Sign in required.");
}

export async function GET() {
  try {
    await requireAdmin();
    const conn = await readCalendarConnections();
    const view = publicConnectionsView(conn);
    // Admin-only, through the cached token path: a saved account is not proof Google still accepts it.
    const statuses = (await calendarIsDryRun())
      ? []
      : await Promise.all(conn.accounts.map((account) => accountGrantStatus(account.refresh_token)));
    if (statuses.includes("disconnected")) await reportCalendarDisconnected("grant_rejected");
    else if (statuses.length && statuses.every((status) => status === "ok")) await clearCalendarDisconnected();
    return Response.json({
      ...view,
      accounts: view.accounts.map((account, index) => ({ ...account, status: statuses[index] })),
      connectUrl: "/api/oauth/google/start",
    });
  } catch (error) {
    return jsonError(error);
  }
}

type Body = {
  disconnectAccountId?: string;
  setCheck?: { accountId: string; calendarId: string; checkConflicts: boolean };
  setBookingTarget?: { accountId: string; calendarId: string };
};

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as Body;

    if (body.disconnectAccountId) {
      const conn = await disconnectAccount(body.disconnectAccountId);
      return Response.json(publicConnectionsView(conn));
    }

    if (body.setCheck) {
      const conn = await updateCalendarPrefs({
        accountId: body.setCheck.accountId,
        calendarId: body.setCheck.calendarId,
        checkConflicts: body.setCheck.checkConflicts,
      });
      return Response.json(publicConnectionsView(conn));
    }

    if (body.setBookingTarget) {
      const conn = await updateCalendarPrefs({
        accountId: body.setBookingTarget.accountId,
        calendarId: body.setBookingTarget.calendarId,
        setBookingTarget: true,
      });
      return Response.json(publicConnectionsView(conn));
    }

    throw new HttpError(400, "Nothing to update.");
  } catch (error) {
    return jsonError(error);
  }
}
