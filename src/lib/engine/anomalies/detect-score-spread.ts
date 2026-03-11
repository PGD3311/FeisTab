import { type Anomaly, type ScoreEntry } from './types'

export function detectLargeScoreSpread(
  scores: ScoreEntry[],
  round_id: string,
  competition_id: string,
  threshold: number
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const anomalies: Anomaly[] = []

  const byDancer = new Map<string, number[]>()
  for (const s of roundScores) {
    if (!byDancer.has(s.dancer_id)) byDancer.set(s.dancer_id, [])
    byDancer.get(s.dancer_id)!.push(s.raw_score)
  }

  for (const [dancer_id, dancerScores] of byDancer) {
    if (dancerScores.length < 2) continue
    const spread = Math.max(...dancerScores) - Math.min(...dancerScores)
    if (spread > threshold) {
      anomalies.push({
        type: 'large_score_spread',
        severity: 'info',
        scope: 'dancer',
        entity_ids: { dancer_id, round_id, competition_id },
        message: `Score spread of ${spread} points across judges for dancer ${dancer_id} (threshold: ${threshold})`,
        blocking: false,
        dedupe_key: `large_score_spread|${round_id}|${dancer_id}`,
      })
    }
  }

  return anomalies
}
