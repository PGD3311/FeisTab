import { type Anomaly, type ScoreEntry } from './types'

export function detectDuplicateScoreEntries(
  scores: ScoreEntry[],
  competition_id: string
): Anomaly[] {
  const seen = new Map<string, ScoreEntry>()
  const anomalies: Anomaly[] = []
  const reported = new Set<string>()

  for (const s of scores) {
    const key = `${s.round_id}|${s.judge_id}|${s.dancer_id}`
    if (seen.has(key) && !reported.has(key)) {
      reported.add(key)
      anomalies.push({
        type: 'duplicate_score_entry',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: {
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          round_id: s.round_id,
          competition_id,
        },
        message: `Duplicate score entry for dancer ${s.dancer_id} by judge ${s.judge_id} in round ${s.round_id}`,
        blocking: true,
        dedupe_key: `duplicate_score_entry|${s.round_id}|${s.judge_id}|${s.dancer_id}`,
      })
    }
    seen.set(key, s)
  }

  return anomalies
}
