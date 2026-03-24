import { describe, it, expect } from 'vitest'
import { hasRequiredRole } from '@/lib/auth/require-role'

describe('hasRequiredRole', () => {
  it('returns true when user has exact role', () => {
    expect(hasRequiredRole(['organizer'], ['organizer'])).toBe(true)
  })

  it('returns true when user has one of allowed roles', () => {
    expect(hasRequiredRole(['registration_desk'], ['organizer', 'registration_desk'])).toBe(true)
  })

  it('returns false when user has no matching role', () => {
    expect(hasRequiredRole(['judge'], ['organizer', 'registration_desk'])).toBe(false)
  })

  it('returns false for empty user roles', () => {
    expect(hasRequiredRole([], ['organizer'])).toBe(false)
  })

  it('organizer inherits reg_desk and side_stage', () => {
    expect(hasRequiredRole(['organizer'], ['registration_desk'])).toBe(true)
    expect(hasRequiredRole(['organizer'], ['side_stage'])).toBe(true)
  })

  it('organizer does NOT inherit judge', () => {
    expect(hasRequiredRole(['organizer'], ['judge'])).toBe(false)
  })

  it('handles multi-role users', () => {
    expect(hasRequiredRole(['registration_desk', 'side_stage'], ['side_stage'])).toBe(true)
  })
})
