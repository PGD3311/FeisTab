import { describe, it, expect } from 'vitest'
import { tabulate, resolveCountback, type ScoreInput, type TabulationResult } from '@/lib/engine/tabulate'
import { type RuleSetConfig, DEFAULT_RULES } from '@/lib/engine/rules'

describe('tabulate (Irish Points)', () => {
  it('ranks dancers by Irish Points total across judges', () => {
    // j1: a=90(1st=100), b=80(2nd=75). j2: b=95(1st=100), a=85(2nd=75).
    // a=100+75=175. b=75+100=175. Tie (both have one 1st).
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 85 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 95 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].final_rank).toBe(1)
    expect(results[0].total_points).toBe(175)
  })

  it('ranks correctly with single judge', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 85 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 92 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    // c=92→1st(100), a=90→2nd(75), b=85→3rd(65)
    expect(results[0].dancer_id).toBe('c')
    expect(results[0].total_points).toBe(100)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].dancer_id).toBe('a')
    expect(results[1].total_points).toBe(75)
    expect(results[2].dancer_id).toBe('b')
    expect(results[2].total_points).toBe(65)
  })

  it('true tie when countback cannot differentiate (same rank distribution)', () => {
    // 3 judges, 3 dancers. Each gets one 1st, one 2nd, one 3rd → 240 each.
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 95 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j3', raw_score: 88 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 88 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 95 },
      { dancer_id: 'b', judge_id: 'j3', raw_score: 80 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'c', judge_id: 'j2', raw_score: 88 },
      { dancer_id: 'c', judge_id: 'j3', raw_score: 95 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].final_rank).toBe(1)
    expect(results[2].final_rank).toBe(1)
  })

  it('ranks multiple dancers by total (no tie)', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 95 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 85 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 70 },
      { dancer_id: 'c', judge_id: 'j2', raw_score: 90 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    // j1: a=1st(100),b=2nd(75),c=3rd(65). j2: c=1st(100),a=2nd(75),b=3rd(65)
    // a=175, c=165, b=140
    expect(results[0].dancer_id).toBe('a')
    expect(results[0].total_points).toBe(175)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].dancer_id).toBe('c')
    expect(results[1].total_points).toBe(165)
    expect(results[1].final_rank).toBe(2)
    expect(results[2].dancer_id).toBe('b')
    expect(results[2].total_points).toBe(140)
    expect(results[2].final_rank).toBe(3)
  })

  it('resolveCountback differentiates by rank distribution', () => {
    const a: TabulationResult = {
      dancer_id: 'a', final_rank: 0, total_points: 240,
      individual_ranks: [
        { judge_id: 'j1', rank: 1, irish_points: 100 },
        { judge_id: 'j2', rank: 1, irish_points: 100 },
        { judge_id: 'j3', rank: 5, irish_points: 40 },
      ],
    }
    const b: TabulationResult = {
      dancer_id: 'b', final_rank: 0, total_points: 240,
      individual_ranks: [
        { judge_id: 'j1', rank: 2, irish_points: 80 },
        { judge_id: 'j2', rank: 2, irish_points: 80 },
        { judge_id: 'j3', rank: 2, irish_points: 80 },
      ],
    }
    // a has two 1st places, b has zero → a wins
    expect(resolveCountback(a, b)).toBeLessThan(0)
  })

  it('flagged score gives 0 points from that judge', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 85, flagged: true },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 95 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    // j1: a=1st(100), b=2nd(75). j2: b=1st(100), a=flagged(0)
    // a=100+0=100. b=75+100=175.
    expect(results[0].dancer_id).toBe('b')
    expect(results[0].total_points).toBe(175)
    expect(results[1].dancer_id).toBe('a')
    expect(results[1].total_points).toBe(100)
  })

  it('returns individual_ranks breakdown per dancer', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    const dancerA = results.find(r => r.dancer_id === 'a')!
    expect(dancerA.individual_ranks).toHaveLength(1)
    expect(dancerA.individual_ranks[0].judge_id).toBe('j1')
    expect(dancerA.individual_ranks[0].rank).toBe(1)
    expect(dancerA.individual_ranks[0].irish_points).toBe(100)
  })

  it('returns empty array for empty scores', () => {
    expect(tabulate([], DEFAULT_RULES)).toEqual([])
  })
})
