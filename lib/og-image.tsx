import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { organizationName, ownerInitials, ownerName, siteHost, siteName, withOwner } from "./brand";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export type OgTheme = {
  eyebrow: string;
  title: string;
  subtitle: string;
  accentFrom: string;
  accentTo: string;
  pill: string;
  pillText: string;
};

let photoSrcPromise: Promise<string> | null = null;

async function ownerPhotoSrc(): Promise<string> {
  if (!photoSrcPromise) {
    photoSrcPromise = readFile(path.join(process.cwd(), "public", "avatar.jpg")).then(
      (buf) => `data:image/jpeg;base64,${buf.toString("base64")}`,
    );
  }
  return photoSrcPromise;
}

export async function renderOgImage(theme: OgTheme) {
  const photoSrc = await ownerPhotoSrc();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px",
          background: `linear-gradient(135deg, ${theme.accentFrom} 0%, ${theme.accentTo} 55%, #1d1d1f 120%)`,
          color: "white",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -80,
            top: -60,
            width: 420,
            height: 420,
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 40,
            bottom: -120,
            width: 320,
            height: 320,
            borderRadius: 999,
            background: "rgba(255,255,255,0.06)",
            display: "flex",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                background: "rgba(255,255,255,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              {ownerInitials()}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 22, fontWeight: 600, opacity: 0.95 }}>{ownerName()}</div>
              <div style={{ fontSize: 16, opacity: 0.72 }}>{organizationName() ? `${organizationName()} · Schedule` : siteName()}</div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 168,
              height: 168,
              borderRadius: 999,
              background: "rgba(255,255,255,0.22)",
              boxShadow: "0 18px 40px rgba(15,23,42,0.28)",
              padding: 7,
            }}
          >
            <img
              src={photoSrc}
              width={154}
              height={154}
              alt=""
              style={{
                width: 154,
                height: 154,
                borderRadius: 999,
                objectFit: "cover",
                border: "4px solid rgba(255,255,255,0.92)",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 860, marginTop: 8 }}>
          <div
            style={{
              alignSelf: "flex-start",
              background: theme.pill,
              color: theme.pillText,
              padding: "10px 18px",
              borderRadius: 999,
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {theme.eyebrow}
          </div>
          <div style={{ fontSize: 68, fontWeight: 720, letterSpacing: -1.5, lineHeight: 1.05 }}>{theme.title}</div>
          <div style={{ fontSize: 26, opacity: 0.9, lineHeight: 1.35 }}>{theme.subtitle}</div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", opacity: 0.88 }}>
          <div style={{ fontSize: 20 }}>{siteHost()}</div>
          <div style={{ fontSize: 18 }}>Pick a time · Google Calendar</div>
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}

export function ogThemes() {
  return {
    home: {
      eyebrow: "Scheduling",
      title: withOwner("Book time"),
      subtitle: "Intro calls and meetings — pick a time that works for you.",
      accentFrom: "#5856d6",
      accentTo: "#8b5cf6",
      pill: "rgba(255,255,255,0.2)",
      pillText: "#ffffff",
    },
    intro: {
      eyebrow: "30 minutes",
      title: "Intro call",
      subtitle: `A quick first conversation with ${ownerName()}.`,
      accentFrom: "#2563eb",
      accentTo: "#5856d6",
      pill: "#dbeafe",
      pillText: "#1e40af",
    },
    fortyFive: {
      eyebrow: "45 minutes",
      title: "45 Minute Meeting",
      subtitle: `A focused working session with ${ownerName()}.`,
      accentFrom: "#7c3aed",
      accentTo: "#5856d6",
      pill: "#ede9fe",
      pillText: "#5b21b6",
    },
    inperson: {
      eyebrow: "In person · 60 minutes",
      title: "In-person meeting",
      subtitle: `In-person meetings with ${ownerName()}.`,
      accentFrom: "#ea580c",
      accentTo: "#c2410c",
      pill: "#ffedd5",
      pillText: "#9a3412",
    },
  } as const;
}
