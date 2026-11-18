import { jsonError } from "@/lib/http";
import { appOrigin } from "@/lib/origin";
import { sendDueReminders } from "@/lib/scheduling";
import { safeEqual } from "@/lib/secret";

export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (process.env.NODE_ENV === "production") {
      const auth = request.headers.get("authorization") || "";
      if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    const result = await sendDueReminders(appOrigin(request));
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
