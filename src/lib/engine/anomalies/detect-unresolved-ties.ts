import { type Anomaly, type ScoreEntry, type Registration } from './types'
import { tabulate, type ScoreInput } from '../tabulate'
import { type RuleSetConfig } from '../rules'
import { PRECISION } from '../constants'

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Flags final placings that are still tied after Irish Points + the configured
 * tie-breaker. Dancers with no placing (zero Irish Points, e.g. every score
 * flagged) are ignored — they share last place by design.
 */
export function detectUnresolvedTies(
  scores: ScoreEntry[],
  registrations: Registration[],
  rules: RuleSetConfig,
  round_id: string,
  competition_id: string
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  if (roundScores.length === 0) return []

  const scoreInputs: ScoreInput[] = roundScores.map(s => ({
    dancer_id: s.dancer_id,
    judge_id: s.judge_id,
    raw_score: s.raw_score,
    flagged: s.flagged,
  }))

  const byRank = new Map<number, string[]>()
  for (const r of tabulate(scoreInputs, rules)) {
    // Zero points = no placing (every score flagged, or ranked beyond the points table)
    if (Math.round(r.total_points * PRECISION) === 0) continue
    if (!byRank.has(r.final_rank)) byRank.set(r.final_rank, [])
    byRank.get(r.final_rank)!.push(r.dancer_id)
  }

  const numbers = new Map(registrations.map(r => [r.dancer_id, r.competitor_number]))
  const anomalies: Anomaly[] = []

  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  for (const rank of ranks) {
    const dancerIds = byRank.get(rank)!
    if (dancerIds.length < 2) continue

    const labels = dancerIds.map(id => {
      const num = numbers.get(id)
      return num ? `#${num}` : id
    })

    anomalies.push({
      type: 'unresolved_tie',
      severity: 'warning',
      scope: 'round',
      entity_ids: { round_id, competition_id, dancer_ids: dancerIds.join(',') },
      message: `Tie for ${ordinal(rank)} place between ${joinNames(labels)}`,
      blocking: false,
      dedupe_key: `unresolved_tie|${round_id}|${rank}`,
    })
  }

  return anomalies
}
