/**
 * Parse Kalshi fixed-point dollar strings (e.g. "0.5600") to a number.
 */
export function parseDollars(val: string | null | undefined): number {
  if (val == null || val === "") return NaN;
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

/** Parse fixed-point contract counts (fp fields). */
export function parseFp(val: string | null | undefined): number {
  return parseDollars(val);
}
