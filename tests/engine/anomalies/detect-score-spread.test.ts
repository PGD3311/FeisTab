import { describe, it, expect } from 'vitest'
import { detectLargeScoreSpread } from '@/lib/engine/anomalies/detect-score-spread'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string, raw_score: number): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score,
  flagged: false, flag_reason: null,
})

describe('detectLargeScoreSpread', () => {
  it('returns empty for small spread', () => {
    const scores = [score('d1', 'j1', 80), score('d1', 'j2', 82)]
    expect(detectLargeScoreSpread(scores, 'r1', 'c1', 30)).toEqual([])
  })

  it('detects spread exceeding threshold', () => {
    const scores = [score('d1', 'j1', 90), score('d1', 'j2', 50)]
    const result = detectLargeScoreSpread(scores, 'r1', 'c1', 30)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('large_score_spread')
    expect(result[0].severity).toBe('info')
    expect(result[0].blocking).toBe(false)
  })

  it('returns empty for single judge', () => {
    const scores = [score('d1', 'j1', 80)]
    expect(detectLargeScoreSpread(scores, 'r1', 'c1', 30)).toEqual([])
  })

  it('checks each dancer independently', () => {
    const scores = [
      score('d1', 'j1', 90), score('d1', 'j2', 50),
      score('d2', 'j1', 80), score('d2', 'j2', 82),
    ]
    expect(detectLargeScoreSpread(scores, 'r1', 'c1', 30)).toHaveLength(1)
  })

  it('returns empty for empty input', () => {
    expect(detectLargeScoreSpread([], 'r1', 'c1', 30)).toEqual([])
  })
})
