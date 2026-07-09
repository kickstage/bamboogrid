// Canvas rendering tokens shared by nodes and edges, so the look stays in one
// place instead of being copy-pasted across every element component.

// The app's accent blue. Two on-canvas roles share it today — the selection
// highlight on an element, and the load-flow readout figures — so a rebrand is
// a single edit here rather than a hunt through a dozen files.
export const ACCENT = "#0ea5e9";

// Standard width of a point element's cell on the canvas: the centered glyph
// plus the name/value labels stacked under it. Shared so a row of elements
// lines up on a common width.
export const NODE_WIDTH = 64;
