import { type TabulationResult } from '@/lib/engine/tabulate'
import { type RuleSetConfig } from '@/lib/engine/rules'
import { PRECISION } from '@/lib/engine/constants'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JudgeScore {
  judge_id: string
  judge_name: string
  raw_score: number | null
  rank: number
  irish_points: number
  flagged?: boolean
  flag_reason?: string
}

export interface CalculatedPayload {
  total_points: number
  individual_ranks: { judge_id: string; rank: number; irish_points: number }[]
  judge_scores: JudgeScore[]
  rules_snapshot: RuleSetConfig
  tie_break_applied: boolean
  tie_break_note: string | null
  drop_applied: false
  drop_note: null
}

// ── Internal types for function parameters ────────────────────────────────────

interface Judge {
  id: string
  first_name: string
  last_name: string
}

interface ScoreEntry {
  dancer_id: string
  judge_id: string
  raw_score: number
  flagged?: boolean
  flag_reason?: string | null
}

// PRECISION imported from engine/constants.ts

// ── buildJudgeScores ──────────────────────────────────────────────────────────

/**
 * Enriches each entry in result.individual_ranks with the judge's display name
 * and the dancer's raw score from that judge. Flagged scores carry their flag
 * fields; unflagged scores omit them entirely.
 */
export function buildJudgeScores(
  result: TabulationResult,
  judges: Judge[],
  scores: ScoreEntry[]
): JudgeScore[] {
  return result.individual_ranks.map(ir => {
    const judge = judges.find(j => j.id === ir.judge_id)
    const score = scores.find(s => s.dancer_id === result.dancer_id && s.judge_id === ir.judge_id)

    const judgeName = judge ? `${judge.first_name} ${judge.last_name}` : 'Judge (unknown)'
    const rawScore = score ? Number(score.raw_score) : null

    return {
      judge_id: ir.judge_id,
      judge_name: judgeName,
      raw_score: rawScore,
      rank: ir.rank,
      irish_points: ir.irish_points,
      ...(score?.flagged ? { flagged: true, flag_reason: score.flag_reason ?? undefined } : {}),
    }
  })
}

// ── detectTieBreak ────────────────────────────────────────────────────────────

/**
 * Inspects all results to find dancers who shared the same total_points.
 * When they resolved to different final_ranks, countback was applied.
 * When they share a final_rank, it is a true tie that countback could not break.
 *
 * Returns:
 *   applied — true if countback differentiated at least one pair
 *   notes   — Map<dancer_id, human-readable note>
 */
export function detectTieBreak(
  results: TabulationResult[]
): { applied: boolean; notes: Map<string, string> } {
  const notes = new Map<string, string>()
  let applied = false

  // Group dancers by integer total to find ties
  const byTotal = new Map<number, TabulationResult[]>()
  for (const r of results) {
    const key = Math.round(r.total_points * PRECISION)
    const group = byTotal.get(key) ?? []
    group.push(r)
    byTotal.set(key, group)
  }

  for (const group of byTotal.values()) {
    if (group.length < 2) continue

    // Check all pairs within the group
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]

        if (a.final_rank === b.final_rank) {
          // True tie — countback could not resolve
          const note = 'Tied — countback could not resolve'
          notes.set(a.dancer_id, note)
          notes.set(b.dancer_id, note)
        } else {
          // Countback was applied — determine winner and loser
          applied = true
          const winner = a.final_rank < b.final_rank ? a : b
          const loser = a.final_rank < b.final_rank ? b : a

          const { rankLevel, winnerCount, loserCount } = findDifferentiatingRank(winner, loser)
          const rankLabel = ordinalLabel(rankLevel)

          notes.set(
            winner.dancer_id,
            `Won countback: ${winnerCount} ${rankLabel} vs ${loserCount} ${rankLabel}`
          )
          notes.set(
            loser.dancer_id,
            `Lost countback: ${loserCount} ${rankLabel} vs ${winnerCount} ${rankLabel}`
          )
        }
      }
    }
  }

  return { applied, notes }
}

/**
 * Finds the lowest rank level where winner has more placements than loser.
 * Falls back to rank 1 if no differentiation found (shouldn't happen after
 * countback correctly resolved).
 */
function findDifferentiatingRank(
  winner: TabulationResult,
  loser: TabulationResult
): { rankLevel: number; winnerCount: number; loserCount: number } {
  const maxRank = Math.max(
    ...winner.individual_ranks.map(r => r.rank),
    ...loser.individual_ranks.map(r => r.rank),
    1
  )

  for (let rank = 1; rank <= maxRank; rank++) {
    const winnerCount = winner.individual_ranks.filter(r => r.rank === rank).length
    const loserCount = loser.individual_ranks.filter(r => r.rank === rank).length
    if (winnerCount !== loserCount) {
      return { rankLevel: rank, winnerCount, loserCount }
    }
  }

  // Fallback — should not occur after a resolved countback
  return { rankLevel: 1, winnerCount: 0, loserCount: 0 }
}

/** Returns the plural label for a rank position (e.g. 1 → "firsts", 2 → "seconds"). */
function ordinalLabel(rank: number): string {
  const labels: Record<number, string> = {
    1: 'firsts',
    2: 'seconds',
    3: 'thirds',
    4: 'fourths',
    5: 'fifths',
  }
  return labels[rank] ?? `${rank}th-places`
}

// ── buildCalculatedPayload ────────────────────────────────────────────────────

/**
 * Combines buildJudgeScores and detectTieBreak into a single explainability
 * payload for a single dancer's result. drop_applied and drop_note are always
 * false/null in Phase 1 (drop rules are not yet implemented).
 */
export function buildCalculatedPayload(
  result: TabulationResult,
  judges: Judge[],
  scores: ScoreEntry[],
  allResults: TabulationResult[],
  rules: RuleSetConfig
): CalculatedPayload {
  const judgeScores = buildJudgeScores(result, judges, scores)
  const { applied, notes } = detectTieBreak(allResults)

  return {
    total_points: result.total_points,
    individual_ranks: result.individual_ranks,
    judge_scores: judgeScores,
    rules_snapshot: rules,
    tie_break_applied: applied,
    tie_break_note: notes.get(result.dancer_id) ?? null,
    drop_applied: false,
    drop_note: null,
  }
}

// ── formatRulesFooter ─────────────────────────────────────────────────────────

/**
 * Returns a human-readable summary of the scoring rules for display in
 * results footers and explainability panels.
 *
 * Example: "Irish Points scoring (1st=100, 2nd=75, 3rd=65...) · Score range: 0–100"
 */
export function formatRulesFooter(rulesSnapshot: RuleSetConfig): string {
  return (
    `Irish Points scoring (1st=100, 2nd=75, 3rd=65...) · ` +
    `Score range: ${rulesSnapshot.score_min}–${rulesSnapshot.score_max}`
  )
}
