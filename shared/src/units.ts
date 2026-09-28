export const UNITS = ['meters', 'kg', 'pcs', 'g'] as const;
export type Unit = (typeof UNITS)[number];
export const DEFAULT_UNIT: Unit = 'meters';
