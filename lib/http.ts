import { unstable_rethrow } from "next/navigation";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
}

/** The request body as a JSON object, or a 400 when it is missing, malformed, or not an object. */
export async function readJsonObject<T>(request: Request): Promise<T> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Send a JSON object.");
  return body as T;
}
