import { describe, it, expect } from 'vitest'
import { detectJudgeFlaggedAll } from '@/lib/engine/anomalies/detect-judge-flagged-all'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string, flagged = false): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score: 80,
  flagged, flag_reason: flagged ? 'Early Start' : null,
})

describe('detectJudgeFlaggedAll', () => {
  it('returns empty when no judge flagged all dancers', () => {
    const scores = [
      score('d1', 'j1', true), score('d2', 'j1', false),
    ]
    expect(detectJudgeFlaggedAll(scores, 'r1', 'c1')).toEqual([])
  })

  it('detects judge who flagged every dancer', () => {
    const scores = [
      score('d1', 'j1', true), score('d2', 'j1', true),
    ]
    const result = detectJudgeFlaggedAll(scores, 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('judge_flagged_all')
    expect(result[0].severity).toBe('info')
    expect(result[0].entity_ids.judge_id).toBe('j1')
  })

  it('ignores judge with only one dancer (single entry is not suspicious)', () => {
    const scores = [score('d1', 'j1', true)]
    expect(detectJudgeFlaggedAll(scores, 'r1', 'c1')).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(detectJudgeFlaggedAll([], 'r1', 'c1')).toEqual([])
  })
})
