import { type Anomaly, type ScoreEntry, type Registration, NON_ACTIVE_STATUSES } from './types'

const EXPLAINED_STATUSES = new Set(NON_ACTIVE_STATUSES)

export function detectUnexplainedNoScores(
  scores: ScoreEntry[],
  registrations: Registration[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const scoredDancerIds = new Set(roundScores.map(s => s.dancer_id))
  const anomalies: Anomaly[] = []

  for (const reg of registrations) {
    if (!scoredDancerIds.has(reg.dancer_id) && !EXPLAINED_STATUSES.has(reg.status)) {
      anomalies.push({
        type: 'unexplained_no_scores',
        severity: 'warning',
        scope: 'dancer',
        entity_ids: { dancer_id: reg.dancer_id, round_id, competition_id },
        message: `Dancer ${reg.dancer_id} is registered (status: ${reg.status}) but has no scores and no explanation`,
        blocking: false,
        dedupe_key: `unexplained_no_scores|${round_id}|${reg.dancer_id}`,
      })
    }
  }

  return anomalies
}
