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
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Classify competitions into five groups
  const scoringComps = competitions.filter((c) => SCORING_STATUSES.includes(c.status))
  const incomingComps = competitions.filter((c) => c.status === 'released_to_judge')
  const readyToStartComps = competitions.filter(
    (c) => c.status === 'ready_for_day_of' && !!c.roster_confirmed_at
  )
  const waitingComps = competitions.filter(
    (c) =>
      (c.status === 'ready_for_day_of' && !c.roster_confirmed_at) ||
      c.status === 'imported'
  )
  const doneComps = competitions.filter((c) => DONE_STATUSES.includes(c.status))

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
          .select('id, code, name, age_group, level, status, roster_confirmed_at, roster_confirmed_by')
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
          .select('id, code, name, age_group, level, status, roster_confirmed_at, roster_confirmed_by')
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
      const [eventRes, comps] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        loadCompetitions(parsed.judge_id),
      ])
      if (eventRes.error) {
        console.error('Failed to load event:', eventRes.error.message)
      }
      setEvent(eventRes.data as Record<string, unknown> | null)
      setCompetitions(comps)
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
  // NOTE: Requires Realtime to be enabled on the `competitions` table in the
  // Supabase dashboard (Database → Replication → enable `competitions`).
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
  }, [loading, competitions.length, supabase])

  async function handleStart(comp: Competition) {
    if (!session) return
    setStarting(comp.id)

    try {
      // If already scoring, just navigate (panel judging — second judge)
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
        afterData: { status: 'in_progress', trigger: 'judge_start', judge_started_at: new Date().toISOString() },
      })

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

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  const hasNoComps =
    scoringComps.length === 0 &&
    incomingComps.length === 0 &&
    readyToStartComps.length === 0 &&
    waitingComps.length === 0 &&
    doneComps.length === 0

  return (
    <div className="space-y-6">
      <Link
        href="/judge"
        className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{(event as Record<string, unknown>)?.name as string}</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-feis-green">{session?.name}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Sign Out
        </Button>
      </div>

      {/* Scoring — active competitions */}
      {scoringComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg">Scoring</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {scoringComps.map((comp) => (
              <Link
                key={comp.id}
                href={`/judge/${eventId}/${comp.id}`}
                className="flex items-center justify-between p-4 rounded-md border border-feis-green/30 bg-feis-green-light/30 hover:bg-feis-green-light/60 transition-colors"
              >
                <div>
                  <span className="font-medium">
                    {comp.code && `${comp.code} — `}
                    {comp.name}
                  </span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {comp.age_group} · {comp.level}
                  </span>
                </div>
                <Badge variant="default">Score Now</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Incoming — sent by side-stage */}
      {incomingComps.length > 0 && (
        <Card className="feis-card border-feis-orange">
          <CardHeader>
            <CardTitle className="text-lg text-feis-orange flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-feis-orange animate-pulse" />
              Incoming
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {incomingComps.map((comp) => (
              <div
                key={comp.id}
                className="flex items-center justify-between p-4 rounded-md border border-feis-orange/30 bg-feis-orange/5"
              >
                <div>
                  <span className="font-medium">
                    {comp.code && `${comp.code} — `}
                    {comp.name}
                  </span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {comp.age_group} · {comp.level}
                  </span>
                  <p className="text-sm text-feis-orange mt-1">Sent by side-stage</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleStart(comp)}
                  disabled={starting === comp.id}
                >
                  {starting === comp.id ? 'Starting...' : 'Start Scoring'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Ready to Start */}
      {readyToStartComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg">Ready to Start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {readyToStartComps.map((comp) => (
              <div
                key={comp.id}
                className="flex items-center justify-between p-4 rounded-md border border-feis-orange/30 bg-feis-orange/5"
              >
                <div>
                  <span className="font-medium">
                    {comp.code && `${comp.code} — `}
                    {comp.name}
                  </span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {comp.age_group} · {comp.level}
                  </span>
                </div>
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

      {/* Waiting */}
      {waitingComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg text-muted-foreground">Waiting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {waitingComps.map((comp) => (
              <div
                key={comp.id}
                className="flex items-center justify-between p-3 rounded-md border opacity-60"
              >
                <div>
                  <span className="font-medium">
                    {comp.code && `${comp.code} — `}
                    {comp.name}
                  </span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {comp.age_group} · {comp.level}
                  </span>
                </div>
                <Badge variant="outline">
                  {comp.status === 'imported' ? 'Not ready' : 'Roster not confirmed yet'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Complete */}
      {doneComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg text-muted-foreground">Complete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {doneComps.map((comp) => (
              <div
                key={comp.id}
                className="flex items-center justify-between p-3 rounded-md border opacity-60"
              >
                <div>
                  <span className="font-medium">
                    {comp.code && `${comp.code} — `}
                    {comp.name}
                  </span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {comp.age_group} · {comp.level}
                  </span>
                </div>
                <CheckCircle2 className="h-5 w-5 text-feis-green" />
              </div>
            ))}
          </CardContent>
        </Card>
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
