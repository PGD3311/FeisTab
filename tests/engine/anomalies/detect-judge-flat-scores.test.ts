import { describe, it, expect } from 'vitest'
import { detectJudgeFlatScores } from '@/lib/engine/anomalies/detect-judge-flat-scores'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string, raw_score: number): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score,
  flagged: false, flag_reason: null,
})

describe('detectJudgeFlatScores', () => {
  it('returns empty for varied scores', () => {
    const scores = [score('d1', 'j1', 80), score('d2', 'j1', 75), score('d3', 'j1', 70)]
    expect(detectJudgeFlatScores(scores, 'r1', 'c1')).toEqual([])
  })

  it('skips judge with only two dancers (too few to be suspicious)', () => {
    const scores = [score('d1', 'j1', 80), score('d2', 'j1', 80)]
    expect(detectJudgeFlatScores(scores, 'r1', 'c1')).toEqual([])
  })

  it('detects judge giving identical scores to all dancers', () => {
    const scores = [score('d1', 'j1', 80), score('d2', 'j1', 80), score('d3', 'j1', 80)]
    const result = detectJudgeFlatScores(scores, 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('judge_flat_scores')
    expect(result[0].severity).toBe('info')
    expect(result[0].entity_ids.judge_id).toBe('j1')
  })

  it('ignores judge with only one dancer', () => {
    const scores = [score('d1', 'j1', 80)]
    expect(detectJudgeFlatScores(scores, 'r1', 'c1')).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(detectJudgeFlatScores([], 'r1', 'c1')).toEqual([])
  })
})
