// Standard Irish Points table: rank → points
// 1st=100, 2nd=75, 3rd=65, then decreasing pattern down to 50th=1
const IRISH_POINTS_TABLE: number[] = [
  0,   // index 0 (unused — ranks are 1-based)
  100, // 1st
  75,  // 2nd
  65,  // 3rd
  60,  // 4th
  56,  // 5th
  53,  // 6th
  50,  // 7th
  47,  // 8th
  45,  // 9th
  43,  // 10th
  41, 39, 38, 37, 36, 35, 34, 33, 32, 31, // 11th–20th
  30, 29, 28, 27, 26, 25, 24, 23, 22, 21, // 21st–30th
  20, 19, 18, 17, 16, 15, 14, 13, 12, 11, // 31st–40th
  10, 9, 8, 7, 6, 5, 4, 3, 2, 1,          // 41st–50th
]

/**
 * Look up Irish Points for a given rank.
 * Ranks 1–50 return points per the standard table. Ranks beyond 50 return 0.
 */
export function irishPointsForRank(rank: number): number {
  if (rank < 1 || rank > 50) return 0
  return IRISH_POINTS_TABLE[rank]
}

/**
 * When dancers tie for a rank, they share the average of the Irish Points
 * for the positions they span. E.g., 2-way tie at rank 2 averages
 * points for positions 2 and 3.
 *
 * Irish Points are integers, so simple rounding suffices.
 */
export function averagePointsForTiedRanks(startRank: number, tiedCount: number): number {
  if (tiedCount <= 0 || startRank < 1) return 0

  let sum = 0
  for (let i = 0; i < tiedCount; i++) {
    sum += irishPointsForRank(startRank + i)
  }

  return Math.round(sum / tiedCount)
}
