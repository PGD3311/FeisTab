import { type Anomaly, type ScoreEntry } from './types'

export function detectJudgeFlaggedAll(
  scores: ScoreEntry[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const anomalies: Anomaly[] = []

  const byJudge = new Map<string, ScoreEntry[]>()
  for (const s of roundScores) {
    if (!byJudge.has(s.judge_id)) byJudge.set(s.judge_id, [])
    byJudge.get(s.judge_id)!.push(s)
  }

  for (const [judge_id, judgeScores] of byJudge) {
    if (judgeScores.length < 2) continue
    if (judgeScores.every(s => s.flagged)) {
      anomalies.push({
        type: 'judge_flagged_all',
        severity: 'info',
        scope: 'judge_packet',
        entity_ids: { judge_id, round_id, competition_id },
        message: `Judge ${judge_id} flagged all ${judgeScores.length} dancers in this round`,
        blocking: false,
        dedupe_key: `judge_flagged_all|${round_id}|${judge_id}`,
      })
    }
  }

  return anomalies
}
