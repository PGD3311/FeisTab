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
