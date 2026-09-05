import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

export type ProductSceneProps = {
  readonly kicker: string;
  readonly titleLines: readonly string[];
  readonly description: string;
  readonly metric: string;
  readonly metricLabel: string;
  readonly chip: string;
  readonly image: string;
  readonly imageAlt: string;
  readonly accent: string;
  readonly sceneNumber: string;
};

const colors = {
  paper: "#f4f1ea",
  ink: "#1b1d24",
  cobalt: "#6878ff",
  chartreuse: "#d9f36c",
  muted: "#aaa8a4",
};

export const ProductScene: React.FC<ProductSceneProps> = ({
  kicker,
  titleLines,
  description,
  metric,
  metricLabel,
  chip,
  image,
  imageAlt,
  accent,
  sceneNumber,
}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const copyY = interpolate(frame, [0, 22], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const screenProgress = interpolate(frame, [8, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const screenX = interpolate(screenProgress, [0, 1], [42, 0]);
  const screenScale = interpolate(screenProgress, [0, 1], [0.965, 1]);
  const scanX = interpolate(frame, [18, 88], [-16, 116]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#111318",
        color: colors.paper,
        fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif',
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(90deg, rgba(244,241,234,0.045) 1px, transparent 1px), linear-gradient(rgba(244,241,234,0.035) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
          opacity: 0.22,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 560,
          height: 560,
          right: -190,
          top: -220,
          border: `1px solid ${accent}`,
          borderRadius: "50%",
          opacity: 0.25,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 340,
          height: 340,
          right: -82,
          top: -110,
          border: `1px solid ${colors.cobalt}`,
          borderRadius: "50%",
          opacity: 0.22,
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "36px 48px 0",
          opacity: enter,
        }}
      >
        <div
          style={{
            color: colors.muted,
            fontFamily: '"Cascadia Mono", Consolas, monospace',
            fontSize: 13,
            letterSpacing: "0.14em",
          }}
        >
          {kicker}
        </div>
        <div
          style={{
            border: `1px solid ${colors.chartreuse}`,
            color: colors.chartreuse,
            padding: "7px 11px 6px",
            borderRadius: 999,
            fontFamily: '"Cascadia Mono", Consolas, monospace',
            fontSize: 11,
            letterSpacing: "0.1em",
          }}
        >
          {chip}
        </div>
      </div>

      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "0.82fr 1.18fr",
          gap: 40,
          alignItems: "center",
          padding: "42px 48px 44px",
          flex: 1,
        }}
      >
        <div
          style={{
            alignSelf: "center",
            opacity: enter,
            transform: `translateY(${copyY}px)`,
          }}
        >
          <div
            style={{
              color: colors.cobalt,
              fontFamily: '"Cascadia Mono", Consolas, monospace',
              fontSize: 12,
              letterSpacing: "0.18em",
              marginBottom: 17,
            }}
          >
            CHATDECK · V1.17.0
          </div>
          <h1
            style={{
              color: colors.paper,
              fontSize: 55,
              lineHeight: 0.98,
              letterSpacing: "-0.055em",
              fontWeight: 800,
              margin: 0,
            }}
          >
            {titleLines.map((line) => (
              <span key={line} style={{ display: "block" }}>
                {line}
              </span>
            ))}
          </h1>
          <p
            style={{
              color: colors.muted,
              fontSize: 18,
              lineHeight: 1.45,
              maxWidth: 410,
              margin: "23px 0 28px",
            }}
          >
            {description}
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              borderTop: "1px solid rgba(244,241,234,0.22)",
              paddingTop: 19,
              maxWidth: 430,
            }}
          >
            <span
              style={{
                color: colors.paper,
                fontFamily: '"Cascadia Mono", Consolas, monospace',
                fontSize: 30,
                fontWeight: 700,
              }}
            >
              {metric}
            </span>
            <span
              style={{
                color: colors.muted,
                fontFamily: '"Cascadia Mono", Consolas, monospace',
                fontSize: 12,
                lineHeight: 1.4,
                letterSpacing: "0.03em",
              }}
            >
              {metricLabel}
            </span>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            opacity: screenProgress,
            transform: `translateX(${screenX}px) scale(${screenScale})`,
            transformOrigin: "center center",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -15,
              left: "12%",
              right: "12%",
              height: 2,
              backgroundColor: accent,
              opacity: 0.85,
              transform: `translateX(${scanX}px)`,
            }}
          />
          <div
            style={{
              padding: 8,
              backgroundColor: "#22252d",
              border: "1px solid rgba(244,241,234,0.28)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.36)",
              borderRadius: 17,
            }}
          >
            <Img
              src={staticFile(image)}
              alt={imageAlt}
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                borderRadius: 10,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: colors.muted,
              fontFamily: '"Cascadia Mono", Consolas, monospace',
              fontSize: 11,
              letterSpacing: "0.08em",
              paddingTop: 13,
            }}
          >
            <span>LOCAL-ONLY DEMO</span>
            <span>{sceneNumber} / 03</span>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 48,
          bottom: 18,
          color: "rgba(244,241,234,0.18)",
          fontFamily: '"Cascadia Mono", Consolas, monospace',
          fontSize: 11,
          letterSpacing: "0.16em",
        }}
      >
        ISOLATED SYNTHETIC FIXTURE · NO ACCOUNT DATA
      </div>
    </AbsoluteFill>
  );
};
