import { describe, it, expect } from 'vitest'
import { irishPointsForRank, averagePointsForTiedRanks } from '@/lib/engine/irish-points'

describe('irishPointsForRank', () => {
  it('returns 100 for 1st place', () => {
    expect(irishPointsForRank(1)).toBe(100)
  })

  it('returns 75 for 2nd place', () => {
    expect(irishPointsForRank(2)).toBe(75)
  })

  it('returns 65 for 3rd place', () => {
    expect(irishPointsForRank(3)).toBe(65)
  })

  it('returns 1 for 50th place', () => {
    expect(irishPointsForRank(50)).toBe(1)
  })

  it('returns 0 for ranks beyond 50', () => {
    expect(irishPointsForRank(51)).toBe(0)
    expect(irishPointsForRank(100)).toBe(0)
  })

  it('returns 0 for rank 0 or negative', () => {
    expect(irishPointsForRank(0)).toBe(0)
    expect(irishPointsForRank(-1)).toBe(0)
  })
})

describe('averagePointsForTiedRanks', () => {
  it('averages points for 2-way tie at 2nd/3rd', () => {
    // 2nd=75, 3rd=65 → average = 70
    expect(averagePointsForTiedRanks(2, 2)).toBe(70)
  })

  it('averages points for 3-way tie at 1st/2nd/3rd', () => {
    // 1st=100, 2nd=75, 3rd=65 → average = 80
    expect(averagePointsForTiedRanks(1, 3)).toBe(80)
  })

  it('returns exact points when no tie (count=1)', () => {
    expect(averagePointsForTiedRanks(1, 1)).toBe(100)
    expect(averagePointsForTiedRanks(5, 1)).toBe(56)
  })

  it('handles tie spanning beyond rank 50', () => {
    // Tie at 49th and 50th: 49th=2, 50th=1 → average = 1.5 → rounds to 2
    expect(averagePointsForTiedRanks(49, 2)).toBe(2)
  })

  it('handles tie entirely beyond rank 50', () => {
    expect(averagePointsForTiedRanks(51, 3)).toBe(0)
  })
})
