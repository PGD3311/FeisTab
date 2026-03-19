import { type Anomaly, type ScoreEntry } from './types'

export function detectJudgeFlatScores(
  scores: ScoreEntry[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const anomalies: Anomaly[] = []

  const byJudge = new Map<string, number[]>()
  for (const s of roundScores) {
    if (!byJudge.has(s.judge_id)) byJudge.set(s.judge_id, [])
    byJudge.get(s.judge_id)!.push(s.raw_score)
  }

  for (const [judge_id, judgeScores] of byJudge) {
    if (judgeScores.length < 3) continue
    const unique = new Set(judgeScores)
    if (unique.size === 1) {
      anomalies.push({
        type: 'judge_flat_scores',
        severity: 'info',
        scope: 'judge_packet',
        entity_ids: { judge_id, round_id, competition_id },
        message: `Judge ${judge_id} gave identical score (${judgeScores[0]}) to all ${judgeScores.length} dancers`,
        blocking: false,
        dedupe_key: `judge_flat_scores|${round_id}|${judge_id}`,
      })
    }
  }

  return anomalies
}
