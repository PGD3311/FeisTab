import { describe, it, expect } from 'vitest'
import { nextStageName } from '@/lib/stages'

describe('nextStageName', () => {
  it('uses count + 1 when no stage is numbered', () => {
    expect(nextStageName([])).toBe('Stage 1')
    expect(nextStageName(['Main', 'Hall'])).toBe('Stage 3')
  })
  it('uses one more than the highest numbered stage', () => {
    expect(nextStageName(['Stage 1', 'Stage 2', 'Stage 5'])).toBe('Stage 6')
    expect(nextStageName(['Stage 1', 'Main'])).toBe('Stage 2')
  })
})
