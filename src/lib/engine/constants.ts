/**
 * Precision multiplier for integer score comparisons.
 * Multiply totals by this value and round before comparing,
 * to avoid floating-point equality issues.
 */
export const PRECISION = 1000
