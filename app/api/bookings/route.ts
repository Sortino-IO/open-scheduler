import { jsonError, readJsonObject } from "@/lib/http";
import { appOrigin } from "@/lib/origin";
import { book, type BookingRequest } from "@/lib/scheduling";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject<BookingRequest>(request);
    const booking = await book(body, appOrigin(request));
    return Response.json(booking);
  } catch (error) {
    return jsonError(error);
  }
}
