import { type Anomaly } from './types'

export function detectRecallMismatch(
  recalls: { dancer_id: string; round_id: string }[],
  totalDancers: number,
  recallTopPercent: number,
  round_id: string,
  competition_id: string
): Anomaly[] {
  if (recallTopPercent <= 0) return []
  if (recalls.length === 0 && totalDancers === 0) return []

  const expectedCount = Math.ceil((totalDancers * recallTopPercent) / 100)
  const actualCount = recalls.length

  if (actualCount < expectedCount) {
    return [
      {
        type: 'recall_mismatch',
        severity: 'info',
        scope: 'round',
        entity_ids: { round_id, competition_id },
        message: `Recalls not generated: ${actualCount} of ${expectedCount} expected (${recallTopPercent}% of ${totalDancers}). Generate recalls if this is a championship competition.`,
        blocking: false,
        dedupe_key: `recall_mismatch|${round_id}`,
      },
    ]
  }

  return []
}
