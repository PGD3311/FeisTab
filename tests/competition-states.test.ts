import { describe, it, expect } from 'vitest'
import { canTransition, getNextStates, CompetitionStatus } from '@/lib/competition-states'

describe('competition state machine', () => {
  it('allows draft -> imported', () => {
    expect(canTransition('draft', 'imported')).toBe(true)
  })

  it('blocks draft -> published', () => {
    expect(canTransition('draft', 'published')).toBe(false)
  })

  it('allows full happy path', () => {
    const path: CompetitionStatus[] = [
      'draft', 'imported', 'ready_for_day_of', 'in_progress',
      'awaiting_scores', 'ready_to_tabulate', 'complete_unpublished', 'published', 'locked'
    ]
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true)
    }
  })

  it('allows ready_to_tabulate -> recalled_round_pending', () => {
    expect(canTransition('ready_to_tabulate', 'recalled_round_pending')).toBe(true)
  })

  it('allows recalled_round_pending -> awaiting_scores', () => {
    expect(canTransition('recalled_round_pending', 'awaiting_scores')).toBe(true)
  })

  it('returns valid next states', () => {
    const next = getNextStates('awaiting_scores')
    expect(next).toContain('ready_to_tabulate')
  })
})
