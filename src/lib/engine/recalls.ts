import { type TabulationResult } from './tabulate'
export type { TabulationResult } from './tabulate'

/**
 * Generate recalls for the top N% of dancers.
 * Includes tie-bubble expansion: if dancers are tied at the cutoff rank,
 * all tied dancers are recalled.
 *
 * @param results - Tabulation results (must have final_rank assigned)
 * @param recallTopPercent - Percentage of dancers to recall (0-100)
 */
export function generateRecalls(
  results: TabulationResult[],
  recallTopPercent: number
): TabulationResult[] {
  if (recallTopPercent <= 0 || results.length === 0) return []

  const recallCount = Math.ceil(results.length * recallTopPercent / 100)

  const sorted = [...results].sort((a, b) => a.final_rank - b.final_rank)
  const cutoffRank = sorted[Math.min(recallCount - 1, sorted.length - 1)].final_rank

  return sorted.filter(r => r.final_rank <= cutoffRank)
}
