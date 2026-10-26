/** Codes are stored upper-case without spaces. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/** The characters a design code may contain (after `normalizeCode`). */
export const DESIGN_CODE_REGEX = /^[A-Z0-9_\-/.]+$/;
export const DESIGN_CODE_MAX_LENGTH = 30;
