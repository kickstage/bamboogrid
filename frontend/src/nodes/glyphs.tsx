// Canvas glyphs derived from the provided SVG library
// (src/symbols/symbols/pandapower/*.svg), trimmed of the library's outer frame
// and caption so they read cleanly as in-canvas symbols. They use `currentColor`
// so they follow the theme (and a stroke override when the node is selected).
// Shared by the node components and the palette.

type GlyphProps = { size?: number; stroke?: string };

// pandapower/gen.svg — circle with "G".
export function GeneratorGlyph({ size = 52, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="30 12 60 60"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      <circle cx={60} cy={42} r={24} fill="none" stroke={stroke} strokeWidth={3} />
      <text
        x={60}
        y={50}
        textAnchor="middle"
        fontSize={24}
        fontFamily="Arial, sans-serif"
        fontWeight={600}
        fill={stroke}
      >
        G
      </text>
    </svg>
  );
}

// pandapower/load.svg — vertical stub into a downward triangle.
export function LoadGlyph({ size = 50, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="32 14 56 56"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      <line x1={60} y1={20} x2={60} y2={38} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      <path
        d="M40 38 L80 38 L60 64 Z"
        fill="none"
        stroke={stroke}
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// pandapower/bus.svg — the busbar line (used small, e.g. in the palette).
export function BusGlyph({ width = 60, stroke = "currentColor" }: { width?: number; stroke?: string }) {
  return (
    <svg width={width} height={12} viewBox={`0 0 ${width} 12`} aria-hidden style={{ display: "block" }}>
      <line x1={4} y1={6} x2={width - 4} y2={6} stroke={stroke} strokeWidth={6} strokeLinecap="round" />
    </svg>
  );
}
