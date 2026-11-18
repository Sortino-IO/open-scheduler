import { handleAdminGoogleCallback } from "@/lib/admin-google-callback";

export async function GET(request: Request) {
  return handleAdminGoogleCallback(request);
}
