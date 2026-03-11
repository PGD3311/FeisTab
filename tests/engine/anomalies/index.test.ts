import { describe, it, expect } from 'vitest'
import { detectAnomalies } from '@/lib/engine/anomalies'
import { type AnomalyInput } from '@/lib/engine/anomalies/types'
import { DEFAULT_RULES } from '@/lib/engine/rules'

const cleanInput: AnomalyInput = {
  competition_id: 'c1',
  scores: [
    { id: '1', round_id: 'r1', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j1', raw_score: 80, flagged: false, flag_reason: null },
    { id: '2', round_id: 'r1', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j2', raw_score: 85, flagged: false, flag_reason: null },
    { id: '3', round_id: 'r1', competition_id: 'c1', dancer_id: 'd2', judge_id: 'j1', raw_score: 70, flagged: false, flag_reason: null },
    { id: '4', round_id: 'r1', competition_id: 'c1', dancer_id: 'd2', judge_id: 'j2', raw_score: 75, flagged: false, flag_reason: null },
  ],
  registrations: [
    { id: 'r1', dancer_id: 'd1', competition_id: 'c1', competitor_number: '101', status: 'registered', status_reason: null },
    { id: 'r2', dancer_id: 'd2', competition_id: 'c1', competitor_number: '102', status: 'registered', status_reason: null },
  ],
  rounds: [{ id: 'r1', competition_id: 'c1', round_number: 1, round_type: 'standard', judge_sign_offs: {} }],
  judge_ids: ['j1', 'j2'],
  results: [],
  rules: { ...DEFAULT_RULES, recall_top_percent: 0 },
  recalls: [],
}

describe('detectAnomalies', () => {
  it('returns empty array for clean data', () => {
    expect(detectAnomalies(cleanInput)).toEqual([])
  })

  it('returns anomalies in deterministic order', () => {
    const input: AnomalyInput = {
      ...cleanInput,
      scores: [
        ...cleanInput.scores,
        { id: '5', round_id: 'r1', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j1', raw_score: 80, flagged: false, flag_reason: null },
        { id: '6', round_id: 'r1', competition_id: 'c1', dancer_id: 'd999', judge_id: 'j1', raw_score: 50, flagged: false, flag_reason: null },
      ],
    }
    const result = detectAnomalies(input)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const types = result.map(a => a.type)
    const dupIdx = types.indexOf('duplicate_score_entry')
    const nonRosterIdx = types.indexOf('score_for_non_roster_dancer')
    expect(dupIdx).toBeLessThan(nonRosterIdx)
  })

  it('separates blockers from warnings', () => {
    const input: AnomalyInput = {
      ...cleanInput,
      scores: [
        { id: '1', round_id: 'r1', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j1', raw_score: 80, flagged: false, flag_reason: null },
      ],
    }
    const result = detectAnomalies(input)
    const blockers = result.filter(a => a.blocking)
    const warnings = result.filter(a => !a.blocking)
    expect(blockers.length).toBeGreaterThan(0)
    expect(warnings.length).toBeGreaterThan(0)
  })
})
