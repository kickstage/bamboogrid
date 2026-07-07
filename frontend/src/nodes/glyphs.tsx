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

// Static generator — circle with "S", matching the generator's circle-with-"G"
// (it's a generator-type source, just a static/inverter-fed one).
export function SgenGlyph({ size = 52, stroke = "currentColor" }: GlyphProps) {
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
        S
      </text>
    </svg>
  );
}

// pandapower/ext_grid.svg — a square with a wavy line, marking the connection
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
      <rect x={36} y={18} width={48} height={48} fill="none" stroke={stroke} strokeWidth={3} />
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

// Shunt — a capacitor symbol (stub into two parallel plates, then a short
// ground lead). Covers both capacitor and reactor; the sign of q_mvar says which.
export function ShuntGlyph({ size = 50, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="32 14 56 56"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      <line x1={60} y1={18} x2={60} y2={36} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      <line x1={46} y1={36} x2={74} y2={36} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      <line x1={46} y1={44} x2={74} y2={44} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      <line x1={60} y1={44} x2={60} y2={54} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      <line x1={50} y1={58} x2={70} y2={58} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

// xward — a network equivalent: a short stub through a series-impedance box into
// a boxed voltage source (sine wave). Reads as "impedance + equivalent grid",
// distinguishing it from the plain ext_grid square.
export function XwardGlyph({ size = 50, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="32 14 56 56"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      {/* connection stub */}
      <line x1={60} y1={16} x2={60} y2={26} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      {/* series impedance (resistor box) */}
      <rect x={54} y={26} width={12} height={9} fill="none" stroke={stroke} strokeWidth={2.5} />
      {/* lead into the equivalent-source box */}
      <line x1={60} y1={35} x2={60} y2={40} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      {/* equivalent network source: a box with the ext_grid sine wave (the same
          curve, scaled to fit this rectangle) marking the voltage source. */}
      <rect x={44} y={40} width={32} height={24} fill="none" stroke={stroke} strokeWidth={3} />
      <path d="M48 52 C53 44,67 60,72 52" fill="none" stroke={stroke} strokeWidth={3} />
    </svg>
  );
}

// SVC — a shunt FACTS voltage regulator. A connection stub into a box with a
// diagonal arrow through it (the IEC "variable/controllable" mark), reading as
// an adjustable susceptance — the dynamic sibling of the fixed shunt.
export function SvcGlyph({ size = 50, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="32 14 56 56"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      {/* connection stub */}
      <line x1={60} y1={16} x2={60} y2={30} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      {/* susceptance box */}
      <rect x={48} y={30} width={24} height={28} fill="none" stroke={stroke} strokeWidth={3} />
      {/* diagonal control arrow (variable) */}
      <line x1={44} y1={62} x2={74} y2={28} stroke={stroke} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M74 28 l-8 1 M74 28 l-1 8" fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Impedance — a series-branch symbol: two leads into the serpentine impedance
// curve from the project's SVG symbol library (symbols/pandapower/impedance.svg),
// so it reads as an impedance rather than the switch's plain box. Horizontal and
// symmetric so it rotates cleanly along the axis between its two buses. Rendered
// at the same ~1.6× scale, so the stroke is thinner to match the other glyphs.
export function ImpedanceGlyph({ size = 48, stroke = "currentColor" }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size / 2}
      viewBox="0 0 40 20"
      aria-hidden
      style={{ display: "block", margin: "0 auto" }}
    >
      <line x1={0} y1={10} x2={10} y2={10} stroke={stroke} strokeWidth={1.2} />
      {/* serpentine impedance curve (the library motif, laid horizontally) */}
      <path
        d="M10 10 q5 -7 10 0 q5 7 10 0"
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <line x1={30} y1={10} x2={40} y2={10} stroke={stroke} strokeWidth={1.2} />
    </svg>
  );
}

// A simple square switch sign with short leads: filled = closed, hollow = open.
// This glyph's viewBox is rendered at a larger scale than the others (~1.6× on
// canvas), so its stroke is set thinner to match their rendered outline weight.
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
      <line x1={0} y1={10} x2={12} y2={10} stroke={stroke} strokeWidth={1.2} />
      <line x1={28} y1={10} x2={40} y2={10} stroke={stroke} strokeWidth={1.2} />
      <rect
        x={12}
        y={2}
        width={16}
        height={16}
        rx={2}
        fill={closed ? stroke : "none"}
        stroke={stroke}
        strokeWidth={1.2}
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
