import { describe, it, expect } from 'vitest'
import { detectMissingRequiredScores } from '@/lib/engine/anomalies/detect-missing-scores'
import { type ScoreEntry, type Registration } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string, round_id = 'r1'): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id, competition_id: 'c1',
  dancer_id, judge_id, raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string): Registration => ({
  id: dancer_id, dancer_id, competition_id: 'c1',
  competitor_number: '100', status: 'registered', status_reason: null,
})

describe('detectMissingRequiredScores', () => {
  it('returns empty when all dancers have scores from all judges', () => {
    const scores = [
      score('d1', 'j1'), score('d1', 'j2'),
      score('d2', 'j1'), score('d2', 'j2'),
    ]
    expect(detectMissingRequiredScores(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')).toEqual([])
  })

  it('detects dancer scored by some judges but not all', () => {
    const scores = [
      score('d1', 'j1'), score('d1', 'j2'),
      score('d2', 'j1'),
    ]
    const result = detectMissingRequiredScores(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('missing_required_score')
    expect(result[0].severity).toBe('blocker')
    expect(result[0].entity_ids.dancer_id).toBe('d2')
  })

  it('ignores dancers with zero scores (handled by other check)', () => {
    const scores = [score('d1', 'j1'), score('d1', 'j2')]
    expect(detectMissingRequiredScores(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')).toEqual([])
  })

  it('returns empty for empty inputs', () => {
    expect(detectMissingRequiredScores([], [], [], 'r1', 'c1')).toEqual([])
  })
})
