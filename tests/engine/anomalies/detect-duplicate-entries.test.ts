import { describe, it, expect } from 'vitest'
import { detectDuplicateScoreEntries } from '@/lib/engine/anomalies/detect-duplicate-entries'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const base: ScoreEntry = {
  id: '1', round_id: 'r1', competition_id: 'c1',
  dancer_id: 'd1', judge_id: 'j1', raw_score: 80,
  flagged: false, flag_reason: null,
}

describe('detectDuplicateScoreEntries', () => {
  it('returns empty for no duplicates', () => {
    const scores = [
      { ...base, id: '1', dancer_id: 'd1', judge_id: 'j1' },
      { ...base, id: '2', dancer_id: 'd1', judge_id: 'j2' },
      { ...base, id: '3', dancer_id: 'd2', judge_id: 'j1' },
    ]
    expect(detectDuplicateScoreEntries(scores, 'c1')).toEqual([])
  })

  it('detects duplicate judge+dancer+round', () => {
    const scores = [
      { ...base, id: '1', dancer_id: 'd1', judge_id: 'j1' },
      { ...base, id: '2', dancer_id: 'd1', judge_id: 'j1' },
    ]
    const result = detectDuplicateScoreEntries(scores, 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('duplicate_score_entry')
    expect(result[0].severity).toBe('blocker')
    expect(result[0].blocking).toBe(true)
    expect(result[0].entity_ids.dancer_id).toBe('d1')
    expect(result[0].entity_ids.judge_id).toBe('j1')
  })

  it('returns empty for empty input', () => {
    expect(detectDuplicateScoreEntries([], 'c1')).toEqual([])
  })

  it('detects multiple duplicate groups', () => {
    const scores = [
      { ...base, id: '1', dancer_id: 'd1', judge_id: 'j1' },
      { ...base, id: '2', dancer_id: 'd1', judge_id: 'j1' },
      { ...base, id: '3', dancer_id: 'd2', judge_id: 'j2' },
      { ...base, id: '4', dancer_id: 'd2', judge_id: 'j2' },
    ]
    expect(detectDuplicateScoreEntries(scores, 'c1')).toHaveLength(2)
  })
})
