import { jsonError } from "@/lib/http";
import { getMonthSlots } from "@/lib/scheduling";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const unlockToken = url.searchParams.get("k");
    const rescheduleId = url.searchParams.get("reschedule");
    const rescheduleToken = url.searchParams.get("t");
    const payload = await getMonthSlots({
      meetingSlug: url.searchParams.get("meeting") ?? "",
      timeZone: url.searchParams.get("timeZone") ?? "UTC",
      month: url.searchParams.get("month") ?? "",
      unlockToken,
      rescheduleId,
      rescheduleToken,
    });
    // Availability changes with every admin toggle and booking, so no shared or browser cache may hold it.
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
