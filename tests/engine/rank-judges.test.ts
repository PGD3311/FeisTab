import { describe, it, expect } from 'vitest'
import { rankByJudge, type JudgeRanking } from '@/lib/engine/rank-judges'
import { type ScoreInput } from '@/lib/engine/tabulate'

describe('rankByJudge', () => {
  it('ranks dancers within a single judge by raw score descending', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 85 },
    ]
    const result = rankByJudge(scores)
    const j1 = result.get('j1')!
    expect(j1).toHaveLength(3)

    const findDancer = (id: string) => j1.find(r => r.dancer_id === id)!
    expect(findDancer('b').rank).toBe(1)
    expect(findDancer('b').irish_points).toBe(100)
    expect(findDancer('c').rank).toBe(2)
    expect(findDancer('c').irish_points).toBe(75)
    expect(findDancer('a').rank).toBe(3)
    expect(findDancer('a').irish_points).toBe(65)
  })

  it('handles tied raw scores — shared rank, averaged points', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
    ]
    const result = rankByJudge(scores)
    const j1 = result.get('j1')!

    const findDancer = (id: string) => j1.find(r => r.dancer_id === id)!
    // a and b tied for 1st: avg of 1st(100) and 2nd(75) = 88 (rounded)
    expect(findDancer('a').rank).toBe(1)
    expect(findDancer('b').rank).toBe(1)
    expect(findDancer('a').irish_points).toBe(88)
    expect(findDancer('b').irish_points).toBe(88)
    // c is 3rd (rank skips 2nd)
    expect(findDancer('c').rank).toBe(3)
    expect(findDancer('c').irish_points).toBe(65)
  })

  it('handles multiple judges independently', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 70 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 95 },
    ]
    const result = rankByJudge(scores)

    const j1a = result.get('j1')!.find(r => r.dancer_id === 'a')!
    expect(j1a.rank).toBe(1)
    expect(j1a.irish_points).toBe(100)

    const j2b = result.get('j2')!.find(r => r.dancer_id === 'b')!
    expect(j2b.rank).toBe(1)
    expect(j2b.irish_points).toBe(100)
  })

  it('assigns 0 points to flagged scores', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 85, flagged: true },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
    ]
    const result = rankByJudge(scores)
    const j1 = result.get('j1')!
    const findDancer = (id: string) => j1.find(r => r.dancer_id === id)!

    expect(findDancer('b').irish_points).toBe(0)
    expect(findDancer('a').rank).toBe(1)
    expect(findDancer('a').irish_points).toBe(100)
    expect(findDancer('c').rank).toBe(2)
    expect(findDancer('c').irish_points).toBe(75)
  })

  it('handles all dancers tied (same score)', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
    ]
    const result = rankByJudge(scores)
    const j1 = result.get('j1')!
    // All tie for 1st: avg of 1st(100), 2nd(75), 3rd(65) = 80
    for (const r of j1) {
      expect(r.rank).toBe(1)
      expect(r.irish_points).toBe(80)
    }
  })
})
