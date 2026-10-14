export type { Anomaly, AnomalyType, AnomalyInput, ScoreEntry, Registration, Round, StoredResult } from './types'

import { type Anomaly, type AnomalyInput, NON_ACTIVE_STATUSES } from './types'
import { detectDuplicateScoreEntries } from './detect-duplicate-entries'
import { detectScoresForNonRosterDancers } from './detect-non-roster-scores'
import { detectMissingRequiredScores } from './detect-missing-scores'
import { detectIncompleteJudgePackets } from './detect-incomplete-packets'
import { detectInvalidScoringReason } from './detect-invalid-scoring-reason'
import { detectRecallMismatch } from './detect-recall-mismatch'
import { detectNonReproducibleResults } from './detect-non-reproducible'
import { detectUnexplainedNoScores } from './detect-unexplained-no-scores'
import { detectStatusScoreMismatch } from './detect-status-score-mismatch'
import { detectLargeScoreSpread } from './detect-score-spread'
import { detectJudgeFlaggedAll } from './detect-judge-flagged-all'
import { detectJudgeFlatScores } from './detect-judge-flat-scores'
import { detectUnresolvedTies } from './detect-unresolved-ties'
import { getRoundRoster, roundNeedsRecalls } from '../recalls'

const SCORE_SPREAD_THRESHOLD = 30

export function detectAnomalies(input: AnomalyInput): Anomaly[] {
  const { competition_id, scores, registrations, rounds, judge_ids, results, rules, recalls } = input
  const anomalies: Anomaly[] = []

  // === COMPETITION-WIDE CHECKS (run once, not per round) ===
  anomalies.push(...detectDuplicateScoreEntries(scores, competition_id))
  anomalies.push(...detectScoresForNonRosterDancers(scores, registrations, competition_id))
  anomalies.push(...detectInvalidScoringReason(scores, competition_id))
  anomalies.push(...detectNonReproducibleResults(scores, results, rounds[rounds.length - 1]?.id ?? '', competition_id))

  // === ROUND-SCOPED CHECKS (run per round) ===
  for (const round of rounds) {
    // A recall round is danced only by the recalled dancers
    const roundRegistrations = getRoundRoster(registrations, round, recalls)
    const activeDancerCount = roundRegistrations.filter(
      r => !NON_ACTIVE_STATUSES.includes(r.status)
    ).length
    const roundRecalls = recalls.filter(rc => rc.round_id === round.id)

    // Integrity blockers
    if (roundRegistrations !== registrations) {
      const roundScores = scores.filter(s => s.round_id === round.id)
      anomalies.push(
        ...detectScoresForNonRosterDancers(roundScores, roundRegistrations, competition_id).map(a => ({
          ...a,
          message: `Score exists for dancer ${a.entity_ids.dancer_id} who was not recalled for this round`,
        }))
      )
    }
    anomalies.push(...detectMissingRequiredScores(scores, roundRegistrations, judge_ids, round.id, competition_id))
    anomalies.push(...detectIncompleteJudgePackets(scores, roundRegistrations, judge_ids, round.id, competition_id))

    // Rules blockers — only championship rounds that feed a recall round
    if (roundNeedsRecalls(rules.recall_top_percent, round.round_type)) {
      anomalies.push(...detectRecallMismatch(roundRecalls, activeDancerCount, rules.recall_top_percent, round.id, competition_id))
    }

    // Warnings
    anomalies.push(...detectUnexplainedNoScores(scores, roundRegistrations, round.id, competition_id))
    anomalies.push(...detectStatusScoreMismatch(scores, roundRegistrations, round.id, competition_id))
    anomalies.push(...detectUnresolvedTies(scores, roundRegistrations, rules, round.id, competition_id))

    // Review signals
    anomalies.push(...detectLargeScoreSpread(scores, round.id, competition_id, SCORE_SPREAD_THRESHOLD))
    anomalies.push(...detectJudgeFlaggedAll(scores, round.id, competition_id))
    anomalies.push(...detectJudgeFlatScores(scores, round.id, competition_id))
  }

  return anomalies
}
