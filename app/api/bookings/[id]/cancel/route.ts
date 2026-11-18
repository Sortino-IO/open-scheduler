import { jsonError } from "@/lib/http";
import { appOrigin } from "@/lib/origin";
import { cancelBooking } from "@/lib/scheduling";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = body.token || new URL(request.url).searchParams.get("t") || "";
    const booking = await cancelBooking(id, token, appOrigin(request));
    return Response.json(booking);
  } catch (error) {
    return jsonError(error);
  }
}
