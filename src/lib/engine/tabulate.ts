import { type RuleSetConfig } from './rules'
import { rankByJudge } from './rank-judges'

export interface ScoreInput {
  dancer_id: string
  judge_id: string
  raw_score: number
  flagged?: boolean
}

export interface TabulationResult {
  dancer_id: string
  final_rank: number
  total_points: number
  individual_ranks: { judge_id: string; rank: number; irish_points: number }[]
}

// Defensive integer comparison: multiply totals by 1000 before comparing,
// in case future scoring changes introduce fractional points.
const PRECISION = 1000

/**
 * Tabulate competition results using Irish Points.
 *
 * Pipeline:
 * 1. Each judge's raw scores → rank dancers → convert to Irish Points
 * 2. Sum Irish Points across all judges per dancer
 * 3. Rank by total; break ties via countback (most 1st places, then 2nd, etc.)
 */
export function tabulate(
  scores: ScoreInput[],
  rules: RuleSetConfig
): TabulationResult[] {
  if (scores.length === 0) return []

  // Step 1: Get per-judge rankings with Irish Points
  const judgeRankings = rankByJudge(scores)

  // Step 2: Aggregate per dancer
  const dancerMap = new Map<string, {
    total: number
    ranks: { judge_id: string; rank: number; irish_points: number }[]
  }>()

  for (const [judgeId, rankings] of judgeRankings) {
    for (const r of rankings) {
      if (!dancerMap.has(r.dancer_id)) {
        dancerMap.set(r.dancer_id, { total: 0, ranks: [] })
      }
      const entry = dancerMap.get(r.dancer_id)!
      entry.total += r.irish_points
      entry.ranks.push({
        judge_id: judgeId,
        rank: r.rank,
        irish_points: r.irish_points,
      })
    }
  }

  // Build result array
  const aggregated: { result: TabulationResult; intTotal: number }[] = []
  for (const [dancer_id, data] of dancerMap) {
    aggregated.push({
      result: {
        dancer_id,
        final_rank: 0,
        total_points: data.total,
        individual_ranks: data.ranks,
      },
      intTotal: Math.round(data.total * PRECISION),
    })
  }

  // Step 3: Sort by total (descending), then countback tie-breaker
  aggregated.sort((a, b) => {
    if (b.intTotal !== a.intTotal) return b.intTotal - a.intTotal

    if (rules.tie_breaker === 'countback') {
      return resolveCountback(a.result, b.result)
    }

    return 0
  })

  // Assign ranks (tied dancers share rank)
  for (let i = 0; i < aggregated.length; i++) {
    if (i === 0) {
      aggregated[i].result.final_rank = 1
    } else {
      const prev = aggregated[i - 1]
      const curr = aggregated[i]

      let tied = curr.intTotal === prev.intTotal
      if (tied && rules.tie_breaker === 'countback') {
        tied = resolveCountback(prev.result, curr.result) === 0
      }

      aggregated[i].result.final_rank = tied
        ? prev.result.final_rank
        : i + 1
    }
  }

  return aggregated.map(a => a.result)
}

/**
 * Countback tie-breaker: compare dancers by number of 1st-place ranks,
 * then 2nd-place ranks, etc. Returns negative if a wins, positive if b wins,
 * 0 if still tied.
 */
export function resolveCountback(a: TabulationResult, b: TabulationResult): number {
  const maxRank = Math.max(
    ...a.individual_ranks.map(r => r.rank),
    ...b.individual_ranks.map(r => r.rank),
    0
  )

  for (let rank = 1; rank <= maxRank; rank++) {
    const aCount = a.individual_ranks.filter(r => r.rank === rank).length
    const bCount = b.individual_ranks.filter(r => r.rank === rank).length
    if (bCount !== aCount) return bCount - aCount
  }

  return 0
}
