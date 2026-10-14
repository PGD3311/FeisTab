import { describe, it, expect } from 'vitest'
import { detectUnresolvedTies } from '@/lib/engine/anomalies/detect-unresolved-ties'
import { type ScoreEntry, type Registration } from '@/lib/engine/anomalies/types'
import { DEFAULT_RULES } from '@/lib/engine/rules'

const score = (dancer_id: string, judge_id: string, raw_score: number, flagged = false): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score,
  flagged, flag_reason: flagged ? 'early_start' : null,
})

const reg = (dancer_id: string, competitor_number: string | null): Registration => ({
  id: dancer_id, dancer_id, competition_id: 'c1',
  competitor_number, status: 'danced', status_reason: null,
})

const regs = [reg('d1', '101'), reg('d2', '102'), reg('d3', '103'), reg('d4', '104')]

describe('detectUnresolvedTies', () => {
  it('flags two dancers still tied after countback', () => {
    // d1 and d2 each get one 2nd and one 3rd — 140 points, countback can't split them
    const scores = [
      score('d3', 'j1', 95), score('d1', 'j1', 90), score('d2', 'j1', 80),
      score('d3', 'j2', 95), score('d2', 'j2', 90), score('d1', 'j2', 80),
    ]
    const result = detectUnresolvedTies(scores, regs, DEFAULT_RULES, 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'unresolved_tie',
      severity: 'warning',
      scope: 'round',
      blocking: false,
      message: 'Tie for 2nd place between #101 and #102',
      dedupe_key: 'unresolved_tie|r1|2',
    })
    expect(result[0].entity_ids.dancer_ids.split(',').sort()).toEqual(['d1', 'd2'])
  })

  it('does not flag equal points that countback resolves', () => {
    // d1 ranks (1,3,4) and d2 ranks (2,2,2): both 225 points, d1 wins on 1st places
    const scores = [
      score('d1', 'j1', 90), score('d2', 'j1', 80), score('d3', 'j1', 70), score('d4', 'j1', 60),
      score('d3', 'j2', 90), score('d2', 'j2', 80), score('d1', 'j2', 70), score('d4', 'j2', 60),
      score('d3', 'j3', 90), score('d2', 'j3', 80), score('d4', 'j3', 70), score('d1', 'j3', 60),
    ]
    expect(detectUnresolvedTies(scores, regs, DEFAULT_RULES, 'r1', 'c1')).toEqual([])
  })

  it('flags the same scores when the tie-breaker is off', () => {
    const scores = [
      score('d1', 'j1', 90), score('d2', 'j1', 80), score('d3', 'j1', 70), score('d4', 'j1', 60),
      score('d3', 'j2', 90), score('d2', 'j2', 80), score('d1', 'j2', 70), score('d4', 'j2', 60),
      score('d3', 'j3', 90), score('d2', 'j3', 80), score('d4', 'j3', 70), score('d1', 'j3', 60),
    ]
    const rules = { ...DEFAULT_RULES, tie_breaker: 'none' as const }
    const result = detectUnresolvedTies(scores, regs, rules, 'r1', 'c1')
    expect(result.map(a => a.message)).toEqual(['Tie for 2nd place between #101 and #102'])
  })

  it('does not flag a single dancer', () => {
    const scores = [score('d1', 'j1', 90), score('d1', 'j2', 85)]
    expect(detectUnresolvedTies(scores, regs, DEFAULT_RULES, 'r1', 'c1')).toEqual([])
  })

  it('flags each separate tie', () => {
    // d1/d2 split 1st and 2nd; d3/d4 split 3rd and 4th
    const scores = [
      score('d1', 'j1', 90), score('d2', 'j1', 80), score('d3', 'j1', 70), score('d4', 'j1', 60),
      score('d2', 'j2', 90), score('d1', 'j2', 80), score('d4', 'j2', 70), score('d3', 'j2', 60),
    ]
    const result = detectUnresolvedTies(scores, regs, DEFAULT_RULES, 'r1', 'c1')
    expect(result.map(a => a.message)).toEqual([
      'Tie for 1st place between #101 and #102',
      'Tie for 3rd place between #103 and #104',
    ])
    expect(new Set(result.map(a => a.dedupe_key)).size).toBe(2)
  })

  it('lists every dancer in a three-way tie', () => {
    const scores = [score('d1', 'j1', 80), score('d2', 'j1', 80), score('d3', 'j1', 80)]
    const result = detectUnresolvedTies(scores, regs, DEFAULT_RULES, 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].message).toMatch(/^Tie for 1st place between #10\d, #10\d and #10\d$/)
  })

  it('ignores dancers with no placing (all scores flagged)', () => {
    const scores = [
      score('d1', 'j1', 90),
      score('d2', 'j1', 80, true), score('d3', 'j1', 70, true),
    ]
    expect(detectUnresolvedTies(scores, regs, DEFAULT_RULES, 'r1', 'c1')).toEqual([])
  })

  it('falls back to dancer id when there is no competitor number', () => {
    const scores = [score('d1', 'j1', 80), score('d9', 'j1', 80)]
    const result = detectUnresolvedTies(scores, [reg('d1', '101'), reg('d9', null)], DEFAULT_RULES, 'r1', 'c1')
    expect(result[0].message).toMatch(/#101/)
    expect(result[0].message).toMatch(/d9/)
  })

  it('only looks at the given round', () => {
    const scores = [score('d1', 'j1', 80), score('d2', 'j1', 80)]
    expect(detectUnresolvedTies(scores, regs, DEFAULT_RULES, 'r2', 'c1')).toEqual([])
  })
})
