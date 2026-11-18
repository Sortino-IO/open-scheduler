import { ImageResponse } from "next/og";

export function pwaIcon(size: number, mark: string, from: string, to: string) {
  const font = Math.round(size * (mark.length > 1 ? 0.34 : 0.46));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(145deg, ${from} 0%, ${to} 100%)`,
          color: "white",
          fontSize: font,
          fontWeight: 700,
          letterSpacing: mark.length > 1 ? -2 : -1,
        }}
      >
        {mark}
      </div>
    ),
    { width: size, height: size },
  );
}

export function parseIconSize(raw: string, allowed: number[]): number | null {
  const size = Number(raw);
  return allowed.includes(size) ? size : null;
}
