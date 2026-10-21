import { describe, it, expect } from 'vitest'
import {
  countAwaitingSideStage,
  isAwaitingSideStage,
  sideStageBlockReason
} from '@/lib/engine/side-stage'

describe('countAwaitingSideStage', () => {
  it('counts dancers side-stage has not marked', () => {
    expect(countAwaitingSideStage(['registered', 'checked_in', 'present', 'no_show'])).toBe(2)
  })

  it('treats present, no-show and scratched as marked', () => {
    expect(countAwaitingSideStage(['present', 'no_show', 'scratched'])).toBe(0)
  })

  it('is zero for an empty roster', () => {
    expect(countAwaitingSideStage([])).toBe(0)
  })
})

describe('sideStageBlockReason', () => {
  it('is null once every dancer is marked', () => {
    expect(sideStageBlockReason(['present', 'scratched'])).toBeNull()
  })

  it('names how many dancers are left, singular and plural', () => {
    expect(sideStageBlockReason(['registered'])).toBe(
      '1 dancer not checked in at side-stage yet. Mark each one Present, No Show or Scratched first.'
    )
    expect(sideStageBlockReason(['registered', 'checked_in'])).toMatch(/^2 dancers not checked in/)
  })
})

describe('isAwaitingSideStage', () => {
  it('is true for dancers side-stage has not marked', () => {
    expect(isAwaitingSideStage('registered')).toBe(true)
    expect(isAwaitingSideStage('checked_in')).toBe(true)
  })

  it('is false once marked', () => {
    expect(isAwaitingSideStage('present')).toBe(false)
    expect(isAwaitingSideStage('scratched')).toBe(false)
  })
})
