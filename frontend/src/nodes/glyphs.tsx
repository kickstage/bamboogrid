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

// pandapower/sgen.svg — a box with an AC sine wave and a "DC/AC" label (the
// inverter / static-source mark).
export function SgenGlyph({ size = 52, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="30 8 60 60"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      <rect x={36} y={24} width={48} height={36} fill="none" stroke={stroke} strokeWidth={3} />
      {/* Symmetric AC sine, kept fully inside the box (the library's original
          dips below the bottom edge). */}
      <path d="M42 42 Q51 30 60 42 T78 42" fill="none" stroke={stroke} strokeWidth={2} />
      <text
        x={60}
        y={20}
        textAnchor="middle"
        fontFamily="Arial, sans-serif"
        fontSize={12}
        fill={stroke}
      >
        DC/AC
      </text>
    </svg>
  );
}

// pandapower/ext_grid.svg — a circle with a wavy line, marking the connection
// to an external network (the slack reference).
export function ExtGridGlyph({ size = 52, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="30 12 60 60"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      <circle cx={60} cy={42} r={24} fill="none" stroke={stroke} strokeWidth={3} />
      <path d="M42 42 C50 26,70 58,78 42" fill="none" stroke={stroke} strokeWidth={3} />
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

// A simple square switch sign with short leads: filled = closed, hollow = open.
export function SwitchGlyph({
  size = 48,
  stroke = "currentColor",
  closed = true,
}: GlyphProps & { closed?: boolean }) {
  return (
    <svg
      width={size}
      height={size / 2}
      viewBox="0 0 40 20"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      <line x1={0} y1={10} x2={12} y2={10} stroke={stroke} strokeWidth={2} />
      <line x1={28} y1={10} x2={40} y2={10} stroke={stroke} strokeWidth={2} />
      <rect
        x={12}
        y={2}
        width={16}
        height={16}
        rx={2}
        fill={closed ? stroke : "none"}
        stroke={stroke}
        strokeWidth={2}
      />
    </svg>
  );
}

// 2-winding transformer — two overlapping circles, HV on top, LV on bottom.
export function TransformerGlyph({ size = 40, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={(size * 48) / 40}
      viewBox="0 0 40 48"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      <line x1={20} y1={0} x2={20} y2={6} stroke={stroke} strokeWidth={2} />
      <circle cx={20} cy={17} r={12} fill="none" stroke={stroke} strokeWidth={2} />
      <circle cx={20} cy={31} r={12} fill="none" stroke={stroke} strokeWidth={2} />
      <line x1={20} y1={42} x2={20} y2={48} stroke={stroke} strokeWidth={2} />
    </svg>
  );
}

// 3-winding transformer — three overlapping circles (HV top, MV/LV bottom).
export function Transformer3WGlyph({ size = 48, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      <line x1={24} y1={0} x2={24} y2={5} stroke={stroke} strokeWidth={2} />
      <circle cx={24} cy={16} r={11} fill="none" stroke={stroke} strokeWidth={2} />
      <circle cx={17} cy={31} r={11} fill="none" stroke={stroke} strokeWidth={2} />
      <circle cx={31} cy={31} r={11} fill="none" stroke={stroke} strokeWidth={2} />
      <line x1={17} y1={42} x2={17} y2={48} stroke={stroke} strokeWidth={2} />
      <line x1={31} y1={42} x2={31} y2={48} stroke={stroke} strokeWidth={2} />
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
