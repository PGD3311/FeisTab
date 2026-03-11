import { describe, it, expect } from 'vitest'
import { generateRecalls, type TabulationResult } from '@/lib/engine/recalls'

describe('generateRecalls (percentage-based)', () => {
  const results: TabulationResult[] = [
    { dancer_id: 'a', final_rank: 1, total_points: 200, individual_ranks: [] },
    { dancer_id: 'b', final_rank: 2, total_points: 180, individual_ranks: [] },
    { dancer_id: 'c', final_rank: 3, total_points: 160, individual_ranks: [] },
    { dancer_id: 'd', final_rank: 4, total_points: 140, individual_ranks: [] },
    { dancer_id: 'e', final_rank: 5, total_points: 120, individual_ranks: [] },
    { dancer_id: 'f', final_rank: 6, total_points: 100, individual_ranks: [] },
  ]

  it('recalls top 50% of dancers', () => {
    const recalled = generateRecalls(results, 50)
    expect(recalled).toHaveLength(3)
    expect(recalled.map(r => r.dancer_id)).toEqual(['a', 'b', 'c'])
  })

  it('rounds up recall count (ceil)', () => {
    const fiveResults = results.slice(0, 5)
    const recalled = generateRecalls(fiveResults, 50)
    expect(recalled).toHaveLength(3)
  })

  it('returns empty when percent is 0', () => {
    expect(generateRecalls(results, 0)).toEqual([])
  })

  it('includes tied dancers at the cutoff (tie-bubble expansion)', () => {
    const tiedResults: TabulationResult[] = [
      { dancer_id: 'a', final_rank: 1, total_points: 200, individual_ranks: [] },
      { dancer_id: 'b', final_rank: 2, total_points: 180, individual_ranks: [] },
      { dancer_id: 'c', final_rank: 3, total_points: 160, individual_ranks: [] },
      { dancer_id: 'd', final_rank: 3, total_points: 160, individual_ranks: [] },
      { dancer_id: 'e', final_rank: 5, total_points: 120, individual_ranks: [] },
      { dancer_id: 'f', final_rank: 6, total_points: 100, individual_ranks: [] },
    ]
    const recalled = generateRecalls(tiedResults, 50)
    expect(recalled).toHaveLength(4)
    expect(recalled.map(r => r.dancer_id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns all dancers when percent is 100', () => {
    const recalled = generateRecalls(results, 100)
    expect(recalled).toHaveLength(6)
  })

  it('handles empty results', () => {
    expect(generateRecalls([], 50)).toEqual([])
  })
})
