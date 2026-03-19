import { type Anomaly, type ScoreEntry, type Registration, NON_ACTIVE_STATUSES } from './types'

const SHOULD_NOT_HAVE_SCORES = new Set(NON_ACTIVE_STATUSES)

export function detectStatusScoreMismatch(
  scores: ScoreEntry[],
  registrations: Registration[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const scoredDancerIds = new Set(roundScores.map(s => s.dancer_id))
  const anomalies: Anomaly[] = []

  for (const reg of registrations) {
    if (scoredDancerIds.has(reg.dancer_id) && SHOULD_NOT_HAVE_SCORES.has(reg.status)) {
      anomalies.push({
        type: 'status_score_mismatch',
        severity: 'warning',
        scope: 'dancer',
        entity_ids: { dancer_id: reg.dancer_id, round_id, competition_id },
        message: `Dancer ${reg.dancer_id} is marked "${reg.status}" but has score entries`,
        blocking: false,
        dedupe_key: `status_score_mismatch|${round_id}|${reg.dancer_id}`,
      })
    }
  }

  return anomalies
}
