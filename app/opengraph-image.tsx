import { ImageResponse } from "next/og";

export const alt = "SportPad | sports community coins and Fan Token reward accounting";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "58px 66px",
          color: "#f6fff2",
          background: "linear-gradient(135deg, #071008 0%, #0d1b12 58%, #071008 100%)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 58,
                height: 58,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 18,
                color: "#071008",
                background: "#9cff57",
                fontSize: 30,
                fontWeight: 900,
              }}
            >
              S
            </div>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 900, letterSpacing: -1 }}>
              SPORT<span style={{ color: "#9cff57" }}>PAD</span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "11px 18px",
              border: "1px solid rgba(156,255,87,0.28)",
              borderRadius: 999,
              color: "#b9ff8b",
              background: "rgba(156,255,87,0.08)",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            SOLANA · PRIVATE DRAFT BUILDER
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 990 }}>
          <div style={{ display: "flex", color: "#9cff57", fontSize: 20, fontWeight: 800, letterSpacing: 3 }}>
            BUILT FOR THE BEAUTIFUL GAME
          </div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 72, lineHeight: 1.02, fontWeight: 900, letterSpacing: -4 }}>
            Sports community coins with transparent reward accounting.
          </div>
          <div style={{ display: "flex", marginTop: 26, color: "rgba(246,255,242,0.66)", fontSize: 25, lineHeight: 1.35 }}>
            Explore how creator-fee value could fund official Fan Token rewards and SPORTPAD buyback + burn.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 24,
            borderTop: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(246,255,242,0.5)",
            fontSize: 18,
          }}
        >
          <span>Creator-made community tokens · Official Fan Token rewards</span>
          <span style={{ color: "#f6fff2", fontWeight: 700 }}>sportpad.fun</span>
        </div>
      </div>
    ),
    size,
  );
}
