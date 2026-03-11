import { type ScoreInput } from './tabulate'
import { averagePointsForTiedRanks } from './irish-points'

export interface JudgeRanking {
  dancer_id: string
  rank: number
  irish_points: number
}

/**
 * For each judge, rank all dancers by raw_score descending.
 * Tied raw scores share the same rank; Irish Points are averaged
 * across the tied positions. Flagged scores get rank=last and 0 points.
 *
 * Returns a Map of judge_id → JudgeRanking[]
 */
export function rankByJudge(
  scores: ScoreInput[]
): Map<string, JudgeRanking[]> {
  // Group by judge
  const byJudge = new Map<string, ScoreInput[]>()
  for (const s of scores) {
    if (!byJudge.has(s.judge_id)) byJudge.set(s.judge_id, [])
    byJudge.get(s.judge_id)!.push(s)
  }

  const result = new Map<string, JudgeRanking[]>()

  for (const [judgeId, judgeScores] of byJudge) {
    // Separate flagged and unflagged
    const unflagged = judgeScores.filter(s => !s.flagged)
    const flagged = judgeScores.filter(s => s.flagged)

    // Sort unflagged by raw_score descending
    unflagged.sort((a, b) => b.raw_score - a.raw_score)

    const rankings: JudgeRanking[] = []

    // Assign ranks with tie handling
    let i = 0
    while (i < unflagged.length) {
      const tiedStart = i
      while (
        i < unflagged.length &&
        unflagged[i].raw_score === unflagged[tiedStart].raw_score
      ) {
        i++
      }
      const tiedCount = i - tiedStart
      const rank = tiedStart + 1
      const points = averagePointsForTiedRanks(rank, tiedCount)

      for (let j = tiedStart; j < i; j++) {
        rankings.push({
          dancer_id: unflagged[j].dancer_id,
          rank,
          irish_points: points,
        })
      }
    }

    // Flagged dancers get 0 points
    for (const s of flagged) {
      rankings.push({
        dancer_id: s.dancer_id,
        rank: unflagged.length + 1,
        irish_points: 0,
      })
    }

    result.set(judgeId, rankings)
  }

  return result
}
