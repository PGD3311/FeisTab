import { describe, it, expect } from 'vitest'
import { tabulate, type ScoreInput, type TabulationResult } from '@/lib/engine/tabulate'
import { type RuleSetConfig } from '@/lib/engine/rules'

const defaultRules: RuleSetConfig = {
  score_min: 0,
  score_max: 100,
  aggregation: 'average',
  tie_breaker: 'highest_individual',
  recall_top_n: 0,
  drop_high: false,
  drop_low: false,
}

describe('tabulate', () => {
  it('ranks dancers by average score across judges', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 70 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 75 },
    ]
    const results = tabulate(scores, defaultRules)
    expect(results[0].dancer_id).toBe('a')
    expect(results[0].final_rank).toBe(1)
    expect(results[1].dancer_id).toBe('b')
    expect(results[1].final_rank).toBe(2)
  })

  it('breaks ties using highest individual score', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 70 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 70 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 80 },
    ]
    // Both average 75. Tie-break: highest individual = 80 for both. True tie.
    const results = tabulate(scores, defaultRules)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].final_rank).toBe(1)
  })

  it('handles single judge', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 85 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 92 },
    ]
    const results = tabulate(scores, defaultRules)
    expect(results[0].dancer_id).toBe('c')
    expect(results[0].final_rank).toBe(1)
    expect(results[1].dancer_id).toBe('a')
    expect(results[2].dancer_id).toBe('b')
  })

  it('drops high score when configured', () => {
    const rules = { ...defaultRules, drop_high: true }
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 90 },
      { dancer_id: 'a', judge_id: 'j3', raw_score: 100 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 85 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 85 },
      { dancer_id: 'b', judge_id: 'j3', raw_score: 85 },
    ]
    // a: drop 100, avg(80,90)=85. b: drop 85, avg(85,85)=85. Tie.
    const results = tabulate(scores, rules)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].final_rank).toBe(1)
  })

  it('drops both high and low simultaneously when configured', () => {
    const rules = { ...defaultRules, drop_high: true, drop_low: true }
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 60 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j3', raw_score: 100 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 75 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j3', raw_score: 85 },
    ]
    // a: drop 60 and 100 simultaneously, keep [80] = 80
    // b: drop 75 and 85 simultaneously, keep [80] = 80. Tie.
    const results = tabulate(scores, rules)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].final_rank).toBe(1)
  })

  it('does not drop when only 2 judges and both drop flags (need minimum scores)', () => {
    const rules = { ...defaultRules, drop_high: true, drop_low: true }
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 60 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 100 },
    ]
    // Only 2 scores — dropping both would leave 0. Keep all scores instead.
    const results = tabulate(scores, rules)
    expect(results[0].average_score).toBe(80) // (60+100)/2, no drops
  })

  it('handles fractional scores without floating point errors in ranking', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 79.3 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 80.7 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 80 },
    ]
    // Both average exactly 80.0 — must detect tie despite floating point
    // a wins tiebreak: highest_individual 80.7 vs 80
    const results = tabulate(scores, defaultRules)
    expect(results[0].dancer_id).toBe('a')
    expect(results[0].final_rank).toBe(1)
    expect(results[1].dancer_id).toBe('b')
    expect(results[1].final_rank).toBe(2)
  })

  it('returns empty array for empty scores', () => {
    const results = tabulate([], defaultRules)
    expect(results).toEqual([])
  })
})
