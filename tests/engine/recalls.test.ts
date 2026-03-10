import { describe, it, expect } from 'vitest'
import { generateRecalls, type TabulationResult } from '@/lib/engine/recalls'

describe('generateRecalls', () => {
  const results: TabulationResult[] = [
    { dancer_id: 'a', final_rank: 1, average_score: 95, individual_scores: [95], highest_individual: 95 },
    { dancer_id: 'b', final_rank: 2, average_score: 90, individual_scores: [90], highest_individual: 90 },
    { dancer_id: 'c', final_rank: 3, average_score: 85, individual_scores: [85], highest_individual: 85 },
    { dancer_id: 'd', final_rank: 4, average_score: 80, individual_scores: [80], highest_individual: 80 },
    { dancer_id: 'e', final_rank: 5, average_score: 75, individual_scores: [75], highest_individual: 75 },
  ]

  it('recalls top N dancers', () => {
    const recalled = generateRecalls(results, 3)
    expect(recalled).toHaveLength(3)
    expect(recalled.map(r => r.dancer_id)).toEqual(['a', 'b', 'c'])
  })

  it('returns empty when recall_top_n is 0', () => {
    expect(generateRecalls(results, 0)).toEqual([])
  })

  it('includes tied dancers at the cutoff', () => {
    const tiedResults: TabulationResult[] = [
      { dancer_id: 'a', final_rank: 1, average_score: 95, individual_scores: [95], highest_individual: 95 },
      { dancer_id: 'b', final_rank: 2, average_score: 90, individual_scores: [90], highest_individual: 90 },
      { dancer_id: 'c', final_rank: 2, average_score: 90, individual_scores: [90], highest_individual: 90 },
      { dancer_id: 'd', final_rank: 4, average_score: 80, individual_scores: [80], highest_individual: 80 },
    ]
    // Recall top 2 — but b and c are tied at rank 2, so include both
    const recalled = generateRecalls(tiedResults, 2)
    expect(recalled).toHaveLength(3)
    expect(recalled.map(r => r.dancer_id)).toEqual(['a', 'b', 'c'])
  })
})
