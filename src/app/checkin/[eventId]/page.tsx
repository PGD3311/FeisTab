'use client'

import { useEffect, useState, useCallback, useRef, use } from 'react'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { logAudit } from '@/lib/audit'
import { getCurrentHeat, type HeatSnapshot } from '@/lib/engine/heats'
import { showSuccess, showError } from '@/lib/feedback'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import {
  groupBySchedule,
  getScheduleBlockReasons,
  type ScheduleCompetition,
} from '@/lib/engine/schedule'

// --- Interfaces ---

interface EventInfo {
  id: string
  name: string
}

interface Judge {
  id: string
  first_name: string
  last_name: string
}

interface Competition {
  id: string
  code: string | null
  name: string
  age_group: string | null
  level: string | null
  status: CompetitionStatus
  roster_confirmed_at: string | null
  roster_confirmed_by: string | null
  schedule_position: number | null
  stage_id: string | null
}

interface Registration {
  id: string
  dancer_id: string
  competitor_number: string | null
  status: string
  first_name: string
  last_name: string
}

// --- Status grouping ---

const SCORING_STATUSES: CompetitionStatus[] = ['in_progress', 'awaiting_scores']
const SENT_STATUSES: CompetitionStatus[] = ['released_to_judge']
const CALL_TO_STAGE_STATUSES: CompetitionStatus[] = [
  'released_to_judge',
  'in_progress',
  'awaiting_scores',
]
const UPCOMING_STATUSES: CompetitionStatus[] = ['imported', 'draft']
const COMPLETE_STATUSES: CompetitionStatus[] = [
  'ready_to_tabulate',
  'complete_unpublished',
  'published',
  'locked',
  'recalled_round_pending',
]

// Statuses where roster can be confirmed
const CONFIRMABLE_STATUSES: CompetitionStatus[] = ['draft', 'imported', 'ready_for_day_of']

// Statuses where roster can be un-confirmed
const UNCONFIRMABLE_STATUSES: CompetitionStatus[] = ['ready_for_day_of']

const DANCER_STATUSES = ['present', 'no_show', 'scratched'] as const
type DancerStatus = (typeof DANCER_STATUSES)[number]

const DANCER_STATUS_LABELS: Record<DancerStatus, string> = {
  present: 'Present',
  no_show: 'No Show',
  scratched: 'Scratched',
}

const POLL_INTERVAL_MS = 5000

export default function RosterConfirmationPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  const supabase = useSupabase()

  const [event, setEvent] = useState<EventInfo | null>(null)
  const [judges, setJudges] = useState<Judge[]>([])
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [selectedJudgeId, setSelectedJudgeId] = useState<string>('')
  const [assignedCompIds, setAssignedCompIds] = useState<Set<string> | null>(null)
  const [loading, setLoading] = useState(true)

  // Expanded competition roster state
  const [expandedCompId, setExpandedCompId] = useState<string | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loadingRegistrations, setLoadingRegistrations] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const [confirmingRoster, setConfirmingRoster] = useState<string | null>(null)

  // Schedule awareness
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([])
  const [selectedStageId, setSelectedStageId] = useState<string>('')
  const [judgeCounts, setJudgeCounts] = useState<Map<string, number>>(new Map())

  // Heat snapshot state for scoring competitions
  const [heatSnapshot, setHeatSnapshot] = useState<HeatSnapshot | null>(null)
  const [heatScoredDancerIds, setHeatScoredDancerIds] = useState<Set<string>>(new Set())
  const [loadingHeatData, setLoadingHeatData] = useState(false)

  // Done section collapsed state
  const [doneExpanded, setDoneExpanded] = useState(false)

  // Event-wide check-in map: dancer_id -> { competitor_number, checked_in_at }
  const [checkInMap, setCheckInMap] = useState<
    Map<string, { competitor_number: string; checked_in_at: string | null }>
  >(new Map())

  // Polling
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const competitionsRef = useRef<Competition[]>([])

  // Keep ref in sync
  useEffect(() => {
    competitionsRef.current = competitions
  }, [competitions])

  // --- Data Loading ---

  const loadInitialData = useCallback(async () => {
    const [eventRes, judgesRes, compsRes, stagesRes] = await Promise.all([
      supabase.from('events').select('id, name').eq('id', eventId).single(),
      supabase
        .from('judges')
        .select('id, first_name, last_name')
        .eq('event_id', eventId)
        .order('last_name'),
      supabase
        .from('competitions')
        .select(
          'id, code, name, age_group, level, status, roster_confirmed_at, roster_confirmed_by, schedule_position, stage_id'
        )
        .eq('event_id', eventId)
        .order('code'),
      supabase
        .from('stages')
        .select('id, name')
        .eq('event_id', eventId)
        .order('display_order'),
    ])

    if (eventRes.error) {
      console.error('Failed to load event:', eventRes.error.message)
      showError('Failed to load event', { description: eventRes.error.message })
    }
    if (judgesRes.error) {
      console.error('Failed to load judges:', judgesRes.error.message)
    }
    if (compsRes.error) {
      console.error('Failed to load competitions:', compsRes.error.message)
    }
    if (stagesRes.error) {
      console.error('Failed to load stages:', stagesRes.error.message)
    }

    const loadedComps = (compsRes.data as Competition[] | null) ?? []

    setEvent(eventRes.data as EventInfo | null)
    setJudges((judgesRes.data as Judge[] | null) ?? [])
    setCompetitions(loadedComps)
    setStages((stagesRes.data as Array<{ id: string; name: string }> | null) ?? [])

    // Load judge assignment counts
    if (loadedComps.length > 0) {
      const { data: jaData, error: jaError } = await supabase
        .from('judge_assignments')
        .select('competition_id')
        .in(
          'competition_id',
          loadedComps.map((c) => c.id)
        )

      if (jaError) {
        console.error('Failed to load judge assignments:', jaError.message)
      } else {
        const counts = new Map<string, number>()
        for (const row of (jaData ?? []) as Array<{ competition_id: string }>) {
          counts.set(row.competition_id, (counts.get(row.competition_id) ?? 0) + 1)
        }
        setJudgeCounts(counts)
      }
    }

    setLoading(false)
  }, [supabase, eventId])

  // Load judge assignments when judge filter changes
  const loadJudgeAssignments = useCallback(
    async (judgeId: string) => {
      if (!judgeId) {
        setAssignedCompIds(null)
        return
      }

      const { data, error } = await supabase
        .from('judge_assignments')
        .select('competition_id')
        .eq('judge_id', judgeId)

      if (error) {
        console.error('Failed to load judge assignments:', error.message)
        setAssignedCompIds(null)
        return
      }

      const ids = new Set(
        (data as Array<{ competition_id: string }> | null)?.map((a) => a.competition_id) ?? []
      )
      setAssignedCompIds(ids)
    },
    [supabase]
  )

  // Load registrations for expanded competition
  async function loadRegistrations(competitionId: string) {
    setLoadingRegistrations(true)
    const { data, error } = await supabase
      .from('registrations')
      .select('id, dancer_id, competitor_number, status, dancers(first_name, last_name)')
      .eq('competition_id', competitionId)
      .order('competitor_number')

    if (error) {
      console.error('Failed to load registrations:', error.message)
      showError('Failed to load roster', { description: error.message })
      setLoadingRegistrations(false)
      return
    }

    // Transform joined data
    const rawRows = (data ?? []) as unknown as Array<{
      id: string
      dancer_id: string
      competitor_number: string | null
      status: string
      dancers: { first_name: string; last_name: string }
    }>

    const regs: Registration[] = rawRows.map((row) => ({
      id: row.id,
      dancer_id: row.dancer_id,
      competitor_number: row.competitor_number,
      status: row.status,
      first_name: row.dancers.first_name,
      last_name: row.dancers.last_name,
    }))

    setRegistrations(regs)
    setLoadingRegistrations(false)
  }

  // Load event-wide check-in data
  const loadCheckIns = useCallback(async () => {
    const { data, error } = await supabase
      .from('event_check_ins')
      .select('dancer_id, competitor_number, checked_in_at')
      .eq('event_id', eventId)

    if (error) {
      console.error('Failed to load check-ins:', error.message)
      showError('Failed to load check-in data', { description: error.message })
      return
    }

    const map = new Map<string, { competitor_number: string; checked_in_at: string | null }>()
    for (const row of data ?? []) {
      map.set(row.dancer_id, {
        competitor_number: row.competitor_number,
        checked_in_at: row.checked_in_at,
      })
    }
    setCheckInMap(map)
  }, [supabase, eventId])

  // --- Polling ---

  const pollStatuses = useCallback(async () => {
    const comps = competitionsRef.current
    if (comps.length === 0) return

    const ids = comps.map((c) => c.id)
    const { data, error } = await supabase
      .from('competitions')
      .select('id, status, roster_confirmed_at')
      .in('id', ids)

    if (error) {
      console.error('Poll failed:', error.message)
      return
    }

    if (!data) return

    const updates = new Map(
      (
        data as Array<{
          id: string
          status: CompetitionStatus
          roster_confirmed_at: string | null
        }>
      ).map((d) => [d.id, { status: d.status, roster_confirmed_at: d.roster_confirmed_at }])
    )

    setCompetitions((prev) =>
      prev.map((c) => {
        const update = updates.get(c.id)
        if (update) {
          return { ...c, status: update.status, roster_confirmed_at: update.roster_confirmed_at }
        }
        return c
      })
    )
  }, [supabase])

  // Initial load
  useEffect(() => {
    void loadInitialData()
    void loadCheckIns()
  }, [loadInitialData, loadCheckIns])

  // Judge filter effect
  useEffect(() => {
    void loadJudgeAssignments(selectedJudgeId)
  }, [selectedJudgeId, loadJudgeAssignments])

  // Polling with visibility-aware interval (fallback if Realtime drops)
  useEffect(() => {
    if (loading || competitions.length === 0) return

    function startPolling() {
      if (pollTimerRef.current) return
      pollTimerRef.current = setInterval(() => {
        void pollStatuses()
        void loadCheckIns()
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
        void pollStatuses()
        void loadCheckIns()
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loading, competitions.length, pollStatuses, loadCheckIns])

  // Supabase Realtime for instant updates: competition statuses + check-ins
  useEffect(() => {
    if (loading || competitions.length === 0) return

    const compIds = competitions.map((c) => c.id)

    const channel = supabase
      .channel('side-stage-all')
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_check_ins',
        },
        () => {
          // Dancer checked in at registration desk — refresh check-in data + expanded roster
          void loadCheckIns()
          if (expandedCompId) {
            void loadRegistrations(expandedCompId)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loading, competitions.length, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Actions ---

  async function loadHeatData(competitionId: string) {
    setLoadingHeatData(true)
    setHeatSnapshot(null)
    setHeatScoredDancerIds(new Set())

    // Fetch active round with heat snapshot
    const { data: roundData, error: roundErr } = await supabase
      .from('rounds')
      .select('id, heat_snapshot')
      .eq('competition_id', competitionId)
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (roundErr) {
      console.error('Failed to load round for heat data:', roundErr.message)
      setLoadingHeatData(false)
      return
    }

    if (!roundData?.heat_snapshot) {
      setLoadingHeatData(false)
      return
    }

    const snapshot = roundData.heat_snapshot as HeatSnapshot
    setHeatSnapshot(snapshot)

    // Fetch scored dancer IDs for this round
    const { data: scoreData, error: scoreErr } = await supabase
      .from('score_entries')
      .select('dancer_id')
      .eq('round_id', roundData.id)

    if (scoreErr) {
      console.error('Failed to load score entries for heat data:', scoreErr.message)
    } else {
      const scoredIds = new Set(
        (scoreData ?? []).map((s: { dancer_id: string }) => s.dancer_id)
      )
      setHeatScoredDancerIds(scoredIds)
    }

    setLoadingHeatData(false)
  }

  function toggleCompetition(compId: string) {
    if (expandedCompId === compId) {
      setExpandedCompId(null)
      setRegistrations([])
      setHeatSnapshot(null)
      setHeatScoredDancerIds(new Set())
      return
    }
    setExpandedCompId(compId)
    void loadRegistrations(compId)

    // If competition is scoring, also load heat data
    const comp = competitions.find((c) => c.id === compId)
    if (comp && SCORING_STATUSES.includes(comp.status)) {
      void loadHeatData(compId)
    } else {
      setHeatSnapshot(null)
      setHeatScoredDancerIds(new Set())
    }
  }

  async function handleDancerStatusChange(registrationId: string, newStatus: string) {
    setUpdatingStatus(registrationId)

    const { error } = await supabase
      .from('registrations')
      .update({ status: newStatus })
      .eq('id', registrationId)

    if (error) {
      showError('Failed to update status', { description: error.message })
      setUpdatingStatus(null)
      return
    }

    // If competition is in_progress/awaiting_scores, update heat_snapshot slot status
    const expandedComp = expandedCompId
      ? competitions.find((c) => c.id === expandedCompId)
      : null
    const reg = registrations.find((r) => r.id === registrationId)
    if (
      expandedComp &&
      SCORING_STATUSES.includes(expandedComp.status) &&
      reg &&
      (newStatus === 'scratched' || newStatus === 'no_show') &&
      heatSnapshot
    ) {
      // Read snapshot, find slot by dancer_id, update status, write back
      const updatedHeats = heatSnapshot.heats.map((heat) => ({
        ...heat,
        slots: heat.slots.map((slot) =>
          slot.dancer_id === reg.dancer_id
            ? { ...slot, status: newStatus as 'scratched' | 'no_show' }
            : slot
        ),
      }))
      const updatedSnapshot: HeatSnapshot = { ...heatSnapshot, heats: updatedHeats }

      // Persist to database
      const { data: roundData } = await supabase
        .from('rounds')
        .select('id')
        .eq('competition_id', expandedCompId)
        .order('round_number', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (roundData) {
        const { error: snapErr } = await supabase
          .from('rounds')
          .update({ heat_snapshot: updatedSnapshot })
          .eq('id', roundData.id)

        if (snapErr) {
          console.error('Failed to update heat snapshot slot:', snapErr.message)
        } else {
          setHeatSnapshot(updatedSnapshot)
        }
      }
    }

    setRegistrations((prev) =>
      prev.map((r) => (r.id === registrationId ? { ...r, status: newStatus } : r))
    )
    setUpdatingStatus(null)
  }

  async function handleConfirmRoster(compId: string) {
    // Block if any dancer is still unaccounted for (status = 'registered')
    if (expandedCompId === compId && registrations.length > 0) {
      const unaccounted = registrations.filter((r) => r.status === 'registered')
      if (unaccounted.length > 0) {
        showError(
          `${unaccounted.length} dancer${unaccounted.length !== 1 ? 's' : ''} not accounted for — mark each as Present, No Show, or Scratched before confirming`
        )
        return
      }
    }

    setConfirmingRoster(compId)

    const comp = competitions.find((c) => c.id === compId)
    if (!comp) { setConfirmingRoster(null); return }

    const now = new Date().toISOString()

    // Auto-advance to ready_for_day_of if still in an earlier status
    const needsAdvance = comp.status === 'draft' || comp.status === 'imported'
    const updateFields: Record<string, unknown> = {
      roster_confirmed_at: now,
      roster_confirmed_by: 'Side-Stage',
    }
    if (needsAdvance) {
      updateFields.status = 'ready_for_day_of'
    }

    const { error } = await supabase
      .from('competitions')
      .update(updateFields)
      .eq('id', compId)

    if (error) {
      showError('Failed to confirm roster', { description: error.message })
      setConfirmingRoster(null)
      return
    }

    setCompetitions((prev) =>
      prev.map((c) =>
        c.id === compId
          ? {
              ...c,
              roster_confirmed_at: now,
              roster_confirmed_by: 'Side-Stage',
              status: needsAdvance ? ('ready_for_day_of' as CompetitionStatus) : c.status,
            }
          : c
      )
    )
    showSuccess(needsAdvance ? 'Roster confirmed — ready to send to judge' : 'Roster confirmed')
    setConfirmingRoster(null)
  }

  async function handleUnconfirmRoster(compId: string) {
    setConfirmingRoster(compId)

    const { error } = await supabase
      .from('competitions')
      .update({ roster_confirmed_at: null, roster_confirmed_by: null })
      .eq('id', compId)

    if (error) {
      showError('Failed to un-confirm roster', { description: error.message })
      setConfirmingRoster(null)
      return
    }

    setCompetitions((prev) =>
      prev.map((c) =>
        c.id === compId ? { ...c, roster_confirmed_at: null, roster_confirmed_by: null } : c
      )
    )
    showSuccess('Roster un-confirmed')
    setConfirmingRoster(null)
  }

  async function handleSendToJudge(compId: string) {
    const comp = competitions.find((c) => c.id === compId)
    if (!comp) return

    if (!canTransition(comp.status, 'released_to_judge')) {
      showError('Cannot send to judge from current status')
      return
    }

    // Atomic conditional update: only transitions if still in expected state
    const { error } = await supabase
      .from('competitions')
      .update({ status: 'released_to_judge' })
      .eq('id', compId)
      .eq('status', 'ready_for_day_of')

    if (error) {
      showError('Failed to send to judge', { description: error.message })
      return
    }

    void logAudit(supabase, {
      userId: null,
      entityType: 'competition',
      entityId: compId,
      action: 'status_change',
      beforeData: { status: 'ready_for_day_of' },
      afterData: {
        status: 'released_to_judge',
        released_to_judge_at: new Date().toISOString(),
      },
    })

    setCompetitions((prev) =>
      prev.map((c) =>
        c.id === compId ? { ...c, status: 'released_to_judge' as CompetitionStatus } : c
      )
    )
    showSuccess('Sent to judge')
  }

  async function handleRecall(compId: string) {
    const comp = competitions.find((c) => c.id === compId)
    if (!comp) return

    if (!canTransition(comp.status, 'ready_for_day_of')) {
      showError('Cannot recall -- judge may have already started')
      return
    }

    const { error } = await supabase
      .from('competitions')
      .update({ status: 'ready_for_day_of' })
      .eq('id', compId)
      .eq('status', 'released_to_judge')

    if (error) {
      showError('Failed to recall', { description: error.message })
      return
    }

    void logAudit(supabase, {
      userId: null,
      entityType: 'competition',
      entityId: compId,
      action: 'status_change',
      beforeData: { status: 'released_to_judge' },
      afterData: { status: 'ready_for_day_of', trigger: 'side_stage_recall' },
    })

    setCompetitions((prev) =>
      prev.map((c) =>
        c.id === compId ? { ...c, status: 'ready_for_day_of' as CompetitionStatus } : c
      )
    )
    showSuccess('Recalled to side-stage')
  }

  // --- Filtering & Grouping ---

  const filteredCompetitions = competitions
    .filter((c) => assignedCompIds === null || assignedCompIds.has(c.id))
    .filter((c) => !selectedStageId || c.stage_id === selectedStageId)

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

  const scoringComps = sortBySchedule(
    filteredCompetitions.filter((c) => SCORING_STATUSES.includes(c.status))
  )
  const sentComps = sortBySchedule(
    filteredCompetitions.filter((c) => SENT_STATUSES.includes(c.status))
  )
  const readyComps = sortBySchedule(
    filteredCompetitions.filter(
      (c) => c.status === 'ready_for_day_of' && !!c.roster_confirmed_at
    )
  )
  const upcomingComps = sortBySchedule(
    filteredCompetitions.filter(
      (c) =>
        UPCOMING_STATUSES.includes(c.status) ||
        (c.status === 'ready_for_day_of' && !c.roster_confirmed_at)
    )
  )
  const completeComps = sortBySchedule(
    filteredCompetitions.filter((c) => COMPLETE_STATUSES.includes(c.status))
  )

  // Schedule grouping for NOW/NEXT indicator
  const hasSchedulePositions = competitions.some((c) => c.schedule_position !== null)

  const scheduleComps: ScheduleCompetition[] = competitions.map((c) => ({
    id: c.id,
    status: c.status,
    schedule_position: c.schedule_position,
    stage_id: c.stage_id,
    roster_confirmed_at: c.roster_confirmed_at,
    judge_count: judgeCounts.get(c.id) ?? 0,
  }))

  // Compute per-stage groupings
  const stageGroupings = stages.map((stage) => ({
    stage,
    grouping: groupBySchedule(scheduleComps, stage.id),
  }))

  // --- Render helpers ---

  function getStatusColor(status: CompetitionStatus): string {
    if (SCORING_STATUSES.includes(status)) return 'border-feis-green/40 bg-feis-green-light/40'
    if (status === 'ready_for_day_of') return 'border-feis-orange/30 bg-feis-orange/5'
    return 'border-border'
  }

  function getDancerStatusColor(status: string): string {
    switch (status) {
      case 'present':
      case 'checked_in':
      case 'danced':
      case 'recalled':
      case 'finalized':
        return 'bg-feis-green-light text-feis-green'
      case 'no_show':
        return 'bg-destructive/10 text-destructive'
      case 'scratched':
      case 'disqualified':
        return 'bg-feis-orange-light text-feis-orange'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  function renderCompetitionRow(comp: Competition) {
    const isExpanded = expandedCompId === comp.id
    const presentCount = isExpanded
      ? registrations.filter(
          (r) =>
            r.status === 'present' ||
            r.status === 'checked_in' ||
            r.status === 'danced' ||
            r.status === 'recalled' ||
            r.status === 'finalized'
        ).length
      : 0
    const totalCount = isExpanded ? registrations.length : 0

    const canConfirm = CONFIRMABLE_STATUSES.includes(comp.status) && !comp.roster_confirmed_at
    const canUnconfirm =
      UNCONFIRMABLE_STATUSES.includes(comp.status) && !!comp.roster_confirmed_at
    const isConfirmed = !!comp.roster_confirmed_at
    const isRosterLocked = isConfirmed || !CONFIRMABLE_STATUSES.includes(comp.status)

    return (
      <div key={comp.id} className={`rounded-lg border ${getStatusColor(comp.status)}`}>
        <button
          type="button"
          className="flex w-full items-center justify-between p-4 text-left min-h-[56px]"
          onClick={() => toggleCompetition(comp.id)}
        >
          <div className="flex items-center gap-3">
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            )}
            {hasSchedulePositions && comp.schedule_position !== null && (
              <span className="font-mono text-sm text-muted-foreground w-6 text-right tabular-nums shrink-0">
                {comp.schedule_position}
              </span>
            )}
            <div>
              <span className="text-lg font-medium">
                {comp.code && <span className="font-mono mr-1.5">{comp.code}</span>}
                {comp.name}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isConfirmed && <CheckCircle2 className="h-5 w-5 text-feis-green" />}
          </div>
        </button>

        {isExpanded && (
          <div className="border-t px-4 pb-4 pt-3 space-y-3">
            {/* Heat display for scoring competitions */}
            {SCORING_STATUSES.includes(comp.status) && !loadingHeatData && heatSnapshot && (() => {
              const currentHt = getCurrentHeat(heatSnapshot, heatScoredDancerIds)
              const totalHeatsCount = heatSnapshot.heats.length
              const currentHtNumber = currentHt?.heat_number ?? totalHeatsCount
              const nextHt = currentHt && currentHtNumber < totalHeatsCount
                ? heatSnapshot.heats[currentHtNumber]
                : null
              const totalActiveSlots = heatSnapshot.heats.flatMap(h => h.slots).filter(s => s.status === 'active').length
              const scoredActiveCount = heatSnapshot.heats
                .flatMap(h => h.slots)
                .filter(s => s.status === 'active' && heatScoredDancerIds.has(s.dancer_id)).length

              return (
                <div className="space-y-3">
                  {/* On Stage Now */}
                  {currentHt && (
                    <div className="rounded-lg border-2 border-feis-green bg-feis-green-light/30 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-feis-green animate-pulse" />
                          <span className="text-sm font-semibold text-feis-green uppercase tracking-wider">
                            On Stage Now
                          </span>
                        </div>
                        <Badge variant="default">
                          Heat {currentHtNumber} of {totalHeatsCount}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {currentHt.slots
                          .filter(s => s.status === 'active')
                          .map((slot) => {
                            const reg = registrations.find(r => r.dancer_id === slot.dancer_id)
                            return (
                              <div key={slot.dancer_id} className="flex items-center gap-3 min-h-[44px]">
                                <span className="font-mono text-2xl font-bold text-feis-green w-16 text-right shrink-0">
                                  #{slot.competitor_number}
                                </span>
                                <span className="text-lg font-medium">
                                  {reg ? `${reg.first_name} ${reg.last_name}` : slot.dancer_id}
                                </span>
                                {heatScoredDancerIds.has(slot.dancer_id) && (
                                  <CheckCircle2 className="h-5 w-5 text-feis-green shrink-0" />
                                )}
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  )}

                  {/* Line Up Next */}
                  {nextHt && (
                    <div className="rounded-lg border border-feis-orange/30 bg-feis-orange/5 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold text-feis-orange uppercase tracking-wider">
                          Line Up Next
                        </span>
                        <Badge variant="outline">
                          Heat {nextHt.heat_number} of {totalHeatsCount}
                        </Badge>
                      </div>
                      <div className="space-y-1.5">
                        {nextHt.slots
                          .filter(s => s.status === 'active')
                          .map((slot) => {
                            const reg = registrations.find(r => r.dancer_id === slot.dancer_id)
                            return (
                              <div key={slot.dancer_id} className="flex items-center gap-3 min-h-[40px]">
                                <span className="font-mono text-xl font-bold w-16 text-right shrink-0">
                                  #{slot.competitor_number}
                                </span>
                                <span className="text-base">
                                  {reg ? `${reg.first_name} ${reg.last_name}` : slot.dancer_id}
                                </span>
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  )}

                  {/* All heats complete */}
                  {!currentHt && totalHeatsCount > 0 && (
                    <div className="rounded-lg border border-feis-green/30 bg-feis-green-light/30 p-4 text-center">
                      <p className="text-base font-medium text-feis-green">All heats scored</p>
                    </div>
                  )}

                  {/* Progress */}
                  <div className="text-sm text-muted-foreground font-medium">
                    {scoredActiveCount} of {totalActiveSlots} scored
                  </div>
                </div>
              )
            })()}

            {SCORING_STATUSES.includes(comp.status) && loadingHeatData && (
              <p className="text-muted-foreground text-sm py-2">Loading heat data...</p>
            )}

            {loadingRegistrations ? (
              <p className="text-muted-foreground text-sm py-2">Loading roster...</p>
            ) : registrations.length === 0 ? (
              <p className="text-muted-foreground text-sm py-2">No dancers registered.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {registrations.map((reg) => {
                    const checkIn = checkInMap.get(reg.dancer_id)
                    const displayNumber = checkIn?.competitor_number ?? reg.competitor_number
                    const isPresent =
                      reg.status === 'present' ||
                      reg.status === 'checked_in' ||
                      reg.status === 'danced' ||
                      reg.status === 'recalled' ||
                      reg.status === 'finalized'
                    const hasArrived = checkIn?.checked_in_at != null
                    const hasNumber = checkIn != null
                    const showCallToStage =
                      hasArrived &&
                      !isPresent &&
                      CALL_TO_STAGE_STATUSES.includes(comp.status)

                    return (
                    <div
                      key={reg.id}
                      className="flex items-center justify-between min-h-[48px] py-1"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`font-mono text-lg font-medium w-14 text-right shrink-0${!hasArrived && hasNumber && !isPresent ? ' opacity-40' : ''}`}
                        >
                          #{displayNumber ?? '\u2014'}
                        </span>
                        <div>
                          <span className="text-lg">
                            {reg.first_name} {reg.last_name}
                          </span>
                          {!hasArrived && (
                            <span className="text-xs text-destructive/70 mt-0.5 block">
                              Not checked in at registration
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {isRosterLocked ? (
                          <span
                            className={`inline-block min-h-[44px] min-w-[120px] rounded-md border px-3 py-2 text-base font-medium leading-7 text-center ${getDancerStatusColor(reg.status)}`}
                          >
                            {DANCER_STATUS_LABELS[reg.status as DancerStatus] ?? reg.status}
                          </span>
                        ) : (
                          <select
                            value={
                              reg.status === 'present' ||
                              reg.status === 'no_show' ||
                              reg.status === 'scratched'
                                ? reg.status
                                : 'registered'
                            }
                            onChange={(e) =>
                              void handleDancerStatusChange(reg.id, e.target.value)
                            }
                            disabled={updatingStatus === reg.id}
                            className={`min-h-[44px] min-w-[120px] rounded-md border px-3 py-2 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${getDancerStatusColor(reg.status)}`}
                          >
                            <option value="registered">Registered</option>
                            {DANCER_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {DANCER_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>

                <div className="text-base text-muted-foreground font-medium pt-1">
                  {presentCount}/{totalCount} present
                </div>
              </>
            )}

            <div className="pt-2 flex gap-3">
              {canConfirm && (
                <Button
                  size="lg"
                  className="min-h-[48px] text-lg"
                  onClick={() => void handleConfirmRoster(comp.id)}
                  disabled={confirmingRoster === comp.id}
                >
                  {confirmingRoster === comp.id ? 'Confirming...' : 'Confirm Roster'}
                </Button>
              )}
              {isConfirmed && !canUnconfirm && (
                <Badge variant="secondary" className="text-base px-4 py-2 h-auto">
                  Roster Confirmed
                </Badge>
              )}
              {canUnconfirm && (
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="text-base px-4 py-2 h-auto">
                    Roster Confirmed
                  </Badge>
                  <Button
                    variant="outline"
                    size="lg"
                    className="min-h-[48px] text-base"
                    onClick={() => void handleUnconfirmRoster(comp.id)}
                    disabled={confirmingRoster === comp.id}
                  >
                    {confirmingRoster === comp.id ? 'Un-confirming...' : 'Un-confirm'}
                  </Button>
                </div>
              )}
            </div>

            {isConfirmed && comp.status === 'ready_for_day_of' && (
              <Button
                className="w-full bg-feis-green hover:bg-feis-green/90 text-white min-h-[48px] text-lg mt-3"
                onClick={() => void handleSendToJudge(comp.id)}
              >
                {'Send to Judge \u2192'}
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  // --- Loading state ---

  if (loading) return <p className="text-muted-foreground p-6 text-lg">Loading...</p>

  const hasNoComps =
    scoringComps.length === 0 &&
    sentComps.length === 0 &&
    readyComps.length === 0 &&
    upcomingComps.length === 0 &&
    completeComps.length === 0

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <Link
          href={`/dashboard/events/${eventId}`}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="h-3 w-3" /> Dashboard
        </Link>
        <h1 className="text-2xl font-bold">Side-Stage</h1>
        {event && <p className="text-lg text-muted-foreground">{event.name}</p>}
      </div>

      {/* Stage selector */}
      {stages.length > 1 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSelectedStageId('')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !selectedStageId ? 'bg-feis-green text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            All Stages
          </button>
          {stages.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedStageId(s.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedStageId === s.id ? 'bg-feis-green text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {judges.length > 0 && (
        <div>
          <label htmlFor="judge-filter" className="text-sm font-medium block mb-1">
            Filter by judge
          </label>
          <select
            id="judge-filter"
            value={selectedJudgeId}
            onChange={(e) => setSelectedJudgeId(e.target.value)}
            className="min-h-[44px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All judges</option>
            {judges.map((j) => (
              <option key={j.id} value={j.id}>
                {j.first_name} {j.last_name}
              </option>
            ))}
          </select>
        </div>
      )}

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
                      <span className="text-base font-medium">
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
                      <span className="text-base font-medium">
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

      {scoringComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-feis-green flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-feis-green" />
              Scoring ({scoringComps.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {scoringComps.map(renderCompetitionRow)}
          </CardContent>
        </Card>
      )}

      {sentComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-feis-green flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-feis-green animate-pulse" />
              Sent ({sentComps.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sentComps.map((comp) => (
              <div
                key={comp.id}
                className="rounded-lg border border-feis-green/30 bg-feis-green-light/30 p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-lg font-medium">
                      {hasSchedulePositions && comp.schedule_position !== null && (
                        <span className="font-mono text-sm text-muted-foreground mr-2">
                          {comp.schedule_position}
                        </span>
                      )}
                      {comp.code && <span className="font-mono mr-1.5">{comp.code}</span>}
                      {comp.name}
                    </span>
                    <p className="text-sm text-feis-green mt-1">
                      Waiting for judge to start scoring...
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRecall(comp.id)}
                  >
                    Recall
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {readyComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-feis-orange flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-feis-orange" />
              Ready ({readyComps.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {readyComps.map(renderCompetitionRow)}
          </CardContent>
        </Card>
      )}

      {upcomingComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-muted-foreground">
              Upcoming ({upcomingComps.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingComps.map(renderCompetitionRow)}
          </CardContent>
        </Card>
      )}

      {completeComps.length > 0 && (
        <Card className="feis-card opacity-70">
          <CardHeader className="pb-2">
            <button
              type="button"
              className="flex items-center gap-2 w-full text-left min-h-[44px]"
              onClick={() => setDoneExpanded(!doneExpanded)}
            >
              {doneExpanded ? (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              )}
              <CardTitle className="text-lg text-muted-foreground">
                Complete ({completeComps.length})
              </CardTitle>
            </button>
          </CardHeader>
          {doneExpanded && (
            <CardContent className="space-y-3">
              {completeComps.map(renderCompetitionRow)}
            </CardContent>
          )}
        </Card>
      )}

      {hasNoComps && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-lg">No competitions found.</p>
            {selectedJudgeId && (
              <p className="text-sm text-muted-foreground mt-1">
                This judge may not have any competitions assigned.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
