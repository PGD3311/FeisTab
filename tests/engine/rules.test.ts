import { describe, it, expect } from 'vitest'
import { validateScore, DEFAULT_RULES, type RuleSetConfig } from '@/lib/engine/rules'

describe('validateScore', () => {
  it('returns true for score within range', () => {
    expect(validateScore(50, DEFAULT_RULES)).toBe(true)
  })

  it('returns true for score at minimum boundary', () => {
    expect(validateScore(0, DEFAULT_RULES)).toBe(true)
  })

  it('returns true for score at maximum boundary', () => {
    expect(validateScore(100, DEFAULT_RULES)).toBe(true)
  })

  it('returns false for score below minimum', () => {
    expect(validateScore(-1, DEFAULT_RULES)).toBe(false)
  })

  it('returns false for score above maximum', () => {
    expect(validateScore(101, DEFAULT_RULES)).toBe(false)
  })

  it('returns false for large negative score', () => {
    expect(validateScore(-100, DEFAULT_RULES)).toBe(false)
  })

  it('returns false for very large score', () => {
    expect(validateScore(999, DEFAULT_RULES)).toBe(false)
  })

  it('works with non-standard score range', () => {
    const customRules: RuleSetConfig = {
      ...DEFAULT_RULES,
      score_min: 50,
      score_max: 75,
    }
    expect(validateScore(50, customRules)).toBe(true)
    expect(validateScore(75, customRules)).toBe(true)
    expect(validateScore(49, customRules)).toBe(false)
    expect(validateScore(76, customRules)).toBe(false)
    expect(validateScore(60, customRules)).toBe(true)
  })

  it('returns false for NaN', () => {
    expect(validateScore(NaN, DEFAULT_RULES)).toBe(false)
  })

  it('returns false for Infinity', () => {
    expect(validateScore(Infinity, DEFAULT_RULES)).toBe(false)
    expect(validateScore(-Infinity, DEFAULT_RULES)).toBe(false)
  })

  it('handles decimal scores', () => {
    expect(validateScore(50.5, DEFAULT_RULES)).toBe(true)
    expect(validateScore(99.9, DEFAULT_RULES)).toBe(true)
    expect(validateScore(100.1, DEFAULT_RULES)).toBe(false)
  })
})
