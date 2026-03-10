import { type RuleSetConfig } from './rules'

export interface ScoreInput {
  dancer_id: string
  judge_id: string
  raw_score: number
}

export interface TabulationResult {
  dancer_id: string
  final_rank: number
  average_score: number
  individual_scores: number[]
  highest_individual: number
}

// Precision multiplier — all math done in integer thousandths
const PRECISION = 1000

function toInt(n: number): number {
  return Math.round(n * PRECISION)
}

function fromInt(n: number): number {
  return n / PRECISION
}

export function tabulate(
  scores: ScoreInput[],
  rules: RuleSetConfig
): TabulationResult[] {
  if (scores.length === 0) return []

  // Group scores by dancer
  const byDancer = new Map<string, number[]>()
  for (const s of scores) {
    if (!byDancer.has(s.dancer_id)) byDancer.set(s.dancer_id, [])
    byDancer.get(s.dancer_id)!.push(s.raw_score)
  }

  // Calculate aggregates using integer math
  const aggregated: { result: TabulationResult; intAvg: number; intHighest: number }[] = []
  for (const [dancer_id, rawScores] of byDancer) {
    let sorted = [...rawScores].sort((a, b) => a - b)

    // Drop high and low simultaneously — only if enough scores remain
    const dropCount = (rules.drop_low ? 1 : 0) + (rules.drop_high ? 1 : 0)
    if (dropCount > 0 && sorted.length > dropCount) {
      if (rules.drop_low) sorted = sorted.slice(1)
      if (rules.drop_high) sorted = sorted.slice(0, -1)
    }

    // Integer arithmetic for aggregate
    const intScores = sorted.map(toInt)
    const intSum = intScores.reduce((a, b) => a + b, 0)
    const intAvg = rules.aggregation === 'sum'
      ? intSum
      : Math.round(intSum / sorted.length)

    const intHighest = toInt(Math.max(...sorted))

    aggregated.push({
      result: {
        dancer_id,
        final_rank: 0,
        average_score: fromInt(intAvg),
        individual_scores: rawScores,
        highest_individual: Math.max(...sorted),
      },
      intAvg,
      intHighest,
    })
  }

  // Tie-breaker is only applied when no drop rules are active.
  // When drops are in effect, a tied average is a true tie regardless of individual scores.
  const dropRulesActive = rules.drop_high || rules.drop_low

  // Sort: highest average first, then tie-break (all comparisons on integers)
  aggregated.sort((a, b) => {
    if (b.intAvg !== a.intAvg) return b.intAvg - a.intAvg
    if (!dropRulesActive && rules.tie_breaker === 'highest_individual') {
      return b.intHighest - a.intHighest
    }
    return 0
  })

  // Assign ranks (tied dancers get same rank)
  for (let i = 0; i < aggregated.length; i++) {
    if (i === 0) {
      aggregated[i].result.final_rank = 1
    } else {
      const prev = aggregated[i - 1]
      const curr = aggregated[i]
      const tied =
        curr.intAvg === prev.intAvg &&
        (dropRulesActive ||
          rules.tie_breaker !== 'highest_individual' ||
          curr.intHighest === prev.intHighest)
      aggregated[i].result.final_rank = tied ? prev.result.final_rank : i + 1
    }
  }

  return aggregated.map(a => a.result)
}
