import type { Metadata } from "next";
import { ownerName, siteName, siteOrigin, withOwner } from "./brand";

export { siteOrigin };

/** Bump when OG artwork changes so WhatsApp / iMessage drop the cached preview. */
export const OG_IMAGE_VERSION = "photo-2";

export type SharePage = {
  title: string;
  description: string;
  path: string;
  /** Absolute or path for og:image — Next file convention fills this when omitted. */
  imageAlt: string;
};

export function shareMetadata(page: SharePage): Metadata {
  const origin = siteOrigin();
  const url = `${origin}${page.path === "/" ? "" : page.path}`;
  const imagePath = page.path === "/" ? "/opengraph-image" : `${page.path}/opengraph-image`;
  const imageUrl = `${origin}${imagePath}?v=${OG_IMAGE_VERSION}`;
  return {
    title: page.title,
    description: page.description,
    robots: { index: false, follow: false, nocache: true },
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: siteName(),
      title: page.title,
      description: page.description,
      locale: "en_US",
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: page.imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [imageUrl],
    },
  };
}

export function homeShare(): SharePage {
  return {
    title: withOwner("Book time"),
    description: "Let's talk. Pick a meeting type and grab a time that works for you.",
    path: "/",
    imageAlt: withOwner("Book time"),
  };
}

export function introShare(): SharePage {
  return {
    title: withOwner("Intro call"),
    description: `Book a 30-minute intro call with ${ownerName()}. Pick a time that works for you.`,
    path: "/intro",
    imageAlt: withOwner("Intro call"),
  };
}

export function fortyFiveShare(): SharePage {
  return {
    title: withOwner("45 Minute Meeting"),
    description: `Book a 45-minute working session with ${ownerName()}.`,
    path: "/45-minute",
    imageAlt: withOwner("45 Minute Meeting"),
  };
}

export function inPersonShare(): SharePage {
  return {
    title: withOwner("In-person meeting"),
    description: `In-person meetings with ${ownerName()}.`,
    path: "/in-person",
    imageAlt: withOwner("In-person meeting"),
  };
}
