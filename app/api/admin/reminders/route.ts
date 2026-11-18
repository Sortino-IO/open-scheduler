import { isAdmin } from "@/lib/admin-auth";
import { HttpError, jsonError } from "@/lib/http";
import { appOrigin } from "@/lib/origin";
import { sendDueReminders } from "@/lib/scheduling";

export async function POST(request: Request) {
  try {
    if (!(await isAdmin())) throw new HttpError(401, "Sign in required.");
    const result = await sendDueReminders(appOrigin(request));
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
