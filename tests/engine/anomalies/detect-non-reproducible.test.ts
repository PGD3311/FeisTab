import { describe, it, expect } from 'vitest'
import { detectNonReproducibleResults } from '@/lib/engine/anomalies/detect-non-reproducible'
import { type ScoreEntry, type StoredResult } from '@/lib/engine/anomalies/types'
import { type RuleSetConfig, DEFAULT_RULES } from '@/lib/engine/rules'

const score = (dancer_id: string, judge_id: string, raw_score: number): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`,
  round_id: 'r1',
  competition_id: 'c1',
  dancer_id,
  judge_id,
  raw_score,
  flagged: false,
  flag_reason: null,
})

describe('detectNonReproducibleResults', () => {
  it('returns empty when results match re-tabulation', () => {
    const scores = [
      score('d1', 'j1', 90),
      score('d1', 'j2', 85),
      score('d2', 'j1', 70),
      score('d2', 'j2', 75),
    ]
    const results: StoredResult[] = [
      {
        dancer_id: 'd1',
        final_rank: 1,
        calculated_payload: { total_points: 200, individual_ranks: [], rules_snapshot: DEFAULT_RULES },
      },
      {
        dancer_id: 'd2',
        final_rank: 2,
        calculated_payload: { total_points: 150, individual_ranks: [], rules_snapshot: DEFAULT_RULES },
      },
    ]
    expect(detectNonReproducibleResults(scores, results, 'r1', 'c1')).toEqual([])
  })

  it('detects rank mismatch', () => {
    const scores = [
      score('d1', 'j1', 90),
      score('d1', 'j2', 85),
      score('d2', 'j1', 70),
      score('d2', 'j2', 75),
    ]
    const results: StoredResult[] = [
      {
        dancer_id: 'd1',
        final_rank: 2,
        calculated_payload: { total_points: 200, individual_ranks: [], rules_snapshot: DEFAULT_RULES },
      },
      {
        dancer_id: 'd2',
        final_rank: 1,
        calculated_payload: { total_points: 150, individual_ranks: [], rules_snapshot: DEFAULT_RULES },
      },
    ]
    const anomalies = detectNonReproducibleResults(scores, results, 'r1', 'c1')
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].type).toBe('non_reproducible_results')
    expect(anomalies[0].severity).toBe('blocker')
  })

  it('returns empty when no stored results', () => {
    const scores = [score('d1', 'j1', 90)]
    expect(detectNonReproducibleResults(scores, [], 'r1', 'c1')).toEqual([])
  })

  it('uses frozen rules snapshot from stored results', () => {
    const scores = [score('d1', 'j1', 90), score('d2', 'j1', 80)]
    const frozenRules: RuleSetConfig = { ...DEFAULT_RULES, tie_breaker: 'none' }
    const results: StoredResult[] = [
      {
        dancer_id: 'd1',
        final_rank: 1,
        calculated_payload: { total_points: 100, individual_ranks: [], rules_snapshot: frozenRules },
      },
      {
        dancer_id: 'd2',
        final_rank: 2,
        calculated_payload: { total_points: 75, individual_ranks: [], rules_snapshot: frozenRules },
      },
    ]
    expect(detectNonReproducibleResults(scores, results, 'r1', 'c1')).toEqual([])
  })
})
