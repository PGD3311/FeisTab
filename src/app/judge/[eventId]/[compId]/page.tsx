'use client'

import { useEffect, useState, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { logAudit } from '@/lib/audit'
import { canEnterScores, type EntryMode } from '@/lib/entry-mode'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { NON_ACTIVE_STATUSES, type RegistrationStatus } from '@/lib/engine/anomalies/types'
import { getCurrentHeat, type HeatSnapshot } from '@/lib/engine/heats'
import { showSuccess, showCritical } from '@/lib/feedback'
import { validateCommentData, type CommentData } from '@/lib/comment-codes'
import { useSupabase } from '@/hooks/use-supabase'
import { ScoreEntryForm } from '@/components/score-entry-form'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface JudgeSession {
  judge_id: string
  event_id: string
  name: string
}

export default function JudgeScoringPage({
  params,
}: {
  params: Promise<{ eventId: string; compId: string }>
}) {
  const { eventId, compId } = use(params)
  const supabase = useSupabase()
  const router = useRouter()
  const [session, setSession] = useState<JudgeSession | null>(null)
  // TODO: type when Supabase types generated
  const [comp, setComp] = useState<any>(null)
  const [registrations, setRegistrations] = useState<any[]>([])
  const [round, setRound] = useState<any>(null)
  const [scores, setScores] = useState<any[]>([])
  const [ruleConfig, setRuleConfig] = useState<any>(null)
  const [submitted, setSubmitted] = useState(false)
  const [packetBlocked, setPacketBlocked] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [expandedDancerId, setExpandedDancerId] = useState<string | null>(null)
  const [expandedHeats, setCollapsedHeats] = useState<Set<number>>(new Set())

  // Polling
  const POLL_INTERVAL_MS = 5000
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Lightweight poll: fetch registration statuses and round heat_snapshot
  const pollData = useCallback(async () => {
    const [regRes, roundRes] = await Promise.all([
      supabase
        .from('registrations')
        .select('id, status')
        .eq('competition_id', compId),
      supabase
        .from('rounds')
        .select('id, heat_snapshot')
        .eq('competition_id', compId)
        .order('round_number', { ascending: false })
        .limit(1)
        .single(),
    ])

    if (regRes.error) return

    // Update registration statuses if any changed (scratches, no-shows)
    const newRegs = regRes.data ?? []
    setRegistrations(
      (prev: Array<{ id: string; status: string; [key: string]: unknown }>) => {
        const changed = newRegs.some((nr: { id: string; status: string }) => {
          const pr = prev.find((p) => p.id === nr.id)
          return !pr || pr.status !== nr.status
        })
        if (!changed) return prev
        return prev.map((p) => {
          const nr = newRegs.find((n: { id: string }) => n.id === p.id)
          return nr ? { ...p, status: nr.status } : p
        })
      }
    )

    // Update round heat_snapshot if changed
    if (!roundRes.error && roundRes.data) {
      setRound(
        (prev: { id: string; heat_snapshot: unknown; [key: string]: unknown } | null) => {
          if (!prev || prev.id !== roundRes.data.id) return prev
          const newSnapshot = JSON.stringify(roundRes.data.heat_snapshot)
          const oldSnapshot = JSON.stringify(prev.heat_snapshot)
          if (newSnapshot === oldSnapshot) return prev
          return { ...prev, heat_snapshot: roundRes.data.heat_snapshot }
        }
      )
    }
  }, [supabase, compId])

  // Track if competition has been recalled/changed by organizer
  const [compRecalled, setCompRecalled] = useState(false)
  // Statuses that are normal progression — don't show recall banner for these
  const SCORING_OR_DONE = ['in_progress', 'awaiting_scores', 'ready_to_tabulate', 'complete_unpublished', 'published', 'locked', 'recalled_round_pending']

  // Realtime subscriptions for instant updates from organizer actions
  useEffect(() => {
    if (loading || submitted) return

    const channel = supabase
      .channel(`judge-scoring-${compId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'registrations', filter: `competition_id=eq.${compId}` }, () => {
        void pollData()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `competition_id=eq.${compId}` }, () => {
        void pollData()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'competitions', filter: `id=eq.${compId}` }, (payload) => {
        const updated = payload.new as { status: string }
        if (!SCORING_OR_DONE.includes(updated.status)) {
          setCompRecalled(true)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loading, submitted, supabase, compId, pollData])

  // Visibility-aware polling (fallback)
  useEffect(() => {
    if (loading || submitted) return

    function startPolling() {
      if (pollTimerRef.current) return
      pollTimerRef.current = setInterval(() => {
        void pollData()
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
        void pollData()
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loading, submitted, pollData])

  useEffect(() => {
    const stored = localStorage.getItem('judge_session')
    if (!stored) {
      router.push('/judge')
      return
    }
    let parsed: JudgeSession
    try {
      parsed = JSON.parse(stored)
    } catch {
      localStorage.removeItem('judge_session')
      router.push('/judge')
      return
    }
    if (parsed.event_id !== eventId) {
      router.push('/judge')
      return
    }
    setSession(parsed)
    loadData(parsed.judge_id)
  }, [])

  async function loadData(judgeId: string) {
    const [compRes, regRes, roundRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId).order('competitor_number'),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number', { ascending: false }).limit(1).single(),
    ])

    if (compRes.error) {
      console.error('Failed to load competition:', compRes.error.message)
      setLoading(false)
      return
    }
    if (regRes.error) {
      console.error('Failed to load registrations:', regRes.error.message)
      setLoadError(true)
      setLoading(false)
      return
    }

    setComp(compRes.data)
    setRegistrations(regRes.data ?? [])
    setRuleConfig(compRes.data?.rule_sets?.config)

    // Ensure a round exists — create one if the event page's best-effort creation failed
    let round = roundRes.error ? null : roundRes.data
    if (!round) {
      const { data: newRound, error: createErr } = await supabase
        .from('rounds')
        .insert({ competition_id: compId, round_number: 1, round_type: 'standard' })
        .select()
        .single()
      if (createErr) {
        console.error('Failed to create round:', createErr.message)
        setLoadError(true)
        setLoading(false)
        return
      }
      round = newRound
    }
    setRound(round)

    if (round) {
      if (round.judge_sign_offs?.[judgeId]) {
        setSubmitted(true)
      }

      const { data: existingScores, error: scoresErr } = await supabase
        .from('score_entries')
        .select('*')
        .eq('round_id', round.id)
        .eq('judge_id', judgeId)
      if (scoresErr) {
        console.error('Failed to load scores:', scoresErr.message)
        setLoadError(true)
        setLoading(false)
        return
      }
      setScores(existingScores ?? [])

      const entries = existingScores ?? []
      const existingModes = entries.map((s: { entry_mode: string }) => s.entry_mode)
      if (existingModes.length > 0) {
        const check = canEnterScores(existingModes as EntryMode[], 'judge_self_service')
        if (!check.allowed) {
          setPacketBlocked(check.reason ?? 'Scores are being entered by the tabulator.')
        } else {
          setPacketBlocked(null)
        }
      } else {
        setPacketBlocked(null)
      }
    }

    setLoading(false)
  }

  async function handleScoreSubmit(dancerId: string, score: number, flagged: boolean, flagReason: string | null, commentData: CommentData | null) {
    if (!session || !round) return

    const { error } = await supabase.from('score_entries').upsert(
      {
        round_id: round.id,
        competition_id: compId,
        dancer_id: dancerId,
        judge_id: session.judge_id,
        raw_score: score,
        flagged,
        flag_reason: flagReason,
        entry_mode: 'judge_self_service',
        comment_data: validateCommentData(commentData),
      },
      { onConflict: 'round_id,dancer_id,judge_id' }
    )
    if (error) throw new Error(`Failed to save score: ${error.message}`)

    void logAudit(supabase, {
      userId: null,
      entityType: 'score_entry',
      entityId: compId,
      action: 'score_submit',
      afterData: {
        dancer_id: dancerId,
        judge_id: session.judge_id,
        raw_score: score,
        flagged,
        entry_mode: 'judge_self_service',
      },
    })

    loadData(session.judge_id)
  }

  async function handleSignOff() {
    if (!session || !round) return

    try {
      // Lock all scores for this judge/round
      const { error: lockErr } = await supabase
        .from('score_entries')
        .update({ locked_at: new Date().toISOString() })
        .eq('round_id', round.id)
        .eq('judge_id', session.judge_id)
      if (lockErr) throw new Error(`Failed to lock scores: ${lockErr.message}`)

      // Record sign-off in round's judge_sign_offs jsonb
      const currentSignOffs = round.judge_sign_offs || {}
      const updatedSignOffs = {
        ...currentSignOffs,
        [session.judge_id]: new Date().toISOString(),
      }
      const { error: signOffErr } = await supabase
        .from('rounds')
        .update({ judge_sign_offs: updatedSignOffs })
        .eq('id', round.id)
      if (signOffErr) throw new Error(`Failed to record sign-off: ${signOffErr.message}`)

      // Check if all ASSIGNED judges (not all event judges) have signed off
      const { data: assignments, error: assignErr } = await supabase
        .from('judge_assignments')
        .select('judge_id')
        .eq('competition_id', compId)
      if (assignErr) throw new Error(`Failed to check judge assignments: ${assignErr.message}`)

      // Fall back to all event judges if no assignments exist
      let assignedJudgeIds: string[]
      if (assignments && assignments.length > 0) {
        assignedJudgeIds = assignments.map((a: { judge_id: string }) => a.judge_id)
      } else {
        const { data: allJudges, error: judgesErr } = await supabase
          .from('judges')
          .select('id')
          .eq('event_id', eventId)
        if (judgesErr) throw new Error(`Failed to check judges: ${judgesErr.message}`)
        assignedJudgeIds = allJudges?.map(j => j.id) ?? []
      }

      const allDone = assignedJudgeIds.length > 0 && assignedJudgeIds.every(id => updatedSignOffs[id])

      if (allDone) {
        const { data: currentComp, error: compErr } = await supabase
          .from('competitions')
          .select('status')
          .eq('id', compId)
          .single()
        if (compErr) throw new Error(`Failed to check competition status: ${compErr.message}`)

        // Step through transitions to reach ready_to_tabulate
        let currentStatus = currentComp?.status as CompetitionStatus
        if (currentStatus === 'ready_to_tabulate') {
          // Already there — idempotent
        } else {
          if (canTransition(currentStatus, 'awaiting_scores') && !canTransition(currentStatus, 'ready_to_tabulate')) {
            const { error: midErr } = await supabase
              .from('competitions')
              .update({ status: 'awaiting_scores' })
              .eq('id', compId)
            if (midErr) throw new Error(`Failed to update status: ${midErr.message}`)
            void logAudit(supabase, {
              userId: null,
              entityType: 'competition',
              entityId: compId,
              action: 'status_change',
              afterData: { from: currentStatus, to: 'awaiting_scores', trigger: 'auto_advance_on_sign_off' },
            })
            currentStatus = 'awaiting_scores' as CompetitionStatus
          }
          if (canTransition(currentStatus, 'ready_to_tabulate')) {
            const { error: statusErr } = await supabase
              .from('competitions')
              .update({ status: 'ready_to_tabulate' })
              .eq('id', compId)
            if (statusErr) throw new Error(`Failed to update competition status: ${statusErr.message}`)
            void logAudit(supabase, {
              userId: null,
              entityType: 'competition',
              entityId: compId,
              action: 'status_change',
              afterData: { from: currentStatus, to: 'ready_to_tabulate', trigger: 'auto_advance_on_sign_off' },
            })
          }
        }
      }

      void logAudit(supabase, {
        userId: null,
        entityType: 'round',
        entityId: round.id,
        action: 'sign_off',
        afterData: {
          judge_id: session.judge_id,
          competition_id: compId,
          entry_mode: 'judge_self_service',
          all_judges_done: allDone,
        },
      })

      setSubmitted(true)
      showSuccess('Round signed off')
    } catch (err) {
      showCritical('Sign-off failed', { description: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>
  if (!comp) return <p className="p-6">Competition not found.</p>

  if (loadError) {
    return (
      <div className="p-6 space-y-4">
        <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20 text-destructive">
          <p className="font-medium">Could not load competition data.</p>
          <p className="text-sm mt-1">Check your connection and try again.</p>
        </div>
        <Button
          onClick={() => {
            setLoadError(false)
            setLoading(true)
            if (session) loadData(session.judge_id)
          }}
          size="lg"
          className="w-full text-lg py-6"
        >
          Retry
        </Button>
      </div>
    )
  }

  const scoreMin = ruleConfig?.score_min ?? 0
  const scoreMax = ruleConfig?.score_max ?? 100
  const activeDancers = registrations.filter(
    r => !NON_ACTIVE_STATUSES.includes(r.status ?? 'registered')
  )
  const scoredCount = scores.length
  const totalDancers = activeDancers.length

  // Heat grouping
  const heatSnapshot = (round?.heat_snapshot as HeatSnapshot) ?? null
  const scoredDancerIds = new Set(scores.map((s: { dancer_id: string }) => s.dancer_id))
  const currentHeat = heatSnapshot ? getCurrentHeat(heatSnapshot, scoredDancerIds) : null
  const totalHeats = heatSnapshot?.heats.length ?? 0
  const currentHeatNumber = currentHeat?.heat_number ?? (totalHeats > 0 ? totalHeats : 0)

  // Current dancer = first unscored active dancer (in heat order if grouped)
  function computeCurrentDancerId(): string | null {
    if (heatSnapshot) {
      for (const heat of heatSnapshot.heats) {
        for (const slot of heat.slots) {
          if (slot.status === 'active' && !scoredDancerIds.has(slot.dancer_id)) {
            return slot.dancer_id
          }
        }
      }
      return null
    }
    const unscoredReg = activeDancers.find(r => !scoredDancerIds.has(r.dancer_id))
    return unscoredReg?.dancer_id ?? null
  }

  const currentDancerId = computeCurrentDancerId()

  // Show sign-off bar when all scored and not yet submitted
  const showSignOff = scoredCount === totalDancers && totalDancers > 0 && !submitted

  function renderScoreEntry(reg: (typeof registrations)[number]) {
    const existing = scores.find((s: { dancer_id: string }) => s.dancer_id === reg.dancer_id)
    return (
      <ScoreEntryForm
        key={reg.id}
        dancerId={reg.dancer_id}
        dancerName={`${reg.dancers?.first_name} ${reg.dancers?.last_name}`}
        competitorNumber={reg.competitor_number}
        existingScore={existing?.raw_score}
        existingFlagged={existing?.flagged ?? false}
        existingFlagReason={existing?.flag_reason}
        existingCommentData={existing?.comment_data as CommentData | null | undefined}
        existingLegacyComments={existing?.comments as string | null | undefined}
        scoreMin={scoreMin}
        scoreMax={scoreMax}
        onSubmit={handleScoreSubmit}
        locked={submitted}
        isCurrentDancer={reg.dancer_id === currentDancerId}
        isExpanded={expandedDancerId === reg.dancer_id}
        onToggleExpand={(id) =>
          setExpandedDancerId(prev => (prev === id ? null : id))
        }
        onSaved={() => setExpandedDancerId(null)}
      />
    )
  }

  function renderHeatGrouped() {
    if (!heatSnapshot) return null

    return (
      <div className="space-y-4 mb-6">
        {/* Absent dancers not in heats */}
        {(() => {
          const allHeatDancerIds = new Set(heatSnapshot.heats.flatMap(h => h.slots.map(s => s.dancer_id)))
          const absentRegs = registrations.filter(
            (r: { dancer_id: string; status: string }) =>
              !allHeatDancerIds.has(r.dancer_id) && NON_ACTIVE_STATUSES.includes((r.status ?? 'registered') as RegistrationStatus)
          )
          if (absentRegs.length === 0) return null
          return (
            <div className="space-y-1">
              {absentRegs.map((reg: (typeof registrations)[number]) => renderAbsentDancer(reg))}
            </div>
          )
        })()}
        {heatSnapshot.heats.map((heat) => {
          const heatDancerIds = new Set(heat.slots.map(s => s.dancer_id))
          const heatRegs = registrations.filter((r: { dancer_id: string }) => heatDancerIds.has(r.dancer_id))
          const isCurrentHeat = heat.heat_number === currentHeat?.heat_number
          const heatActiveSlots = heat.slots.filter(s => s.status === 'active')
          const heatScoredCount = heatActiveSlots.filter(s => scoredDancerIds.has(s.dancer_id)).length
          const isHeatComplete = heatScoredCount === heatActiveSlots.length && heatActiveSlots.length > 0
          const isCollapsed = !expandedHeats.has(heat.heat_number)
          const isUpcoming = !isCurrentHeat && !isHeatComplete

          // Completed heats collapse to single line (user can re-expand)
          if (isHeatComplete && !isCurrentHeat && isCollapsed) {
            return (
              <button
                key={heat.heat_number}
                type="button"
                onClick={() => {
                  setCollapsedHeats(prev => {
                    const next = new Set(prev)
                    if (next.has(heat.heat_number)) {
                      next.delete(heat.heat_number)
                    } else {
                      next.add(heat.heat_number)
                    }
                    return next
                  })
                }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border/50 bg-muted/30 opacity-60 hover:opacity-80 transition-opacity text-left"
              >
                <span className="text-sm text-muted-foreground">
                  Heat {heat.heat_number} — Complete
                </span>
                <span className="text-feis-green text-sm">{isCollapsed ? '\u25BE' : '\u2713'}</span>
              </button>
            )
          }

          return (
            <div
              key={heat.heat_number}
              className={`rounded-lg border-2 ${
                isCurrentHeat
                  ? 'border-feis-green bg-feis-green-light/30'
                  : isUpcoming
                    ? 'border-border/30 opacity-70'
                    : 'border-border/30'
              }`}
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/30">
                <div className="flex items-center gap-2">
                  {isCurrentHeat && (
                    <span className="inline-block w-2 h-2 rounded-full bg-feis-green animate-pulse" />
                  )}
                  <span className={`text-sm font-semibold ${isCurrentHeat ? 'text-feis-green' : 'text-muted-foreground'}`}>
                    Heat {heat.heat_number}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground font-mono">
                  {heatScoredCount}/{heatActiveSlots.length}
                </span>
              </div>
              <div className="p-2 space-y-1">
                {heatRegs.map((reg: (typeof registrations)[number]) => {
                  const slot = heat.slots.find(s => s.dancer_id === reg.dancer_id)
                  const isInactive = slot && slot.status !== 'active'
                  if (isInactive) {
                    return (
                      <div key={reg.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/50 opacity-60">
                        <span className="font-mono text-base w-12 text-right text-muted-foreground line-through">
                          {reg.competitor_number ?? '\u2014'}
                        </span>
                        <Badge variant="outline" className="text-feis-orange border-feis-orange/30 text-xs">
                          {slot.status === 'scratched' ? 'Scratched' : slot.status === 'no_show' ? 'No Show' : slot.status}
                        </Badge>
                      </div>
                    )
                  }
                  return renderScoreEntry(reg)
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function renderAbsentDancer(reg: (typeof registrations)[number]) {
    return (
      <div key={reg.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/50 opacity-60">
        <span className="font-mono text-lg font-bold w-14 text-right text-muted-foreground line-through">
          {reg.competitor_number ?? '\u2014'}
        </span>
        <span className="text-muted-foreground line-through">
          {reg.dancers?.first_name} {reg.dancers?.last_name}
        </span>
        <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs ml-auto">
          {reg.status === 'scratched' ? 'Scratched' : reg.status === 'no_show' ? 'No Show' : 'Absent'}
        </Badge>
      </div>
    )
  }

  function renderFlatList() {
    return (
      <div className="space-y-1 mb-6">
        {registrations.map((reg: (typeof registrations)[number]) => {
          const isAbsent = NON_ACTIVE_STATUSES.includes((reg.status ?? 'registered') as RegistrationStatus)
          return isAbsent ? renderAbsentDancer(reg) : renderScoreEntry(reg)
        })}
      </div>
    )
  }

  return (
    <div className={showSignOff ? 'pb-24' : ''}>
      <div className="mb-3">
        <Link href={`/judge/${eventId}`} className="text-sm text-muted-foreground hover:text-feis-green transition-colors">
          &larr; comps
        </Link>
      </div>

      {/* Compact header bar */}
      <div className="flex items-center justify-between border-b-2 border-feis-green pb-3 mb-4">
        <div>
          {comp.code && (
            <span className="font-mono text-sm text-feis-green/50">{comp.code}</span>
          )}
          <span className="text-base font-semibold ml-1">{comp.name}</span>
        </div>
        <span className="text-sm text-muted-foreground font-mono">
          {heatSnapshot && totalHeats > 0 ? `Heat ${currentHeatNumber} \u00B7 ` : ''}{scoredCount} of {totalDancers} scored
        </span>
      </div>

      {compRecalled ? (
        <Card className="border-destructive">
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-destructive">Competition recalled by organizer</p>
            <p className="text-sm text-muted-foreground mt-2">Scoring has been paused. Contact the organizer.</p>
            <Link href={`/judge/${eventId}`}>
              <Button variant="outline" className="mt-4">Back to Competitions</Button>
            </Link>
          </CardContent>
        </Card>
      ) : submitted ? (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-feis-green">Round signed off. Scores locked.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Contact the tabulator if you need to make changes.
            </p>
            <Link href={`/judge/${eventId}`}>
              <Button variant="outline" className="mt-4">Back to Competitions</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {packetBlocked && (
            <Card className="border-feis-orange/20 bg-feis-orange-light">
              <CardContent className="py-6 text-center">
                <p className="text-sm font-medium text-feis-orange">
                  Your scores are being entered by the tabulator.
                </p>
                <p className="text-xs text-feis-orange/80 mt-1">
                  Contact the tabulator if you need to make changes.
                </p>
              </CardContent>
            </Card>
          )}

          {!packetBlocked && (
            <>
              {heatSnapshot ? renderHeatGrouped() : renderFlatList()}
            </>
          )}
        </>
      )}

      {/* Fixed sign-off bar */}
      {showSignOff && !packetBlocked && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-card border-t-2 border-feis-green z-50">
          <Button
            onClick={handleSignOff}
            className="w-full py-6 text-lg font-semibold bg-feis-green hover:bg-feis-green/90"
          >
            Sign Off — All {totalDancers} Dancers Scored
          </Button>
        </div>
      )}
    </div>
  )
}
