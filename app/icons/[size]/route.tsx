import { parseIconSize, pwaIcon } from "@/lib/pwa-icon";

export async function GET(_request: Request, context: { params: Promise<{ size: string }> }) {
  const { size } = await context.params;
  const px = parseIconSize(size, [192, 512]);
  if (!px) return new Response("Not found", { status: 404 });
  return pwaIcon(px, "ES", "#5856d6", "#7c5cff");
}
