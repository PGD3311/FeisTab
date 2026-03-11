import { type Anomaly, type ScoreEntry, type Registration, NON_ACTIVE_STATUSES } from './types'

export function detectIncompleteJudgePackets(
  scores: ScoreEntry[],
  registrations: Registration[],
  judge_ids: string[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  if (judge_ids.length === 0 || registrations.length === 0) return []

  const roundScores = scores.filter(s => s.round_id === round_id)
  const activeDancerIds = new Set(
    registrations
      .filter(r => !NON_ACTIVE_STATUSES.includes(r.status))
      .map(r => r.dancer_id)
  )
  if (activeDancerIds.size === 0) return []
  const anomalies: Anomaly[] = []

  const judgeDancers = new Map<string, Set<string>>()
  for (const jid of judge_ids) judgeDancers.set(jid, new Set())
  for (const s of roundScores) {
    judgeDancers.get(s.judge_id)?.add(s.dancer_id)
  }

  for (const [judge_id, scoredDancers] of judgeDancers) {
    const missing = [...activeDancerIds].filter(d => !scoredDancers.has(d))
    if (missing.length > 0) {
      anomalies.push({
        type: 'incomplete_judge_packet',
        severity: 'blocker',
        scope: 'judge_packet',
        entity_ids: { judge_id, round_id, competition_id },
        message: `Judge ${judge_id} has not scored ${missing.length} of ${activeDancerIds.size} active dancers`,
        blocking: true,
        dedupe_key: `incomplete_judge_packet|${round_id}|${judge_id}`,
      })
    }
  }

  return anomalies
}
