import { type CompetitionStatus } from '@/lib/competition-states'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleGroup = 'now' | 'next' | 'upcoming' | 'complete'

export interface ScheduleCompetition {
  id: string
  status: CompetitionStatus
  schedule_position: number | null
  stage_id: string | null
  roster_confirmed_at: string | null
  judge_count: number
}

export interface ScheduleGrouping {
  now: ScheduleCompetition | null
  next: ScheduleCompetition | null
  upcoming: ScheduleCompetition[]
  complete: ScheduleCompetition[]
}

// ---------------------------------------------------------------------------
// Status sets for schedule grouping. Defined locally (not imported from
// competition-states) because the schedule view groups statuses differently
// than the state machine does.
// ---------------------------------------------------------------------------

/** Statuses where the stage is currently occupied */
const NOW_STATUSES: ReadonlySet<CompetitionStatus> = new Set([
  'released_to_judge',
  'in_progress',
  'awaiting_scores',
  'ready_to_tabulate',
  'recalled_round_pending',
])

/** Statuses where the competition is done */
const COMPLETE_STATUSES: ReadonlySet<CompetitionStatus> = new Set([
  'complete_unpublished',
  'published',
  'locked',
])

// ---------------------------------------------------------------------------
// groupBySchedule
// ---------------------------------------------------------------------------

/**
 * Derive NOW / NEXT / UPCOMING / COMPLETE groupings for a single stage.
 *
 * Competitions are filtered to `stageId`, sorted by `schedule_position`
 * (nulls last), then classified into the four buckets.
 */
export function groupBySchedule(
  competitions: ScheduleCompetition[],
  stageId: string
): ScheduleGrouping {
  const stageComps = competitions.filter((c) => c.stage_id === stageId)

  // Sort by schedule_position — nulls last
  const sorted = [...stageComps].sort((a, b) => {
    if (a.schedule_position === null && b.schedule_position === null) return 0
    if (a.schedule_position === null) return 1
    if (b.schedule_position === null) return -1
    return a.schedule_position - b.schedule_position
  })

  const result: ScheduleGrouping = {
    now: null,
    next: null,
    upcoming: [],
    complete: [],
  }

  // First pass: find NOW (first comp with a NOW status that has a schedule_position)
  for (const comp of sorted) {
    if (comp.schedule_position !== null && NOW_STATUSES.has(comp.status)) {
      result.now = comp
      break
    }
  }

  // Second pass: classify everything
  for (const comp of sorted) {
    // Already assigned as NOW
    if (comp === result.now) continue

    if (COMPLETE_STATUSES.has(comp.status)) {
      result.complete.push(comp)
      continue
    }

    // Candidate for NEXT: must have schedule_position and be eligible
    if (result.next === null && comp.schedule_position !== null && isNextEligible(comp, result.now)) {
      result.next = comp
      continue
    }

    // Everything else is UPCOMING
    result.upcoming.push(comp)
  }

  return result
}

/**
 * Determine if a competition is eligible for the NEXT slot.
 *
 * Phase 1 rules:
 * - `ready_for_day_of` with `roster_confirmed_at` set
 * - `released_to_judge` if no active NOW exists
 */
function isNextEligible(comp: ScheduleCompetition, now: ScheduleCompetition | null): boolean {
  if (comp.status === 'ready_for_day_of' && comp.roster_confirmed_at !== null) {
    return true
  }
  if (comp.status === 'released_to_judge' && now === null) {
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// getScheduleBlockReasons
// ---------------------------------------------------------------------------

/**
 * Return human-readable reasons why a competition is not ready for scheduling.
 * Empty array means the competition is fully ready.
 */
export function getScheduleBlockReasons(comp: ScheduleCompetition): string[] {
  const reasons: string[] = []

  if (comp.stage_id === null) {
    reasons.push('No stage assigned')
  }

  if (comp.schedule_position === null) {
    reasons.push('No schedule position')
  }

  if (comp.status !== 'draft') {
    if (comp.roster_confirmed_at === null) {
      reasons.push('Roster not confirmed')
    }
    if (comp.judge_count === 0) {
      reasons.push('No judges assigned')
    }
  }

  return reasons
}
