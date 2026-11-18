import { adminManifest } from "@/lib/pwa";

export function GET() {
  return Response.json(adminManifest(), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
