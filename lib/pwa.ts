import { ownerName, siteName, siteShortName } from "./brand";

export type WebManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: "any" }[];
};

/** Home-screen shortcut for visitors. Opens the public scheduling page. */
export function publicManifest(): WebManifest {
  return {
    id: "/",
    name: siteName(),
    short_name: siteShortName(),
    description: `Book a meeting with ${ownerName()}.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f5f2",
    theme_color: "#5856d6",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}

/** Separate home-screen identity. Opens /admin and stays in the admin scope. */
export function adminManifest(): WebManifest {
  return {
    id: "/admin",
    name: `${siteShortName()} Admin`,
    short_name: "Admin",
    description: `Manage ${ownerName()}’s scheduling page.`,
    start_url: "/admin",
    scope: "/admin",
    display: "standalone",
    background_color: "#f3f0ff",
    theme_color: "#312e81",
    icons: [
      { src: "/admin/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/admin/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/admin/icons/180", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}

export const ADMIN_SIGN_IN_RETURN = "/admin";

export function adminSignInReturnUrl(origin: string, query = ""): string {
  return `${origin}${ADMIN_SIGN_IN_RETURN}${query}`;
}
