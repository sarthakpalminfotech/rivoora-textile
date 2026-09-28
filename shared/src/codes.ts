/**
 * Variation code format: design code + "N" + number, e.g. D101 → D101N1.
 * Change the format here only.
 */
export function variationCode(designCode: string, variationNo: number): string {
  return `${designCode}N${variationNo}`;
}

/** Codes are stored upper-case without spaces. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}
