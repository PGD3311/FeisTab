import { type Anomaly, type ScoreEntry, type Registration } from './types'

export function detectMissingRequiredScores(
  scores: ScoreEntry[],
  registrations: Registration[],
  judge_ids: string[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  if (judge_ids.length === 0) return []

  const roundScores = scores.filter(s => s.round_id === round_id)
  const anomalies: Anomaly[] = []

  const dancerJudges = new Map<string, Set<string>>()
  for (const s of roundScores) {
    if (!dancerJudges.has(s.dancer_id)) dancerJudges.set(s.dancer_id, new Set())
    dancerJudges.get(s.dancer_id)!.add(s.judge_id)
  }

  const registeredIds = new Set(registrations.map(r => r.dancer_id))
  for (const [dancer_id, judges] of dancerJudges) {
    if (!registeredIds.has(dancer_id)) continue
    if (judges.size > 0 && judges.size < judge_ids.length) {
      const missing = judge_ids.filter(j => !judges.has(j))
      anomalies.push({
        type: 'missing_required_score',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: { dancer_id, round_id, competition_id },
        message: `Dancer ${dancer_id} is missing scores from ${missing.length} judge(s): ${missing.join(', ')}`,
        blocking: true,
        dedupe_key: `missing_required_score|${round_id}|${dancer_id}`,
      })
    }
  }

  return anomalies
}
