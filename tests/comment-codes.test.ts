import { describe, it, expect, vi } from 'vitest'
import {
  COMMENT_CODES,
  validateCommentData,
  hasCommentContent,
  type CommentData,
} from '@/lib/comment-codes'

describe('COMMENT_CODES', () => {
  it('contains the default code set', () => {
    const codes = COMMENT_CODES.map(c => c.code)
    expect(codes).toContain('turnout')
    expect(codes).toContain('timing')
    expect(codes).toContain('rhythm')
    expect(codes).toContain('posture')
    expect(codes).toContain('presentation')
    expect(codes).toContain('carriage')
    expect(codes).toHaveLength(6)
  })
})

describe('validateCommentData', () => {
  it('returns null when input is null', () => {
    expect(validateCommentData(null)).toBeNull()
  })

  it('returns null when codes empty and note blank', () => {
    expect(validateCommentData({ codes: [], note: '' })).toBeNull()
  })

  it('returns null when codes empty and note is whitespace', () => {
    expect(validateCommentData({ codes: [], note: '   ' })).toBeNull()
  })

  it('strips unknown codes, keeps valid ones', () => {
    const result = validateCommentData({
      codes: ['turnout', 'fake_code', 'timing'],
      note: null,
    })
    expect(result).toEqual({ codes: ['turnout', 'timing'], note: null })
  })

  it('returns null when all codes are unknown and note is blank', () => {
    expect(validateCommentData({ codes: ['bogus', 'nope'], note: null })).toBeNull()
  })

  it('trims note whitespace', () => {
    const result = validateCommentData({
      codes: ['posture'],
      note: '  Great improvement  ',
    })
    expect(result).toEqual({ codes: ['posture'], note: 'Great improvement' })
  })

  it('keeps note when codes are empty', () => {
    const result = validateCommentData({
      codes: [],
      note: 'Needs work on crossover',
    })
    expect(result).toEqual({ codes: [], note: 'Needs work on crossover' })
  })

  it('warns in dev when unknown codes are stripped', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    validateCommentData({ codes: ['turnout', 'bogus'], note: null })
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('bogus')
    )
    spy.mockRestore()
  })
})

describe('hasCommentContent', () => {
  it('returns false when both null', () => {
    expect(hasCommentContent(null, null)).toBe(false)
  })

  it('returns true when comment_data has codes', () => {
    expect(hasCommentContent({ codes: ['turnout'], note: null }, null)).toBe(true)
  })

  it('returns true when comment_data has only a note', () => {
    expect(hasCommentContent({ codes: [], note: 'Good' }, null)).toBe(true)
  })

  it('returns true when legacy comments text exists', () => {
    expect(hasCommentContent(null, 'Old comment')).toBe(true)
  })

  it('returns false when legacy comments is empty string', () => {
    expect(hasCommentContent(null, '')).toBe(false)
  })
})
