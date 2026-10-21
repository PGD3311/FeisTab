import { type CompetitionStatus } from '@/lib/competition-states'
import { NON_ACTIVE_STATUSES, type RegistrationStatus } from './anomalies/types'
import { isAwaitingSideStage } from './side-stage'

// ---------------------------------------------------------------------------
// Judge's competition list
// ---------------------------------------------------------------------------

export interface JudgeListCompetition {
  id: string
  code: string | null
  status: CompetitionStatus
  roster_confirmed_at: string | null
  schedule_position: number | null
}

export interface JudgeCompetitionGroups<T extends JudgeListCompetition> {
  /** Released to this judge, or scoring and not yet signed off by them */
  scoreNow: T[]
  /** Side-stage has confirmed the roster; not yet sent to the judge */
  queued: T[]
  /** Side-stage hasn't confirmed the roster yet */
  waitingForSideStage: T[]
  /** This judge has signed off; other judges still scoring */
  signedOff: T[]
  done: T[]
}

const SCORING_STATUSES: CompetitionStatus[] = ['in_progress', 'awaiting_scores']
const DONE_STATUSES: CompetitionStatus[] = [
  'ready_to_tabulate',
  'complete_unpublished',
  'published',
  'locked',
  'recalled_round_pending',
]

// Before release the judge may look at the dancer list but not score it
const PREVIEW_STATUSES: CompetitionStatus[] = ['draft', 'imported', 'ready_for_day_of']

/** True when the competition hasn't been sent to the judge yet (read-only dancer list). */
export function isJudgePreviewStatus(status: string): boolean {
  return (PREVIEW_STATUSES as string[]).includes(status)
}

/** Schedule order: schedule_position first (nulls last), then code. */
export function sortBySchedule<T extends JudgeListCompetition>(comps: readonly T[]): T[] {
  return [...comps].sort((a, b) => {
    if (a.schedule_position !== null && b.schedule_position !== null) {
      return a.schedule_position - b.schedule_position
    }
    if (a.schedule_position !== null) return -1
    if (b.schedule_position !== null) return 1
    return (a.code ?? '').localeCompare(b.code ?? '')
  })
}

/** Split a judge's assigned competitions into the groups shown on their tablet. */
export function groupJudgeCompetitions<T extends JudgeListCompetition>(
  comps: readonly T[],
  signedOffCompIds: ReadonlySet<string>
): JudgeCompetitionGroups<T> {
  const pick = (test: (c: T) => boolean) => sortBySchedule(comps.filter(test))
  return {
    scoreNow: pick(
      (c) =>
        (SCORING_STATUSES.includes(c.status) && !signedOffCompIds.has(c.id)) ||
        c.status === 'released_to_judge'
    ),
    queued: pick((c) => c.status === 'ready_for_day_of' && !!c.roster_confirmed_at),
    waitingForSideStage: pick(
      (c) =>
        c.status === 'imported' || (c.status === 'ready_for_day_of' && !c.roster_confirmed_at)
    ),
    signedOff: pick((c) => SCORING_STATUSES.includes(c.status) && signedOffCompIds.has(c.id)),
    done: pick((c) => DONE_STATUSES.includes(c.status)),
  }
}

// ---------------------------------------------------------------------------
// One dancer on the judge's list
// ---------------------------------------------------------------------------

export type JudgeDancerKind = 'awaiting' | 'present' | 'out'

export interface JudgeDancerState {
  kind: JudgeDancerKind
  label: string
}

const OUT_LABELS: Record<string, string> = {
  scratched: 'Scratched',
  no_show: 'No show',
  disqualified: 'Disqualified',
  did_not_complete: 'Did not complete',
  medical: 'Medical',
}

/**
 * How a dancer shows on the judge's list: not yet marked by side-stage, checked in,
 * or out (scratched, no-show and the other non-active statuses).
 */
export function judgeDancerState(status: string | null | undefined): JudgeDancerState {
  const s = status ?? 'registered'
  if (NON_ACTIVE_STATUSES.includes(s as RegistrationStatus)) {
    return { kind: 'out', label: OUT_LABELS[s] ?? s }
  }
  if (isAwaitingSideStage(s)) return { kind: 'awaiting', label: 'Not checked in yet' }
  return { kind: 'present', label: 'Checked in' }
}
