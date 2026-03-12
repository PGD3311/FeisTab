export type CompetitionStatus =
  | 'draft'
  | 'imported'
  | 'ready_for_day_of'
  | 'in_progress'
  | 'awaiting_scores'
  | 'ready_to_tabulate'
  | 'recalled_round_pending'
  | 'complete_unpublished'
  | 'published'
  | 'locked'

const transitions: Record<CompetitionStatus, CompetitionStatus[]> = {
  draft: ['imported'],
  imported: ['ready_for_day_of'],
  ready_for_day_of: ['in_progress'],
  in_progress: ['awaiting_scores'],
  awaiting_scores: ['ready_to_tabulate'],
  ready_to_tabulate: ['recalled_round_pending', 'complete_unpublished'],
  recalled_round_pending: ['awaiting_scores'],
  complete_unpublished: ['published'],
  published: ['locked', 'complete_unpublished'],
  locked: [],
}

export function canTransition(from: CompetitionStatus, to: CompetitionStatus): boolean {
  return transitions[from]?.includes(to) ?? false
}

export function getNextStates(current: CompetitionStatus): CompetitionStatus[] {
  return transitions[current] ?? []
}

/** Statuses where a competition is actively being worked on */
export const ACTIVE_STATUSES: CompetitionStatus[] = [
  'in_progress',
  'awaiting_scores',
  'ready_to_tabulate',
  'recalled_round_pending',
]

/** Statuses where operator action is needed to unblock progress */
export const BLOCKED_STATUSES: CompetitionStatus[] = ['ready_to_tabulate', 'recalled_round_pending']

/** Human-readable labels for operator-facing transition buttons */
const transitionLabels: Partial<Record<string, string>> = {
  'imported→ready_for_day_of': 'Mark Ready for Day-Of',
  'ready_for_day_of→in_progress': 'Start Competition',
  'in_progress→awaiting_scores': 'Open for Scoring',
  'ready_to_tabulate→complete_unpublished': 'Run Tabulation',
  'ready_to_tabulate→recalled_round_pending': 'Generate Recalls',
  'complete_unpublished→published': 'Publish Results',
  'published→complete_unpublished': 'Unpublish',
}

export function getTransitionLabel(from: CompetitionStatus, to: CompetitionStatus): string {
  const key = `${from}→${to}`
  return (
    transitionLabels[key] ??
    `Advance to ${to.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
  )
}

export interface TransitionContext {
  registrationCount: number
  judgeCount: number
  roundCount: number
}

/**
 * Returns a human-readable reason why a transition is blocked, or null if allowed.
 * This checks prerequisites beyond the state machine — things like "have dancers been imported?"
 * The state machine validity (canTransition) should be checked separately.
 */
export function getTransitionBlockReason(
  from: CompetitionStatus,
  to: CompetitionStatus,
  context: TransitionContext
): string | null {
  if (from === 'imported' && to === 'ready_for_day_of') {
    if (context.registrationCount === 0) return 'Import dancers before advancing'
  }

  if (from === 'ready_for_day_of' && to === 'in_progress') {
    if (context.judgeCount === 0) return 'Assign judges before starting'
  }

  return null
}
