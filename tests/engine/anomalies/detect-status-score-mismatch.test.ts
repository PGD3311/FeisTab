import { describe, it, expect } from 'vitest'
import { detectStatusScoreMismatch } from '@/lib/engine/anomalies/detect-status-score-mismatch'
import { type ScoreEntry, type Registration, type RegistrationStatus } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string): ScoreEntry => ({
  id: '1', round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id: 'j1', raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string, status: RegistrationStatus): Registration => ({
  id: dancer_id, dancer_id, competition_id: 'c1',
  competitor_number: '100', status, status_reason: null,
})

describe('detectStatusScoreMismatch', () => {
  it('returns empty for normal case', () => {
    expect(detectStatusScoreMismatch([score('d1')], [reg('d1', 'danced')], 'r1', 'c1')).toEqual([])
  })

  it('detects withdrawn dancer with scores', () => {
    const result = detectStatusScoreMismatch([score('d1')], [reg('d1', 'scratched')], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('status_score_mismatch')
    expect(result[0].severity).toBe('warning')
  })

  it('detects no_show dancer with scores', () => {
    const result = detectStatusScoreMismatch([score('d1')], [reg('d1', 'no_show')], 'r1', 'c1')
    expect(result).toHaveLength(1)
  })

  it('detects disqualified dancer with scores', () => {
    const result = detectStatusScoreMismatch([score('d1')], [reg('d1', 'disqualified')], 'r1', 'c1')
    expect(result).toHaveLength(1)
  })

  it('detects did_not_complete dancer with scores', () => {
    const result = detectStatusScoreMismatch([score('d1')], [reg('d1', 'did_not_complete')], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('status_score_mismatch')
  })

  it('detects medical dancer with scores', () => {
    const result = detectStatusScoreMismatch([score('d1')], [reg('d1', 'medical')], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('status_score_mismatch')
  })

  it('returns empty for empty inputs', () => {
    expect(detectStatusScoreMismatch([], [], 'r1', 'c1')).toEqual([])
  })
})
