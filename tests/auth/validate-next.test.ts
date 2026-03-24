import { describe, it, expect } from 'vitest'
import { validateNextParam } from '@/lib/auth/validate-next'

describe('validateNextParam', () => {
  it('accepts valid relative paths', () => {
    expect(validateNextParam('/dashboard')).toBe('/dashboard')
    expect(validateNextParam('/judge/abc-123')).toBe('/judge/abc-123')
    expect(validateNextParam('/dashboard/events/123?tab=team')).toBe('/dashboard/events/123?tab=team')
  })

  it('rejects protocol-relative URLs', () => {
    expect(validateNextParam('//evil.com')).toBe('/')
    expect(validateNextParam('//evil.com/path')).toBe('/')
  })

  it('rejects absolute URLs', () => {
    expect(validateNextParam('https://evil.com')).toBe('/')
    expect(validateNextParam('http://evil.com')).toBe('/')
  })

  it('rejects URLs with @ (credential injection)', () => {
    expect(validateNextParam('/foo@evil.com')).toBe('/')
  })

  it('rejects URLs containing ://', () => {
    expect(validateNextParam('/redirect?url=https://evil.com')).toBe('/')
  })

  it('rejects empty/null/undefined', () => {
    expect(validateNextParam('')).toBe('/')
    expect(validateNextParam(null as unknown as string)).toBe('/')
    expect(validateNextParam(undefined as unknown as string)).toBe('/')
  })

  it('rejects paths not starting with /', () => {
    expect(validateNextParam('dashboard')).toBe('/')
  })

  it('returns / as default', () => {
    expect(validateNextParam('/')).toBe('/')
  })
})
