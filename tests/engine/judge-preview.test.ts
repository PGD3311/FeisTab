import { describe, it, expect } from 'vitest'
import { type CompetitionStatus } from '@/lib/competition-states'
import {
  groupJudgeCompetitions,
  isJudgePreviewStatus,
  judgeDancerState,
  sortBySchedule,
  type JudgeListCompetition,
} from '@/lib/engine/judge-preview'

function comp(
  id: string,
  status: CompetitionStatus,
  opts: Partial<JudgeListCompetition> = {}
): JudgeListCompetition {
  return {
    id,
    code: opts.code ?? id,
    status,
    roster_confirmed_at: opts.roster_confirmed_at ?? null,
    schedule_position: opts.schedule_position ?? null,
  }
}

const ids = (cs: JudgeListCompetition[]) => cs.map((c) => c.id)

describe('sortBySchedule', () => {
  it('orders by schedule position, nulls last, then by code', () => {
    const sorted = sortBySchedule([
      comp('c', 'imported', { code: 'B2' }),
      comp('b', 'imported', { schedule_position: 2 }),
      comp('d', 'imported', { code: 'A1' }),
      comp('a', 'imported', { schedule_position: 1 }),
    ])
    expect(ids(sorted)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('does not mutate the input', () => {
    const input = [
      comp('b', 'imported', { schedule_position: 2 }),
      comp('a', 'imported', { schedule_position: 1 })
    ]
    sortBySchedule(input)
    expect(ids(input)).toEqual(['b', 'a'])
  })
})

describe('groupJudgeCompetitions', () => {
  const confirmed = '2026-10-21T09:00:00Z'
  const comps = [
    comp('draft', 'draft'),
    comp('imported', 'imported', { schedule_position: 5 }),
    comp('unconfirmed', 'ready_for_day_of', { schedule_position: 4 }),
    comp('queued', 'ready_for_day_of', { schedule_position: 3, roster_confirmed_at: confirmed }),
    comp('released', 'released_to_judge', { schedule_position: 2 }),
    comp('scoring', 'in_progress', { schedule_position: 1 }),
    comp('signed', 'awaiting_scores'),
    comp('tab', 'ready_to_tabulate'),
    comp('pub', 'published'),
  ]
  const groups = groupJudgeCompetitions(comps, new Set(['signed']))

  it('puts released and unsigned scoring comps in Score Now, in schedule order', () => {
    expect(ids(groups.scoreNow)).toEqual(['scoring', 'released'])
  })

  it('queues ready comps whose roster side-stage confirmed', () => {
    expect(ids(groups.queued)).toEqual(['queued'])
  })

  it('shows imported and unconfirmed ready comps as waiting for side-stage', () => {
    expect(ids(groups.waitingForSideStage)).toEqual(['unconfirmed', 'imported'])
  })

  it('separates comps this judge has signed off', () => {
    expect(ids(groups.signedOff)).toEqual(['signed'])
  })

  it('collects finished comps as done', () => {
    expect(ids(groups.done)).toEqual(['pub', 'tab'])
  })

  it('leaves drafts out of every group', () => {
    const all = Object.values(groups).flat().map((c) => c.id)
    expect(all).not.toContain('draft')
    expect(all).toHaveLength(comps.length - 1)
  })
})

describe('isJudgePreviewStatus', () => {
  it('is true before the competition is sent to the judge', () => {
    expect(isJudgePreviewStatus('draft')).toBe(true)
    expect(isJudgePreviewStatus('imported')).toBe(true)
    expect(isJudgePreviewStatus('ready_for_day_of')).toBe(true)
  })

  it('is false once released or scoring', () => {
    expect(isJudgePreviewStatus('released_to_judge')).toBe(false)
    expect(isJudgePreviewStatus('in_progress')).toBe(false)
    expect(isJudgePreviewStatus('awaiting_scores')).toBe(false)
    expect(isJudgePreviewStatus('published')).toBe(false)
  })
})

describe('judgeDancerState', () => {
  it('shows dancers side-stage has not marked as not checked in yet', () => {
    expect(judgeDancerState('registered')).toEqual({
      kind: 'awaiting',
      label: 'Not checked in yet'
    })
    expect(judgeDancerState('checked_in').kind).toBe('awaiting')
    expect(judgeDancerState(null).kind).toBe('awaiting')
  })

  it('shows present dancers as checked in', () => {
    expect(judgeDancerState('present')).toEqual({ kind: 'present', label: 'Checked in' })
    expect(judgeDancerState('danced').kind).toBe('present')
  })

  it('shows non-active dancers as out, with their status', () => {
    expect(judgeDancerState('scratched')).toEqual({ kind: 'out', label: 'Scratched' })
    expect(judgeDancerState('no_show')).toEqual({ kind: 'out', label: 'No show' })
    expect(judgeDancerState('disqualified').label).toBe('Disqualified')
    expect(judgeDancerState('did_not_complete').label).toBe('Did not complete')
    expect(judgeDancerState('medical').label).toBe('Medical')
  })
})
