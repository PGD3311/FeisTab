import { describe, it, expect } from 'vitest'
import {
  canTransition,
  getNextStates,
  getTransitionLabel,
  getTransitionBlockReason,
  type CompetitionStatus,
  type TransitionContext,
} from '@/lib/competition-states'

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

  it('allows ready_to_tabulate -> awaiting_scores (correction)', () => {
    expect(canTransition('ready_to_tabulate', 'awaiting_scores')).toBe(true)
  })

  it('allows complete_unpublished -> awaiting_scores (correction)', () => {
    expect(canTransition('complete_unpublished', 'awaiting_scores')).toBe(true)
  })
})

describe('getTransitionLabel', () => {
  it('returns label for imported -> ready_for_day_of', () => {
    expect(getTransitionLabel('imported', 'ready_for_day_of')).toBe('Mark Ready for Day-Of')
  })

  it('returns label for ready_for_day_of -> in_progress', () => {
    expect(getTransitionLabel('ready_for_day_of', 'in_progress')).toBe('Start Competition')
  })

  it('returns label for in_progress -> awaiting_scores', () => {
    expect(getTransitionLabel('in_progress', 'awaiting_scores')).toBe('Open for Scoring')
  })

  it('returns label for complete_unpublished -> published', () => {
    expect(getTransitionLabel('complete_unpublished', 'published')).toBe('Publish Results')
  })

  it('returns generic label for unmapped transitions', () => {
    expect(getTransitionLabel('published', 'locked')).toBe('Advance to Locked')
  })

  it('returns label for ready_to_tabulate -> awaiting_scores', () => {
    expect(getTransitionLabel('ready_to_tabulate', 'awaiting_scores')).toBe('Unlock for Correction')
  })

  it('returns label for complete_unpublished -> awaiting_scores', () => {
    expect(getTransitionLabel('complete_unpublished', 'awaiting_scores')).toBe('Unlock for Correction')
  })
})

describe('getTransitionBlockReason', () => {
  const fullContext: TransitionContext = {
    registrationCount: 10,
    judgeCount: 3,
    roundCount: 1,
  }

  it('returns null when all prerequisites met', () => {
    expect(getTransitionBlockReason('imported', 'ready_for_day_of', fullContext)).toBeNull()
  })

  it('blocks imported -> ready_for_day_of without registrations', () => {
    const ctx = { ...fullContext, registrationCount: 0 }
    expect(getTransitionBlockReason('imported', 'ready_for_day_of', ctx)).toBe(
      'Import dancers before advancing'
    )
  })

  it('blocks ready_for_day_of -> in_progress without judges', () => {
    const ctx = { ...fullContext, judgeCount: 0 }
    expect(getTransitionBlockReason('ready_for_day_of', 'in_progress', ctx)).toBe(
      'Assign judges before starting'
    )
  })

  it('allows in_progress -> awaiting_scores with no rounds', () => {
    const ctx = { ...fullContext, roundCount: 0 }
    expect(getTransitionBlockReason('in_progress', 'awaiting_scores', ctx)).toBeNull()
  })

  it('returns null for transitions with no prerequisites', () => {
    expect(getTransitionBlockReason('complete_unpublished', 'published', fullContext)).toBeNull()
  })

  it('returns null for invalid transitions (canTransition handles that)', () => {
    expect(getTransitionBlockReason('draft', 'published', fullContext)).toBeNull()
  })
})
