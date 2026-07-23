// Shared primitives for the matrix-heatmap study panels (admittance matrix,
// measurement Jacobian): cell-size bounds, the color ramps, and the readable
// in-cell text color. Kept in one place so the two panels can't drift apart.

// Cell size bounds (px). Max keeps a tiny matrix from ballooning; min lets a
// huge one shrink and scroll rather than collapse to sub-pixel.
export const MIN_CELL = 6;
export const MAX_CELL = 44;
export const CHAR_W = 6;

export type CellStyle = { fill: string; text: string };

export const EMPTY_CELL: CellStyle = { fill: "transparent", text: "currentColor" };

// Text that stays readable on a given cell lightness (the heatmap fill is fixed
// regardless of light/dark theme, so the in-cell numbers must not use the
// theme's currentColor — a light cell in dark mode would render white on white).
export function textOn(lightness: number): string {
  return lightness > 62 ? "#0b2e2b" : "#ffffff";
}

// Sequential teal ramp for a non-negative magnitude: light -> saturated.
export function magColor(t: number): CellStyle {
  const l = 93 - 60 * t;
  return { fill: `hsl(174, 62%, ${l}%)`, text: textOn(l) };
}

// Diverging red/blue ramp centered on zero. Perceptual sqrt so small values stay
// visible next to the dominant ones.
export function divColor(t: number): CellStyle {
  const m = Math.sqrt(Math.min(1, Math.abs(t)));
  const l = 96 - 56 * m;
  const sat = 12 + 68 * m;
  return { fill: `hsl(${t >= 0 ? 0 : 217}, ${sat}%, ${l}%)`, text: textOn(l) };
}
