'use client'

import { useEffect, useState, useCallback, useRef, use } from 'react'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { logAudit } from '@/lib/audit'
import { showSuccess, showError } from '@/lib/feedback'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'

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
const UPCOMING_STATUSES: CompetitionStatus[] = ['imported', 'draft']
const COMPLETE_STATUSES: CompetitionStatus[] = [
  'ready_to_tabulate',
  'complete_unpublished',
  'published',
  'locked',
  'recalled_round_pending',
]

// Statuses where roster can be confirmed
const CONFIRMABLE_STATUSES: CompetitionStatus[] = [
  'draft',
  'imported',
  'ready_for_day_of',
]

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

  // Done section collapsed state
  const [doneExpanded, setDoneExpanded] = useState(false)

  // Polling
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const competitionsRef = useRef<Competition[]>([])

  // Keep ref in sync
  useEffect(() => {
    competitionsRef.current = competitions
  }, [competitions])

  // --- Data Loading ---

  const loadInitialData = useCallback(async () => {
    const [eventRes, judgesRes, compsRes] = await Promise.all([
      supabase.from('events').select('id, name').eq('id', eventId).single(),
      supabase
        .from('judges')
        .select('id, first_name, last_name')
        .eq('event_id', eventId)
        .order('last_name'),
      supabase
        .from('competitions')
        .select('id, code, name, age_group, level, status, roster_confirmed_at, roster_confirmed_by')
        .eq('event_id', eventId)
        .order('code'),
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

    setEvent(eventRes.data as EventInfo | null)
    setJudges((judgesRes.data as Judge[] | null) ?? [])
    setCompetitions((compsRes.data as Competition[] | null) ?? [])
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
        data as Array<{ id: string; status: CompetitionStatus; roster_confirmed_at: string | null }>
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
  }, [loadInitialData])

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
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loading, competitions.length, pollStatuses])

  // Supabase Realtime subscription for near-instant competition status updates.
  // NOTE: Requires Realtime to be enabled on the `competitions` table in the
  // Supabase dashboard (Database → Replication → enable `competitions`).
  useEffect(() => {
    if (loading || competitions.length === 0) return

    const compIds = competitions.map((c) => c.id)

    const channel = supabase
      .channel('side-stage-competitions')
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

  // --- Actions ---

  function toggleCompetition(compId: string) {
    if (expandedCompId === compId) {
      setExpandedCompId(null)
      setRegistrations([])
      return
    }
    setExpandedCompId(compId)
    void loadRegistrations(compId)
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

    setRegistrations((prev) =>
      prev.map((r) => (r.id === registrationId ? { ...r, status: newStatus } : r))
    )
    setUpdatingStatus(null)
  }

  async function handleConfirmRoster(compId: string) {
    setConfirmingRoster(compId)

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('competitions')
      .update({ roster_confirmed_at: now, roster_confirmed_by: 'Side-Stage' })
      .eq('id', compId)

    if (error) {
      showError('Failed to confirm roster', { description: error.message })
      setConfirmingRoster(null)
      return
    }

    setCompetitions((prev) =>
      prev.map((c) =>
        c.id === compId ? { ...c, roster_confirmed_at: now, roster_confirmed_by: 'Side-Stage' } : c
      )
    )
    showSuccess('Roster confirmed')
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
      afterData: { status: 'released_to_judge', released_to_judge_at: new Date().toISOString() },
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
      showError('Cannot recall — judge may have already started')
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

  const filteredCompetitions =
    assignedCompIds !== null
      ? competitions.filter((c) => assignedCompIds.has(c.id))
      : competitions

  const scoringComps = filteredCompetitions.filter((c) => SCORING_STATUSES.includes(c.status))
  const sentComps = filteredCompetitions.filter((c) => SENT_STATUSES.includes(c.status))
  const readyComps = filteredCompetitions.filter(
    (c) => c.status === 'ready_for_day_of' && !!c.roster_confirmed_at
  )
  const upcomingComps = filteredCompetitions.filter(
    (c) =>
      UPCOMING_STATUSES.includes(c.status) ||
      (c.status === 'ready_for_day_of' && !c.roster_confirmed_at)
  )
  const completeComps = filteredCompetitions.filter((c) => COMPLETE_STATUSES.includes(c.status))

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
        return 'bg-red-50 text-red-700'
      case 'scratched':
      case 'disqualified':
        return 'bg-orange-50 text-orange-700'
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
    const canUnconfirm = UNCONFIRMABLE_STATUSES.includes(comp.status) && !!comp.roster_confirmed_at
    const isConfirmed = !!comp.roster_confirmed_at

    return (
      <div key={comp.id} className={`rounded-lg border ${getStatusColor(comp.status)}`}>
        {/* Competition header — tap to expand */}
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
            <div>
              <span className="text-lg font-medium">
                {comp.code && <span className="font-mono">{comp.code}</span>}
                {comp.code && ' — '}
                {comp.name}
              </span>
              {(comp.age_group || comp.level) && (
                <span className="ml-2 text-sm text-muted-foreground">
                  {[comp.age_group, comp.level].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isConfirmed && <CheckCircle2 className="h-5 w-5 text-feis-green" />}
          </div>
        </button>

        {/* Expanded roster */}
        {isExpanded && (
          <div className="border-t px-4 pb-4 pt-3 space-y-3">
            {loadingRegistrations ? (
              <p className="text-muted-foreground text-sm py-2">Loading roster...</p>
            ) : registrations.length === 0 ? (
              <p className="text-muted-foreground text-sm py-2">No dancers registered.</p>
            ) : (
              <>
                {/* Dancer list */}
                <div className="space-y-2">
                  {registrations.map((reg) => (
                    <div
                      key={reg.id}
                      className="flex items-center justify-between min-h-[48px] py-1"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-lg font-medium w-14 text-right shrink-0">
                          #{reg.competitor_number ?? '—'}
                        </span>
                        <span className="text-lg">
                          {reg.first_name} {reg.last_name}
                        </span>
                      </div>
                      <div className="shrink-0">
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
                          <option value="registered">—</option>
                          {DANCER_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {DANCER_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Present count */}
                <div className="text-base text-muted-foreground font-medium pt-1">
                  {presentCount}/{totalCount} present
                </div>
              </>
            )}

            {/* Confirm / Un-confirm buttons */}
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

            {/* Send to Judge button — only for confirmed ready_for_day_of */}
            {isConfirmed && comp.status === 'ready_for_day_of' && (
              <Button
                className="w-full bg-feis-green hover:bg-feis-green/90 text-white min-h-[48px] text-lg mt-3"
                onClick={() => void handleSendToJudge(comp.id)}
              >
                Send to Judge →
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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Roster Confirmation</h1>
        {event && <p className="text-lg text-muted-foreground">{event.name}</p>}
      </div>

      {/* Judge filter */}
      {judges.length > 0 && (
        <div>
          <label htmlFor="judge-filter" className="text-sm font-medium block mb-1">
            Filter by judge
          </label>
          <select
            id="judge-filter"
            value={selectedJudgeId}
            onChange={(e) => setSelectedJudgeId(e.target.value)}
            className="min-h-[44px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-lg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

      {/* Scoring section */}
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

      {/* Sent section */}
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
                      {comp.code && <span className="font-mono">{comp.code}</span>}
                      {comp.code && ' — '}
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

      {/* Ready section */}
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

      {/* Upcoming section */}
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

      {/* Complete section — collapsed by default */}
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

      {/* Empty state */}
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
