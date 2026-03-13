import { describe, it, expect } from 'vitest'
import {
  groupBySchedule,
  getScheduleBlockReasons,
  type ScheduleCompetition,
} from '@/lib/engine/schedule'

function makeComp(overrides: Partial<ScheduleCompetition> = {}): ScheduleCompetition {
  return {
    id: 'comp-1',
    status: 'draft',
    schedule_position: 1,
    stage_id: 'stage-a',
    roster_confirmed_at: null,
    judge_count: 0,
    ...overrides,
  }
}

describe('groupBySchedule', () => {
  it('single stage, 3 comps: in_progress is NOW, ready_for_day_of with roster is NEXT, draft is UPCOMING', () => {
    const comps: ScheduleCompetition[] = [
      makeComp({
        id: 'c1',
        status: 'in_progress',
        schedule_position: 1,
        stage_id: 'stage-a',
        roster_confirmed_at: '2026-03-13T10:00:00Z',
        judge_count: 2,
      }),
      makeComp({
        id: 'c2',
        status: 'ready_for_day_of',
        schedule_position: 2,
        stage_id: 'stage-a',
        roster_confirmed_at: '2026-03-13T10:00:00Z',
        judge_count: 2,
      }),
      makeComp({
        id: 'c3',
        status: 'draft',
        schedule_position: 3,
        stage_id: 'stage-a',
      }),
    ]

    const result = groupBySchedule(comps, 'stage-a')

    expect(result.now?.id).toBe('c1')
    expect(result.next?.id).toBe('c2')
    expect(result.upcoming).toHaveLength(1)
    expect(result.upcoming[0].id).toBe('c3')
    expect(result.complete).toHaveLength(0)
  })

  it('no active competition → NOW is null, NEXT is first eligible', () => {
    const comps: ScheduleCompetition[] = [
      makeComp({
        id: 'c1',
        status: 'ready_for_day_of',
        schedule_position: 1,
        stage_id: 'stage-a',
        roster_confirmed_at: '2026-03-13T10:00:00Z',
        judge_count: 2,
      }),
      makeComp({
        id: 'c2',
        status: 'draft',
        schedule_position: 2,
        stage_id: 'stage-a',
      }),
    ]

    const result = groupBySchedule(comps, 'stage-a')

    expect(result.now).toBeNull()
    expect(result.next?.id).toBe('c1')
    expect(result.upcoming).toHaveLength(1)
    expect(result.upcoming[0].id).toBe('c2')
  })

  it('all competitions complete → NOW and NEXT are null, all in COMPLETE', () => {
    const comps: ScheduleCompetition[] = [
      makeComp({
        id: 'c1',
        status: 'published',
        schedule_position: 1,
        stage_id: 'stage-a',
      }),
      makeComp({
        id: 'c2',
        status: 'locked',
        schedule_position: 2,
        stage_id: 'stage-a',
      }),
      makeComp({
        id: 'c3',
        status: 'complete_unpublished',
        schedule_position: 3,
        stage_id: 'stage-a',
      }),
    ]

    const result = groupBySchedule(comps, 'stage-a')

    expect(result.now).toBeNull()
    expect(result.next).toBeNull()
    expect(result.upcoming).toHaveLength(0)
    expect(result.complete).toHaveLength(3)
  })

  it('released_to_judge is NOW (not NEXT)', () => {
    const comps: ScheduleCompetition[] = [
      makeComp({
        id: 'c1',
        status: 'released_to_judge',
        schedule_position: 1,
        stage_id: 'stage-a',
        roster_confirmed_at: '2026-03-13T10:00:00Z',
        judge_count: 2,
      }),
      makeComp({
        id: 'c2',
        status: 'ready_for_day_of',
        schedule_position: 2,
        stage_id: 'stage-a',
        roster_confirmed_at: '2026-03-13T10:00:00Z',
        judge_count: 1,
      }),
    ]

    const result = groupBySchedule(comps, 'stage-a')

    expect(result.now?.id).toBe('c1')
    expect(result.next?.id).toBe('c2')
  })

  it('two stages return independent groupings (filter by stageId)', () => {
    const comps: ScheduleCompetition[] = [
      makeComp({
        id: 'c1',
        status: 'in_progress',
        schedule_position: 1,
        stage_id: 'stage-a',
        roster_confirmed_at: '2026-03-13T10:00:00Z',
        judge_count: 2,
      }),
      makeComp({
        id: 'c2',
        status: 'ready_for_day_of',
        schedule_position: 1,
        stage_id: 'stage-b',
        roster_confirmed_at: '2026-03-13T10:00:00Z',
        judge_count: 1,
      }),
    ]

    const resultA = groupBySchedule(comps, 'stage-a')
    const resultB = groupBySchedule(comps, 'stage-b')

    expect(resultA.now?.id).toBe('c1')
    expect(resultA.next).toBeNull()
    expect(resultA.upcoming).toHaveLength(0)

    expect(resultB.now).toBeNull()
    expect(resultB.next?.id).toBe('c2')
    expect(resultB.upcoming).toHaveLength(0)
  })

  it('competitions without schedule_position are excluded from NOW and NEXT but appear in UPCOMING', () => {
    const comps: ScheduleCompetition[] = [
      makeComp({
        id: 'c1',
        status: 'in_progress',
        schedule_position: null,
        stage_id: 'stage-a',
        roster_confirmed_at: '2026-03-13T10:00:00Z',
        judge_count: 2,
      }),
      makeComp({
        id: 'c2',
        status: 'ready_for_day_of',
        schedule_position: 1,
        stage_id: 'stage-a',
        roster_confirmed_at: '2026-03-13T10:00:00Z',
        judge_count: 1,
      }),
      makeComp({
        id: 'c3',
        status: 'draft',
        schedule_position: null,
        stage_id: 'stage-a',
      }),
    ]

    const result = groupBySchedule(comps, 'stage-a')

    // c1 has a NOW status but null schedule_position — excluded from NOW
    expect(result.now).toBeNull()
    // c2 is the first eligible with a schedule_position
    expect(result.next?.id).toBe('c2')
    // Both null-position comps should appear in UPCOMING, after positioned ones
    expect(result.upcoming.map((c) => c.id)).toContain('c1')
    expect(result.upcoming.map((c) => c.id)).toContain('c3')
  })
})

describe('getScheduleBlockReasons', () => {
  it('returns ["No stage assigned"] when stage_id is null', () => {
    const comp = makeComp({ stage_id: null, status: 'ready_for_day_of' })
    const reasons = getScheduleBlockReasons(comp)
    expect(reasons).toContain('No stage assigned')
  })

  it('returns ["No judges assigned"] when judge_count is 0 and status past draft', () => {
    const comp = makeComp({
      status: 'ready_for_day_of',
      stage_id: 'stage-a',
      schedule_position: 1,
      roster_confirmed_at: '2026-03-13T10:00:00Z',
      judge_count: 0,
    })
    const reasons = getScheduleBlockReasons(comp)
    expect(reasons).toContain('No judges assigned')
  })

  it('returns empty array when competition is fully ready', () => {
    const comp = makeComp({
      status: 'ready_for_day_of',
      stage_id: 'stage-a',
      schedule_position: 1,
      roster_confirmed_at: '2026-03-13T10:00:00Z',
      judge_count: 2,
    })
    const reasons = getScheduleBlockReasons(comp)
    expect(reasons).toEqual([])
  })

  it('does not report roster/judge issues for draft status', () => {
    const comp = makeComp({
      status: 'draft',
      stage_id: 'stage-a',
      schedule_position: 1,
      roster_confirmed_at: null,
      judge_count: 0,
    })
    const reasons = getScheduleBlockReasons(comp)
    expect(reasons).not.toContain('Roster not confirmed')
    expect(reasons).not.toContain('No judges assigned')
  })

  it('returns multiple reasons when multiple issues exist', () => {
    const comp = makeComp({
      status: 'ready_for_day_of',
      stage_id: null,
      schedule_position: null,
      roster_confirmed_at: null,
      judge_count: 0,
    })
    const reasons = getScheduleBlockReasons(comp)
    expect(reasons).toContain('No stage assigned')
    expect(reasons).toContain('No schedule position')
    expect(reasons).toContain('Roster not confirmed')
    expect(reasons).toContain('No judges assigned')
    expect(reasons).toHaveLength(4)
  })
})
