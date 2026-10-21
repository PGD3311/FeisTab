import type { CompetitionStatus } from '@/lib/competition-states'

const FINISHED: CompetitionStatus[] = ['published', 'locked']

export interface FeisProgress {
  /** Competitions with results published */
  finished: number
  /** Competitions with at least one dancer entered; empty ones never run */
  toRun: number
}

/** How far through the day a feis is, counted in competitions that actually run. */
export function feisProgress(
  competitions: readonly { status: CompetitionStatus; dancerCount: number }[]
): FeisProgress {
  const toRun = competitions.filter((c) => c.dancerCount > 0)
  return {
    finished: toRun.filter((c) => FINISHED.includes(c.status)).length,
    toRun: toRun.length
  }
}
