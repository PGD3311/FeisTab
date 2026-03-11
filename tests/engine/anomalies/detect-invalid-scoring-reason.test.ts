import { describe, it, expect } from 'vitest'
import { detectInvalidScoringReason } from '@/lib/engine/anomalies/detect-invalid-scoring-reason'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const base: ScoreEntry = {
  id: '1',
  round_id: 'r1',
  competition_id: 'c1',
  dancer_id: 'd1',
  judge_id: 'j1',
  raw_score: 80,
  flagged: false,
  flag_reason: null,
}

describe('detectInvalidScoringReason', () => {
  it('returns empty for normal scores', () => {
    expect(detectInvalidScoringReason([base], 'c1')).toEqual([])
  })

  it('detects flagged score without flag_reason', () => {
    const scores = [{ ...base, flagged: true, flag_reason: null }]
    const result = detectInvalidScoringReason(scores, 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('invalid_scoring_reason')
    expect(result[0].severity).toBe('blocker')
  })

  it('allows flagged score with valid flag_reason', () => {
    const scores = [{ ...base, flagged: true, flag_reason: 'Early Start' }]
    expect(detectInvalidScoringReason(scores, 'c1')).toEqual([])
  })

  it('detects zero score without flag', () => {
    const scores = [{ ...base, raw_score: 0, flagged: false }]
    const result = detectInvalidScoringReason(scores, 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('invalid_scoring_reason')
  })

  it('allows zero score when flagged with reason', () => {
    const scores = [{ ...base, raw_score: 0, flagged: true, flag_reason: 'Did Not Complete' }]
    expect(detectInvalidScoringReason(scores, 'c1')).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(detectInvalidScoringReason([], 'c1')).toEqual([])
  })
})
