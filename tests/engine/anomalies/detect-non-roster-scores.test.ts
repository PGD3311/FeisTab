import { describe, it, expect } from 'vitest'
import { detectScoresForNonRosterDancers } from '@/lib/engine/anomalies/detect-non-roster-scores'
import { type ScoreEntry, type Registration } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string): ScoreEntry => ({
  id: '1', round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id: 'j1', raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string): Registration => ({
  id: '1', dancer_id, competition_id: 'c1',
  competitor_number: '100', status: 'registered', status_reason: null,
})

describe('detectScoresForNonRosterDancers', () => {
  it('returns empty when all scored dancers are registered', () => {
    expect(detectScoresForNonRosterDancers(
      [score('d1'), score('d2')],
      [reg('d1'), reg('d2')],
      'c1'
    )).toEqual([])
  })

  it('detects score for unregistered dancer', () => {
    const result = detectScoresForNonRosterDancers(
      [score('d1'), score('d999')],
      [reg('d1')],
      'c1'
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('score_for_non_roster_dancer')
    expect(result[0].severity).toBe('blocker')
    expect(result[0].entity_ids.dancer_id).toBe('d999')
  })

  it('returns empty for empty scores', () => {
    expect(detectScoresForNonRosterDancers([], [reg('d1')], 'c1')).toEqual([])
  })

  it('reports each non-roster dancer once', () => {
    const result = detectScoresForNonRosterDancers(
      [score('d999'), { ...score('d999'), id: '2', judge_id: 'j2' }],
      [reg('d1')],
      'c1'
    )
    expect(result).toHaveLength(1)
  })
})
