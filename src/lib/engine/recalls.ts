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

/**
 * True when this round must have recalls generated before it can be tabulated:
 * the rules call for recalls (championships) and the round isn't itself the recall round.
 * Grade competitions (recall_top_percent 0) and recall rounds never need recalls.
 */
export function roundNeedsRecalls(recallTopPercent: number, roundType: string): boolean {
  return recallTopPercent > 0 && roundType !== 'recall'
}

/**
 * The dancers who dance a given round. A standard round is everyone registered;
 * a recall round is only the dancers recalled from an earlier round.
 *
 * Recalls reference their source round, never the recall round itself. If a recall
 * round has no recalls (they failed to load), fall back to the full roster so
 * missing-score checks over-report rather than silently pass.
 */
export function getRoundRoster<T extends { dancer_id: string }>(
  registrations: T[],
  round: { id: string; round_type: string },
  recalls: { dancer_id: string; round_id: string }[]
): T[] {
  if (round.round_type !== 'recall') return registrations
  const recalled = new Set(recalls.filter((rc) => rc.round_id !== round.id).map((rc) => rc.dancer_id))
  if (recalled.size === 0) return registrations
  return registrations.filter((r) => recalled.has(r.dancer_id))
}
