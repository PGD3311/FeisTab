import { describe, it, expect } from 'vitest'
import { detectUnexplainedNoScores } from '@/lib/engine/anomalies/detect-unexplained-no-scores'
import { type ScoreEntry, type Registration, type RegistrationStatus } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string): ScoreEntry => ({
  id: '1', round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id: 'j1', raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string, status: RegistrationStatus = 'registered'): Registration => ({
  id: dancer_id, dancer_id, competition_id: 'c1',
  competitor_number: '100', status, status_reason: null,
})

describe('detectUnexplainedNoScores', () => {
  it('returns empty when all registered dancers have scores', () => {
    expect(detectUnexplainedNoScores([score('d1')], [reg('d1')], 'r1', 'c1')).toEqual([])
  })

  it('detects registered dancer with no scores and no status explanation', () => {
    const result = detectUnexplainedNoScores([], [reg('d1')], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('unexplained_no_scores')
    expect(result[0].severity).toBe('warning')
    expect(result[0].blocking).toBe(false)
  })

  it('ignores dancer with explained status', () => {
    expect(detectUnexplainedNoScores([], [reg('d1', 'scratched')], 'r1', 'c1')).toEqual([])
    expect(detectUnexplainedNoScores([], [reg('d1', 'no_show')], 'r1', 'c1')).toEqual([])
    expect(detectUnexplainedNoScores([], [reg('d1', 'disqualified')], 'r1', 'c1')).toEqual([])
    expect(detectUnexplainedNoScores([], [reg('d1', 'did_not_complete')], 'r1', 'c1')).toEqual([])
    expect(detectUnexplainedNoScores([], [reg('d1', 'medical')], 'r1', 'c1')).toEqual([])
  })

  it('returns empty for empty inputs', () => {
    expect(detectUnexplainedNoScores([], [], 'r1', 'c1')).toEqual([])
  })
})
