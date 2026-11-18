import type { Metadata } from "next";
import { ownerName, siteName, siteOrigin } from "@/lib/brand";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: siteName(),
    template: `%s · ${ownerName()}`,
  },
  description: `Book a meeting with ${ownerName()}.`,
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    type: "website",
    siteName: siteName(),
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
  icons: {
    icon: [{ url: "/icon", type: "image/png" }, { url: "/favicon.ico", type: "image/png" }],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#f4f5f7] text-[#0e1b2c]">{children}</body>
    </html>
  );
}
