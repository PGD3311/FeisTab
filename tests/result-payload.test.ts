import { describe, it, expect } from 'vitest'
import {
  buildJudgeScores,
  detectTieBreak,
  buildCalculatedPayload,
  formatRulesFooter,
} from '@/lib/result-payload'
import { type TabulationResult } from '@/lib/engine/tabulate'
import { type RuleSetConfig, DEFAULT_RULES } from '@/lib/engine/rules'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const judges = [
  { id: 'j1', first_name: 'Mary', last_name: 'Kelly' },
  { id: 'j2', first_name: 'John', last_name: 'Murphy' },
]

const scores = [
  { dancer_id: 'd1', judge_id: 'j1', raw_score: 90 },
  { dancer_id: 'd1', judge_id: 'j2', raw_score: 85 },
  { dancer_id: 'd2', judge_id: 'j1', raw_score: 80 },
  { dancer_id: 'd2', judge_id: 'j2', raw_score: 95 },
]

const resultD1: TabulationResult = {
  dancer_id: 'd1',
  final_rank: 1,
  total_points: 175,
  individual_ranks: [
    { judge_id: 'j1', rank: 1, irish_points: 100 },
    { judge_id: 'j2', rank: 2, irish_points: 75 },
  ],
}

const resultD2: TabulationResult = {
  dancer_id: 'd2',
  final_rank: 2,
  total_points: 140,
  individual_ranks: [
    { judge_id: 'j1', rank: 2, irish_points: 75 },
    { judge_id: 'j2', rank: 1, irish_points: 100 },
  ],
}

// ── buildJudgeScores ──────────────────────────────────────────────────────────

describe('buildJudgeScores', () => {
  it('enriches individual_ranks with judge names and raw scores', () => {
    const result = buildJudgeScores(resultD1, judges, scores)

    expect(result).toHaveLength(2)

    const j1Score = result.find(s => s.judge_id === 'j1')!
    expect(j1Score.judge_name).toBe('Mary Kelly')
    expect(j1Score.raw_score).toBe(90)
    expect(j1Score.rank).toBe(1)
    expect(j1Score.irish_points).toBe(100)

    const j2Score = result.find(s => s.judge_id === 'j2')!
    expect(j2Score.judge_name).toBe('John Murphy')
    expect(j2Score.raw_score).toBe(85)
    expect(j2Score.rank).toBe(2)
    expect(j2Score.irish_points).toBe(75)
  })

  it('includes flagged and flag_reason fields only when score is flagged', () => {
    const flaggedScores = [
      { dancer_id: 'd1', judge_id: 'j1', raw_score: 90, flagged: true, flag_reason: 'Double entry' },
      { dancer_id: 'd1', judge_id: 'j2', raw_score: 85 },
    ]
    const result = buildJudgeScores(resultD1, judges, flaggedScores)

    const j1Score = result.find(s => s.judge_id === 'j1')!
    expect(j1Score.flagged).toBe(true)
    expect(j1Score.flag_reason).toBe('Double entry')

    const j2Score = result.find(s => s.judge_id === 'j2')!
    expect(j2Score.flagged).toBeUndefined()
    expect(j2Score.flag_reason).toBeUndefined()
  })

  it('falls back to judge_id as name when judge not found', () => {
    const result = buildJudgeScores(resultD1, [], scores)

    const j1Score = result.find(s => s.judge_id === 'j1')!
    expect(j1Score.judge_name).toBe('j1')
  })

  it('falls back to raw_score=0 when score entry not found', () => {
    const result = buildJudgeScores(resultD1, judges, [])

    const j1Score = result.find(s => s.judge_id === 'j1')!
    expect(j1Score.raw_score).toBe(0)
  })
})

// ── detectTieBreak ────────────────────────────────────────────────────────────

describe('detectTieBreak', () => {
  it('returns applied=false and empty notes when there are no ties', () => {
    const { applied, notes } = detectTieBreak([resultD1, resultD2])

    expect(applied).toBe(false)
    expect(notes.size).toBe(0)
  })

  it('detects countback win when dancers share total_points but have different final_rank', () => {
    // d1 has 2 firsts, d2 has 0 firsts → d1 wins countback
    const tiedWinner: TabulationResult = {
      dancer_id: 'd1',
      final_rank: 1,
      total_points: 175,
      individual_ranks: [
        { judge_id: 'j1', rank: 1, irish_points: 100 },
        { judge_id: 'j2', rank: 1, irish_points: 100 },
      ],
    }
    const tiedLoser: TabulationResult = {
      dancer_id: 'd2',
      final_rank: 2,
      total_points: 175,
      individual_ranks: [
        { judge_id: 'j1', rank: 2, irish_points: 75 },
        { judge_id: 'j2', rank: 2, irish_points: 75 },
      ],
    }

    const { applied, notes } = detectTieBreak([tiedWinner, tiedLoser])

    expect(applied).toBe(true)
    expect(notes.get('d1')).toMatch(/Won countback/)
    expect(notes.get('d2')).toMatch(/Lost countback/)
  })

  it('detects true tie when dancers share total_points and same final_rank', () => {
    const trueA: TabulationResult = {
      dancer_id: 'd1',
      final_rank: 1,
      total_points: 175,
      individual_ranks: [
        { judge_id: 'j1', rank: 1, irish_points: 100 },
        { judge_id: 'j2', rank: 2, irish_points: 75 },
      ],
    }
    const trueB: TabulationResult = {
      dancer_id: 'd2',
      final_rank: 1,
      total_points: 175,
      individual_ranks: [
        { judge_id: 'j1', rank: 2, irish_points: 75 },
        { judge_id: 'j2', rank: 1, irish_points: 100 },
      ],
    }

    const { applied, notes } = detectTieBreak([trueA, trueB])

    expect(applied).toBe(false)
    expect(notes.get('d1')).toMatch(/Tied/)
    expect(notes.get('d2')).toMatch(/Tied/)
  })
})

// ── buildCalculatedPayload ────────────────────────────────────────────────────

describe('buildCalculatedPayload', () => {
  it('produces a complete payload with all required fields', () => {
    const allResults = [resultD1, resultD2]
    const payload = buildCalculatedPayload(resultD1, judges, scores, allResults, DEFAULT_RULES)

    expect(payload.total_points).toBe(175)
    expect(payload.individual_ranks).toHaveLength(2)
    expect(payload.judge_scores).toHaveLength(2)
    expect(payload.rules_snapshot).toEqual(DEFAULT_RULES)
    expect(payload.tie_break_applied).toBe(false)
    expect(payload.tie_break_note).toBeNull()
    expect(payload.drop_applied).toBe(false)
    expect(payload.drop_note).toBeNull()
  })

  it('sets tie_break_note from detectTieBreak when a countback was applied', () => {
    const tiedWinner: TabulationResult = {
      dancer_id: 'd1',
      final_rank: 1,
      total_points: 175,
      individual_ranks: [
        { judge_id: 'j1', rank: 1, irish_points: 100 },
        { judge_id: 'j2', rank: 1, irish_points: 100 },
      ],
    }
    const tiedLoser: TabulationResult = {
      dancer_id: 'd2',
      final_rank: 2,
      total_points: 175,
      individual_ranks: [
        { judge_id: 'j1', rank: 2, irish_points: 75 },
        { judge_id: 'j2', rank: 2, irish_points: 75 },
      ],
    }
    const allResults = [tiedWinner, tiedLoser]

    const payload = buildCalculatedPayload(tiedWinner, judges, scores, allResults, DEFAULT_RULES)

    expect(payload.tie_break_applied).toBe(true)
    expect(payload.tie_break_note).toMatch(/Won countback/)
  })
})

// ── formatRulesFooter ─────────────────────────────────────────────────────────

describe('formatRulesFooter', () => {
  it('produces a human-readable rules summary string', () => {
    const rules: RuleSetConfig = {
      ...DEFAULT_RULES,
      score_min: 0,
      score_max: 100,
    }
    const footer = formatRulesFooter(rules)

    expect(footer).toContain('Irish Points')
    expect(footer).toContain('0')
    expect(footer).toContain('100')
    expect(footer).toMatch(/1st=100/)
  })
})
