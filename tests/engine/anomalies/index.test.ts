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

describe('detectAnomalies — recalls', () => {
  const championshipRules = { ...DEFAULT_RULES, recall_top_percent: 50 }

  it('never asks a grade competition for recalls', () => {
    const input: AnomalyInput = { ...cleanInput, rules: DEFAULT_RULES }
    expect(detectAnomalies(input).some(a => a.type === 'recall_mismatch')).toBe(false)
  })

  it('blocks a championship first round until recalls are generated', () => {
    const input: AnomalyInput = { ...cleanInput, rules: championshipRules }
    const recallBlockers = detectAnomalies(input).filter(a => a.type === 'recall_mismatch')
    expect(recallBlockers).toHaveLength(1)
    expect(recallBlockers[0].blocking).toBe(true)
  })

  it('clears the blocker once recalls exist for the round', () => {
    const input: AnomalyInput = {
      ...cleanInput,
      rules: championshipRules,
      recalls: [{ dancer_id: 'd1', round_id: 'r1' }],
    }
    expect(detectAnomalies(input)).toEqual([])
  })

  describe('recall round', () => {
    const recallRound = { id: 'r2', competition_id: 'c1', round_number: 2, round_type: 'recall', judge_sign_offs: {} }
    const recallInput: AnomalyInput = {
      ...cleanInput,
      rules: championshipRules,
      rounds: [recallRound],
      recalls: [{ dancer_id: 'd1', round_id: 'r1' }],
      scores: [
        { id: '7', round_id: 'r2', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j1', raw_score: 88, flagged: false, flag_reason: null },
        { id: '8', round_id: 'r2', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j2', raw_score: 90, flagged: false, flag_reason: null },
      ],
    }

    it('is clean when every recalled dancer is scored — no recall demand, no missing scores for others', () => {
      expect(detectAnomalies(recallInput)).toEqual([])
    })

    it('still requires scores for recalled dancers', () => {
      const input: AnomalyInput = { ...recallInput, scores: [recallInput.scores[0]] }
      const types = detectAnomalies(input).filter(a => a.blocking).map(a => a.type)
      expect(types).toContain('missing_required_score')
    })

    it('blocks a score for a dancer who was not recalled', () => {
      const input: AnomalyInput = {
        ...recallInput,
        scores: [
          ...recallInput.scores,
          { id: '9', round_id: 'r2', competition_id: 'c1', dancer_id: 'd2', judge_id: 'j1', raw_score: 70, flagged: false, flag_reason: null },
        ],
      }
      const blocker = detectAnomalies(input).find(a => a.type === 'score_for_non_roster_dancer')
      expect(blocker?.blocking).toBe(true)
      expect(blocker?.message).toContain('not recalled')
    })
  })
})
