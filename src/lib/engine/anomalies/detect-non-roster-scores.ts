import { type Anomaly, type ScoreEntry, type Registration } from './types'

export function detectScoresForNonRosterDancers(
  scores: ScoreEntry[],
  registrations: Registration[],
  competition_id: string
): Anomaly[] {
  const registeredDancerIds = new Set(registrations.map(r => r.dancer_id))
  const reported = new Set<string>()
  const anomalies: Anomaly[] = []

  for (const s of scores) {
    if (!registeredDancerIds.has(s.dancer_id) && !reported.has(s.dancer_id)) {
      reported.add(s.dancer_id)
      anomalies.push({
        type: 'score_for_non_roster_dancer',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: {
          dancer_id: s.dancer_id,
          round_id: s.round_id,
          competition_id,
        },
        message: `Score exists for dancer ${s.dancer_id} who is not registered in this competition`,
        blocking: true,
        dedupe_key: `score_for_non_roster_dancer|${s.round_id}|${s.dancer_id}`,
      })
    }
  }

  return anomalies
}
