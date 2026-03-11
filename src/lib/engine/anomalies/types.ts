// src/lib/engine/anomalies/types.ts

import { type RuleSetConfig } from '../rules'

export type AnomalyType =
  | 'duplicate_score_entry'
  | 'score_for_non_roster_dancer'
  | 'missing_required_score'
  | 'incomplete_judge_packet'
  | 'invalid_scoring_reason'
  | 'recall_mismatch'
  | 'non_reproducible_results'
  | 'unexplained_no_scores'
  | 'status_score_mismatch'
  | 'large_score_spread'
  | 'judge_flagged_all'
  | 'judge_flat_scores'

export interface Anomaly {
  type: AnomalyType
  severity: 'blocker' | 'warning' | 'info'
  scope: 'competition' | 'round' | 'judge_packet' | 'dancer'
  entity_ids: Record<string, string>
  message: string
  blocking: boolean
  dedupe_key: string
}

export interface ScoreEntry {
  id: string
  round_id: string
  competition_id: string
  dancer_id: string
  judge_id: string
  raw_score: number
  flagged: boolean
  flag_reason: string | null
}

export type RegistrationStatus =
  | 'registered' | 'checked_in' | 'present' | 'scratched'
  | 'no_show' | 'danced' | 'recalled' | 'disqualified'
  | 'finalized' | 'did_not_complete' | 'medical'

export type StatusReason =
  | 'withdrawn' | 'absent' | 'disqualified' | 'did_not_complete'
  | 'medical' | 'admin_hold' | 'other'

/** Statuses that mean the dancer should NOT have scores */
export const NON_ACTIVE_STATUSES: RegistrationStatus[] = [
  'scratched', 'no_show', 'disqualified', 'did_not_complete', 'medical',
]

export interface Registration {
  id: string
  dancer_id: string
  competition_id: string
  competitor_number: string | null
  status: RegistrationStatus
  status_reason: StatusReason | null
}

export interface Round {
  id: string
  competition_id: string
  round_number: number
  round_type: string
  judge_sign_offs: Record<string, string>
}

export interface StoredResult {
  dancer_id: string
  final_rank: number
  calculated_payload: {
    total_points: number
    individual_ranks: { judge_id: string; rank: number; irish_points: number }[]
    rules_snapshot?: RuleSetConfig
  }
}

export interface AnomalyInput {
  competition_id: string
  scores: ScoreEntry[]
  registrations: Registration[]
  rounds: Round[]
  judge_ids: string[]
  results: StoredResult[]
  rules: RuleSetConfig
  recalls: { dancer_id: string; round_id: string }[]
}
