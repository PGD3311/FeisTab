import { VALID_FLAG_REASON_VALUES } from '../flag-reasons'
import { type Anomaly, type ScoreEntry } from './types'

export function detectInvalidScoringReason(
  scores: ScoreEntry[],
  competition_id: string
): Anomaly[] {
  const anomalies: Anomaly[] = []

  for (const s of scores) {
    const hasFlag = s.flagged
    const hasReason = s.flag_reason !== null && s.flag_reason.trim() !== ''
    const hasValidReason =
      hasReason && VALID_FLAG_REASON_VALUES.has(s.flag_reason!.trim() as string)
    const isZero = s.raw_score === 0

    if (hasFlag && !hasReason) {
      anomalies.push({
        type: 'invalid_scoring_reason',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: {
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          round_id: s.round_id,
          competition_id,
        },
        message: `Score for dancer ${s.dancer_id} is flagged but has no reason specified`,
        blocking: true,
        dedupe_key: `invalid_scoring_reason|${s.round_id}|${s.judge_id}|${s.dancer_id}|flagged`,
      })
    }

    if (hasFlag && hasReason && !hasValidReason) {
      anomalies.push({
        type: 'invalid_scoring_reason',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: {
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          round_id: s.round_id,
          competition_id,
        },
        message: `Score for dancer ${s.dancer_id} has unrecognized flag reason "${s.flag_reason}"`,
        blocking: true,
        dedupe_key: `invalid_scoring_reason|${s.round_id}|${s.judge_id}|${s.dancer_id}|invalid_reason`,
      })
    }

    if (isZero && !hasFlag) {
      anomalies.push({
        type: 'invalid_scoring_reason',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: {
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          round_id: s.round_id,
          competition_id,
        },
        message: `Score of 0 for dancer ${s.dancer_id} without a flag or reason — is this a penalty, error, or did-not-complete?`,
        blocking: true,
        dedupe_key: `invalid_scoring_reason|${s.round_id}|${s.judge_id}|${s.dancer_id}|zero`,
      })
    }
  }

  return anomalies
}
