import { jsonError } from "@/lib/http";
import { getPublicBooking } from "@/lib/scheduling";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const token = new URL(request.url).searchParams.get("t") ?? "";
    const booking = await getPublicBooking(id, token);
    return Response.json(booking);
  } catch (error) {
    return jsonError(error);
  }
}
