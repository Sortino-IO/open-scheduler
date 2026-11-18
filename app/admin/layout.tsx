import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { siteShortName } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Schedule admin",
  robots: { index: false, follow: false },
  manifest: "/admin/manifest.webmanifest",
  applicationName: `${siteShortName()} Admin`,
  appleWebApp: {
    capable: true,
    title: `${siteShortName()} Admin`,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/admin/icons/192", sizes: "192x192", type: "image/png" },
      { url: "/admin/icons/512", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/admin/icons/180", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#312e81",
  width: "device-width",
  initialScale: 1,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
