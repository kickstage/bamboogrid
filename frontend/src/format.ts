// Format a number to a fixed number of decimals, normalizing negative zero so a
// value that rounds to zero never shows as "-0.00" (e.g. a bus angle of -1e-9°).
export function fixed(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}
