'use client'

import { useEffect, useState, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { logAudit } from '@/lib/audit'
import { showSuccess, showCritical } from '@/lib/feedback'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronLeft, CheckCircle2 } from 'lucide-react'
import {
  groupBySchedule,
  getScheduleBlockReasons,
  type ScheduleCompetition,
} from '@/lib/engine/schedule'
import { generateHeats, type HeatDancer } from '@/lib/engine/heats'
import { NON_ACTIVE_STATUSES } from '@/lib/engine/anomalies/types'

interface JudgeSession {
  judge_id: string
  event_id: string
  name: string
}

interface Competition {
  id: string
  code: string | null
  name: string
  age_group: string
  level: string
  status: CompetitionStatus
  roster_confirmed_at: string | null
  roster_confirmed_by: string | null
  schedule_position: number | null
  stage_id: string | null
  group_size: number
}

const SCORING_STATUSES: CompetitionStatus[] = ['in_progress', 'awaiting_scores']
const DONE_STATUSES: CompetitionStatus[] = [
  'ready_to_tabulate',
  'complete_unpublished',
  'published',
  'locked',
  'recalled_round_pending',
]
const POLL_INTERVAL_MS = 5000

export default function JudgeEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const router = useRouter()
  const [session, setSession] = useState<JudgeSession | null>(null)
  const [event, setEvent] = useState<Record<string, unknown> | null>(null) // TODO: type when Supabase types generated
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState<string | null>(null)
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([])
  const [judgeCounts, setJudgeCounts] = useState<Map<string, number>>(new Map())
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sort helper: schedule_position first (nulls last), then code
  function sortBySchedule(comps: Competition[]): Competition[] {
    return [...comps].sort((a, b) => {
      if (a.schedule_position !== null && b.schedule_position !== null) {
        return a.schedule_position - b.schedule_position
      }
      if (a.schedule_position !== null) return -1
      if (b.schedule_position !== null) return 1
      return (a.code ?? '').localeCompare(b.code ?? '')
    })
  }

  // Three groups: Score Now, Up Next, Done
  const scoreNowComps = sortBySchedule(
    competitions.filter((c) => SCORING_STATUSES.includes(c.status) || c.status === 'released_to_judge')
  )
  const upNextComps = sortBySchedule(
    competitions.filter((c) => c.status === 'ready_for_day_of' && !!c.roster_confirmed_at)
  )
  const doneComps = sortBySchedule(competitions.filter((c) => DONE_STATUSES.includes(c.status)))

  // Schedule grouping for NOW/NEXT
  const hasSchedulePositions = competitions.some((c) => c.schedule_position !== null)

  const scheduleComps: ScheduleCompetition[] = competitions.map((c) => ({
    id: c.id,
    status: c.status,
    schedule_position: c.schedule_position,
    stage_id: c.stage_id,
    roster_confirmed_at: c.roster_confirmed_at,
    judge_count: judgeCounts.get(c.id) ?? 0,
  }))

  const stageGroupings = stages.map((stage) => ({
    stage,
    grouping: groupBySchedule(scheduleComps, stage.id),
  }))

  const loadCompetitions = useCallback(
    async (judgeId: string) => {
      // Check judge assignments first
      const { data: assignments, error: assignError } = await supabase
        .from('judge_assignments')
        .select('competition_id')
        .eq('judge_id', judgeId)

      if (assignError) {
        console.error('Failed to load judge assignments:', assignError.message)
      }

      const hasAssignments = assignments && assignments.length > 0

      let compData: Competition[]

      if (hasAssignments) {
        const assignedIds = assignments.map((a: { competition_id: string }) => a.competition_id)
        const { data, error } = await supabase
          .from('competitions')
          .select(
            'id, code, name, age_group, level, status, roster_confirmed_at, roster_confirmed_by, schedule_position, stage_id, group_size'
          )
          .in('id', assignedIds)
          .order('code')

        if (error) {
          console.error('Failed to load competitions:', error.message)
        }
        compData = (data as Competition[] | null) ?? []
      } else {
        // Fallback: show all competitions for the event
        const { data, error } = await supabase
          .from('competitions')
          .select(
            'id, code, name, age_group, level, status, roster_confirmed_at, roster_confirmed_by, schedule_position, stage_id, group_size'
          )
          .eq('event_id', eventId)
          .order('code')

        if (error) {
          console.error('Failed to load competitions:', error.message)
        }
        compData = (data as Competition[] | null) ?? []
      }

      return compData
    },
    [supabase, eventId]
  )

  // Poll for status updates
  const pollStatuses = useCallback(
    async (comps: Competition[]) => {
      if (comps.length === 0) return comps

      const ids = comps.map((c) => c.id)
      const { data, error } = await supabase
        .from('competitions')
        .select('id, status, roster_confirmed_at, roster_confirmed_by')
        .in('id', ids)

      if (error) {
        console.error('Poll failed:', error.message)
        return comps
      }

      if (!data) return comps

      const updates = new Map(
        data.map(
          (d: {
            id: string
            status: CompetitionStatus
            roster_confirmed_at: string | null
            roster_confirmed_by: string | null
          }) => [
            d.id,
            {
              status: d.status,
              roster_confirmed_at: d.roster_confirmed_at,
              roster_confirmed_by: d.roster_confirmed_by,
            },
          ]
        )
      )

      return comps.map((c) => {
        const update = updates.get(c.id)
        if (update) {
          return {
            ...c,
            status: update.status,
            roster_confirmed_at: update.roster_confirmed_at,
            roster_confirmed_by: update.roster_confirmed_by,
          }
        }
        return c
      })
    },
    [supabase]
  )

  // Initial load
  useEffect(() => {
    const stored = localStorage.getItem('judge_session')
    if (!stored) {
      router.push('/judge')
      return
    }
    const parsed: JudgeSession = JSON.parse(stored)
    if (parsed.event_id !== eventId) {
      router.push('/judge')
      return
    }
    setSession(parsed)

    async function load() {
      const [eventRes, comps, stagesRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        loadCompetitions(parsed.judge_id),
        supabase
          .from('stages')
          .select('id, name')
          .eq('event_id', eventId)
          .order('display_order'),
      ])
      if (eventRes.error) {
        console.error('Failed to load event:', eventRes.error.message)
      }
      if (stagesRes.error) {
        console.error('Failed to load stages:', stagesRes.error.message)
      }
      setEvent(eventRes.data as Record<string, unknown> | null)
      setCompetitions(comps)
      setStages((stagesRes.data as Array<{ id: string; name: string }> | null) ?? [])

      // Load judge assignment counts for schedule
      if (comps.length > 0) {
        const { data: jaData, error: jaError } = await supabase
          .from('judge_assignments')
          .select('competition_id')
          .in(
            'competition_id',
            comps.map((c) => c.id)
          )

        if (jaError) {
          console.error('Failed to load judge assignment counts:', jaError.message)
        } else {
          const counts = new Map<string, number>()
          for (const row of (jaData ?? []) as Array<{ competition_id: string }>) {
            counts.set(row.competition_id, (counts.get(row.competition_id) ?? 0) + 1)
          }
          setJudgeCounts(counts)
        }
      }

      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling with visibility-aware interval (fallback if Realtime drops)
  useEffect(() => {
    if (loading || competitions.length === 0) return

    function startPolling() {
      if (pollTimerRef.current) return
      pollTimerRef.current = setInterval(async () => {
        const updated = await pollStatuses(competitions)
        setCompetitions(updated)
      }, POLL_INTERVAL_MS)
    }

    function stopPolling() {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stopPolling()
      } else {
        // Poll immediately on re-focus, then resume interval
        pollStatuses(competitions).then((updated) => setCompetitions(updated))
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loading, competitions, pollStatuses])

  // Supabase Realtime subscription for near-instant competition status updates.
  useEffect(() => {
    if (loading || competitions.length === 0) return

    const compIds = competitions.map((c) => c.id)

    const channel = supabase
      .channel('judge-competitions')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'competitions',
        },
        (payload) => {
          const updated = payload.new as {
            id: string
            status: CompetitionStatus
            roster_confirmed_at: string | null
            roster_confirmed_by: string | null
          }
          if (!compIds.includes(updated.id)) return

          setCompetitions((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? {
                    ...c,
                    status: updated.status,
                    roster_confirmed_at: updated.roster_confirmed_at,
                    roster_confirmed_by: updated.roster_confirmed_by,
                  }
                : c
            )
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loading, competitions.length, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleStart(comp: Competition) {
    if (!session) return
    setStarting(comp.id)

    try {
      // If already scoring, just navigate (panel judging -- second judge)
      if (SCORING_STATUSES.includes(comp.status)) {
        router.push(`/judge/${eventId}/${comp.id}`)
        return
      }

      // Validate transition
      if (!canTransition(comp.status, 'in_progress')) {
        showCritical('Cannot start this competition', {
          description: `Current status "${comp.status}" cannot transition to "in_progress".`,
        })
        setStarting(null)
        return
      }

      // Transition to in_progress (atomic conditional update prevents race with concurrent recall)
      const { error } = await supabase
        .from('competitions')
        .update({ status: 'in_progress' })
        .eq('id', comp.id)
        .eq('status', comp.status)

      if (error) {
        showCritical('Failed to start competition', {
          description: error.message,
        })
        setStarting(null)
        return
      }

      // Audit log
      await logAudit(supabase, {
        userId: session.judge_id,
        entityType: 'competition',
        entityId: comp.id,
        action: 'status_change',
        beforeData: { status: comp.status, trigger: 'judge_start' },
        afterData: {
          status: 'in_progress',
          trigger: 'judge_start',
          judge_started_at: new Date().toISOString(),
        },
      })

      // Best-effort: create Round 1 + heat snapshot
      // Don't block scoring if this fails
      try {
        // Check if a round already exists
        const { data: existingRound } = await supabase
          .from('rounds')
          .select('id')
          .eq('competition_id', comp.id)
          .limit(1)
          .maybeSingle()

        let roundId = existingRound?.id ?? null

        // Create Round 1 if it doesn't exist
        if (!roundId) {
          const { data: newRound, error: roundErr } = await supabase
            .from('rounds')
            .insert({ competition_id: comp.id, round_number: 1, round_type: 'standard' })
            .select('id')
            .single()

          if (roundErr) {
            console.error('Failed to create Round 1:', roundErr.message)
          } else {
            roundId = newRound.id
          }
        }

        // Generate and persist heat snapshot
        if (roundId) {
          const { data: regs, error: regErr } = await supabase
            .from('registrations')
            .select('dancer_id, competitor_number, display_order')
            .eq('competition_id', comp.id)
            .not('status', 'in', `(${NON_ACTIVE_STATUSES.join(',')})`)

          if (regErr) {
            console.error('Failed to fetch registrations for heat snapshot:', regErr.message)
          } else {
            const activeDancers: HeatDancer[] = (regs ?? []).map(
              (r: { dancer_id: string; competitor_number: string | null; display_order: number | null }, idx: number) => ({
                dancer_id: r.dancer_id,
                competitor_number: r.competitor_number ?? String(idx + 1),
                display_order: r.display_order ?? (parseInt(r.competitor_number ?? '0', 10) || idx),
              })
            )

            const snapshot = generateHeats(activeDancers, comp.group_size ?? 2)

            const { error: snapErr } = await supabase
              .from('rounds')
              .update({ heat_snapshot: snapshot })
              .eq('id', roundId)

            if (snapErr) {
              console.error('Failed to persist heat snapshot:', snapErr.message)
            }
          }
        }
      } catch (snapshotErr) {
        console.error('Heat snapshot generation failed (non-blocking):', snapshotErr)
      }

      showSuccess('Competition started')
      router.push(`/judge/${eventId}/${comp.id}`)
    } catch (err) {
      showCritical('Unexpected error starting competition', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
      setStarting(null)
    }
  }

  function handleLogout() {
    localStorage.removeItem('judge_session')
    router.push('/judge')
  }

  // Render helper for schedule position badge
  function renderPositionBadge(comp: Competition) {
    if (!hasSchedulePositions || comp.schedule_position === null) return null
    return (
      <span className="font-mono text-xs text-muted-foreground mr-1">
        {comp.schedule_position}.
      </span>
    )
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  const hasNoComps =
    scoreNowComps.length === 0 &&
    upNextComps.length === 0 &&
    doneComps.length === 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {(event as Record<string, unknown>)?.name as string}
          </h1>
          <p className="text-sm text-muted-foreground">
            Signed in as{' '}
            <span className="font-medium text-feis-green">{session?.name}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Sign Out
        </Button>
      </div>

      {/* NOW / NEXT indicator */}
      {hasSchedulePositions && stageGroupings.length > 0 && (
        <div className="space-y-2">
          {stageGroupings.map(({ stage, grouping }) => {
            const nowComp = grouping.now
              ? competitions.find((c) => c.id === grouping.now!.id)
              : null
            const nextComp = grouping.next
              ? competitions.find((c) => c.id === grouping.next!.id)
              : null
            const nextBlockReasons = grouping.next
              ? getScheduleBlockReasons(grouping.next)
              : []

            return (
              <Card key={stage.id} className="feis-card border-feis-green/30">
                <CardContent className="py-3 px-4">
                  {stages.length > 1 && (
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      {stage.name}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase bg-feis-green text-white">
                        NOW
                      </span>
                      <span className="text-sm font-medium">
                        {nowComp ? (
                          <>
                            {nowComp.code && (
                              <span className="font-mono mr-1">{nowComp.code}</span>
                            )}
                            {nowComp.name}
                          </>
                        ) : (
                          <span className="text-muted-foreground">{'\u2014'}</span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase bg-feis-orange-light text-feis-orange">
                        NEXT
                      </span>
                      <span className="text-sm font-medium">
                        {nextComp ? (
                          <>
                            {nextComp.code && (
                              <span className="font-mono mr-1">{nextComp.code}</span>
                            )}
                            {nextComp.name}
                            {nextBlockReasons.length > 0 && (
                              <span className="text-xs text-feis-orange ml-2">
                                {nextBlockReasons.join(' \u00b7 ')}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">{'\u2014'}</span>
                        )}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Score Now — active + incoming */}
      {scoreNowComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg">Score Now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {scoreNowComps.map((comp) => {
              const isIncoming = comp.status === 'released_to_judge'
              const isActive = SCORING_STATUSES.includes(comp.status)
              return isActive ? (
                <Link
                  key={comp.id}
                  href={`/judge/${eventId}/${comp.id}`}
                  className="flex items-center justify-between p-4 rounded-md border border-feis-green/30 bg-feis-green-light/30 hover:bg-feis-green-light/60 transition-colors"
                >
                  <span className="font-medium">
                    {renderPositionBadge(comp)}
                    {comp.code && `${comp.code} `}
                    {comp.name}
                  </span>
                  <Badge variant="default">Score Now</Badge>
                </Link>
              ) : (
                <div
                  key={comp.id}
                  className="flex items-center justify-between p-4 rounded-md border border-feis-orange/30 bg-feis-orange/5"
                >
                  <span className="font-medium">
                    {renderPositionBadge(comp)}
                    {comp.code && `${comp.code} `}
                    {comp.name}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => handleStart(comp)}
                    disabled={starting === comp.id}
                  >
                    {starting === comp.id ? 'Starting...' : 'Start Scoring'}
                  </Button>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Up Next */}
      {upNextComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg">Up Next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upNextComps.map((comp) => (
              <div
                key={comp.id}
                className="flex items-center justify-between p-4 rounded-md border"
              >
                <span className="font-medium">
                  {renderPositionBadge(comp)}
                  {comp.code && `${comp.code} `}
                  {comp.name}
                </span>
                <Button
                  size="sm"
                  onClick={() => handleStart(comp)}
                  disabled={starting === comp.id}
                >
                  {starting === comp.id ? 'Starting...' : 'Start'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Done */}
      {doneComps.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{doneComps.length}</span> competition{doneComps.length !== 1 ? 's' : ''} complete
        </p>
      )}

      {/* Empty state */}
      {hasNoComps && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No competitions assigned yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Check back when the organizer assigns you to competitions.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
