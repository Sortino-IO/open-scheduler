import type { MetadataRoute } from "next";
import { publicManifest } from "@/lib/pwa";

export default function manifest(): MetadataRoute.Manifest {
  return publicManifest();
}
