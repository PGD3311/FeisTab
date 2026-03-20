import { type Anomaly, type ScoreEntry, type StoredResult } from './types'
import { tabulate, type ScoreInput } from '../tabulate'
import { DEFAULT_RULES } from '../rules'

export function detectNonReproducibleResults(
  scores: ScoreEntry[],
  storedResults: StoredResult[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  if (storedResults.length === 0) return []

  // Use rules snapshot frozen at tabulation time. Falls back to DEFAULT_RULES
  // for results stored before rules_snapshot was added to calculated_payload.
  const frozenRules = storedResults[0]?.calculated_payload?.rules_snapshot ?? DEFAULT_RULES

  const roundScores = scores.filter(s => s.round_id === round_id)
  const scoreInputs: ScoreInput[] = roundScores.map(s => ({
    dancer_id: s.dancer_id,
    judge_id: s.judge_id,
    raw_score: s.raw_score,
    flagged: s.flagged,
  }))

  const recomputed = tabulate(scoreInputs, frozenRules)

  const storedRanks = new Map(storedResults.map(r => [r.dancer_id, r.final_rank]))
  const recomputedRanks = new Map(recomputed.map(r => [r.dancer_id, r.final_rank]))

  for (const [dancer_id, storedRank] of storedRanks) {
    const recomputedRank = recomputedRanks.get(dancer_id)
    if (recomputedRank !== undefined && recomputedRank !== storedRank) {
      return [
        {
          type: 'non_reproducible_results',
          severity: 'blocker',
          scope: 'competition',
          entity_ids: { competition_id },
          message: `Stored results do not match re-tabulation. Example: dancer ${dancer_id} stored as rank ${storedRank} but recomputes as rank ${recomputedRank}`,
          blocking: true,
          dedupe_key: `non_reproducible_results|${competition_id}`,
        },
      ]
    }
  }

  return []
}
