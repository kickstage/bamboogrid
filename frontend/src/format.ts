// Format a number to a fixed number of decimals, normalizing negative zero so a
// value that rounds to zero never shows as "-0.00" (e.g. a bus angle of -1e-9°).
export function fixed(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

// Like fixed(), but reserves a leading sign column so stacked values line up on
// their first digit: a non-negative number gets a no-break space (same cell
// width as "-" in the monospace readouts) where the minus sign would be.
export function signed(n: number, digits: number): string {
  const s = fixed(n, digits);
  return s.startsWith("-") ? s : ` ${s}`;
}
