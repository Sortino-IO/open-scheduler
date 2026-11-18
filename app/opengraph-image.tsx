import { withOwner } from "@/lib/brand";
import { OG_CONTENT_TYPE, OG_SIZE, ogThemes, renderOgImage } from "@/lib/og-image";

export const alt = withOwner("Book time");
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgImage(ogThemes().home);
}
