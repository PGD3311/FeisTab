export type { TabulationResult } from './tabulate'
import { type TabulationResult } from './tabulate'

export function generateRecalls(
  results: TabulationResult[],
  recallTopN: number
): TabulationResult[] {
  if (recallTopN <= 0 || results.length === 0) return []

  // Find the rank at position N
  const sorted = [...results].sort((a, b) => a.final_rank - b.final_rank)
  const cutoffRank = sorted[Math.min(recallTopN - 1, sorted.length - 1)].final_rank

  // Include all dancers at or above the cutoff rank (handles ties)
  return sorted.filter(r => r.final_rank <= cutoffRank)
}
