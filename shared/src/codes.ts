/**
 * Suggested variation code: design code + "N" + number, e.g. D101 → D101N1.
 * Variation codes are typed in by the user — this is only a placeholder hint (and used by the seed).
 */
export function variationCode(designCode: string, variationNo: number): string {
  return `${designCode}N${variationNo}`;
}

/** Codes are stored upper-case without spaces. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}
