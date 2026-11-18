import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #5856d6 0%, #8b5cf6 100%)",
          color: "white",
          fontSize: 78,
          fontWeight: 720,
          letterSpacing: -2,
          borderRadius: 40,
        }}
      >
        ES
      </div>
    ),
    { ...size },
  );
}
