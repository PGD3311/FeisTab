'use client'

import { useEffect, useState, useCallback, useRef, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
import { useEvent } from '@/contexts/event-context'
import { tabulate, type ScoreInput, type TabulationResult } from '@/lib/engine/tabulate'
import { generateRecalls } from '@/lib/engine/recalls'
import { type RuleSetConfig } from '@/lib/engine/rules'
import { detectAnomalies, type Anomaly, type AnomalyInput } from '@/lib/engine/anomalies'
import { DEFAULT_RULES } from '@/lib/engine/rules'
import {
  canTransition,
  getNextStates,
  getTransitionLabel,
  getTransitionBlockReason,
  type CompetitionStatus,
  type TransitionContext,
} from '@/lib/competition-states'
import {
  signOffJudge,
  guardedStatusUpdate,
  publishResults,
  unpublishResults,
  generateRecall,
  approveTabulation,
  createRound,
  transitionCompetitionStatus,
  confirmRoster,
  updateHeatSnapshot,
} from '@/lib/supabase/rpc'
import { showSuccess, showError, showCritical } from '@/lib/feedback'
import { formatAuditEntry, type AuditEntry, type NameMaps } from '@/lib/audit-format'
import { buildCalculatedPayload } from '@/lib/result-payload'
import { generateHeats, type HeatDancer } from '@/lib/engine/heats'
import { NON_ACTIVE_STATUSES } from '@/lib/engine/anomalies/types'
import { type JudgeInfo } from '@/types/shared'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
import { ResultsTable } from '@/components/results-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ApprovalDialog, type ApprovalChecks } from '@/components/approval-dialog'
import { UnpublishDialog } from '@/components/unpublish-dialog'

export default function CompetitionDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; compId: string }>
}) {
  const { eventId, compId } = use(params)
  const supabase = useSupabase()
  const { reload } = useEvent()
  const [comp, setComp] = useState<any>(null) // TODO: type when Supabase types generated
  const [registrations, setRegistrations] = useState<any[]>([]) // TODO: type when Supabase types generated
  const [rounds, setRounds] = useState<any[]>([]) // TODO: type when Supabase types generated
  const [scores, setScores] = useState<any[]>([]) // TODO: type when Supabase types generated
  const [results, setResults] = useState<any[]>([]) // TODO: type when Supabase types generated
  const [ruleset, setRuleset] = useState<RuleSetConfig | null>(null)
  const [judges, setJudges] = useState<JudgeInfo[]>([])
  const [assignedJudgeIds, setAssignedJudgeIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [advancing, setAdvancing] = useState(false)
  const [previewResults, setPreviewResults] = useState<TabulationResult[] | null>(null)
  const [unlockJudgeId, setUnlockJudgeId] = useState<string | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockNote, setUnlockNote] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [loadWarning, setLoadWarning] = useState(false)
  const [, setStages] = useState<{ id: string; name: string; display_order: number }[]>([])
  const [showApprovalDialog, setShowApprovalDialog] = useState(false)
  const [showUnpublishDialog, setShowUnpublishDialog] = useState(false)

  // Polling
  const POLL_INTERVAL_MS = 5000
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Lightweight poll: only fetch frequently-changing fields
  const pollData = useCallback(async () => {
    const [compRes, scoreRes, roundRes, regRes] = await Promise.all([
      supabase.from('competitions').select('status').eq('id', compId).single(),
      supabase
        .from('score_entries')
        .select('id, dancer_id, judge_id, round_id')
        .eq('competition_id', compId),
      supabase
        .from('rounds')
        .select('id, judge_sign_offs, status')
        .eq('competition_id', compId)
        .order('round_number'),
      supabase
        .from('registrations')
        .select('id, status')
        .eq('competition_id', compId),
    ])

    if (compRes.error || scoreRes.error || roundRes.error || regRes.error) {
      // Silently skip this poll cycle on error
      return
    }

    // Update competition status if changed
    const newStatus = compRes.data?.status as CompetitionStatus | undefined
    if (newStatus) {
      setComp((prev: Record<string, unknown> | null) =>
        prev && prev.status !== newStatus ? { ...prev, status: newStatus } : prev
      )
    }

    // Update scores if count changed (triggers re-render for score progress)
    const newScores = scoreRes.data ?? []
    setScores((prev: Array<{ id: string }>) => {
      if (prev.length !== newScores.length) return newScores
      // Check if any IDs differ (new scores arrived)
      const prevIds = new Set(prev.map((s) => s.id))
      const changed = newScores.some((s: { id: string }) => !prevIds.has(s.id))
      return changed ? newScores : prev
    })

    // Update rounds (sign-offs change)
    const newRounds = roundRes.data ?? []
    setRounds((prev: Array<{ id: string; judge_sign_offs: Record<string, string> | null }>) => {
      if (prev.length !== newRounds.length) return newRounds
      // Check if sign-offs changed on any round
      const changed = newRounds.some(
        (nr: { id: string; judge_sign_offs: Record<string, string> | null }) => {
          const pr = prev.find((p) => p.id === nr.id)
          if (!pr) return true
          return JSON.stringify(pr.judge_sign_offs) !== JSON.stringify(nr.judge_sign_offs)
        }
      )
      return changed ? newRounds : prev
    })

    // Update registration statuses (scratches, no-shows)
    const newRegs = regRes.data ?? []
    setRegistrations((prev: Array<{ id: string; status: string }>) => {
      const changed = newRegs.some((nr: { id: string; status: string }) => {
        const pr = prev.find((p) => p.id === nr.id)
        return !pr || pr.status !== nr.status
      })
      return changed
        ? prev.map((p) => {
            const nr = newRegs.find((n: { id: string }) => n.id === p.id)
            return nr ? { ...p, status: nr.status } : p
          })
        : prev
    })
  }, [supabase, compId])

  // Realtime subscriptions for instant updates (debounced to avoid request storms)
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (loading) return

    function debouncedPoll() {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = setTimeout(() => { void pollData() }, 300)
    }

    const channel = supabase
      .channel(`comp-detail-${compId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competitions', filter: `id=eq.${compId}` }, debouncedPoll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'score_entries', filter: `competition_id=eq.${compId}` }, debouncedPoll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `competition_id=eq.${compId}` }, debouncedPoll)
      .subscribe()

    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [loading, supabase, compId, pollData])

  // Visibility-aware polling (fallback if Realtime drops)
  useEffect(() => {
    if (loading) return

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
  }, [loading, pollData])

  async function loadData() {
    const [compRes, regRes, roundRes, scoreRes, resultRes, judgesRes, assignRes, stagesRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number'),
      supabase.from('score_entries').select('*').eq('competition_id', compId),
      supabase.from('results').select('*, dancers(*)').eq('competition_id', compId).order('final_rank'),
      supabase.from('judges').select('id, first_name, last_name').eq('event_id', eventId),
      supabase.from('judge_assignments').select('judge_id').eq('competition_id', compId),
      supabase.from('stages').select('id, name, display_order').eq('event_id', eventId).order('display_order'),
    ])

    if (compRes.error) {
      console.error('Failed to load competition:', compRes.error.message)
      setLoading(false)
      return
    }
    if (regRes.error) console.error('Failed to load registrations:', regRes.error.message)
    if (roundRes.error) console.error('Failed to load rounds:', roundRes.error.message)
    if (scoreRes.error) console.error('Failed to load scores:', scoreRes.error.message)
    if (resultRes.error) console.error('Failed to load results:', resultRes.error.message)
    if (judgesRes.error) console.error('Failed to load judges:', judgesRes.error.message)
    if (assignRes.error) console.error('Failed to load judge assignments:', assignRes.error.message)
    if (stagesRes.error) console.error('Failed to load stages:', stagesRes.error.message)

    if (regRes.error || roundRes.error || scoreRes.error || resultRes.error || judgesRes.error) {
      setLoadWarning(true)
    } else {
      setLoadWarning(false)
    }

    setComp(compRes.data)
    setRegistrations(regRes.data ?? [])
    setRounds(roundRes.data ?? [])
    setScores(scoreRes.data ?? [])
    setResults(resultRes.data ?? [])
    setRuleset((compRes.data?.rule_sets?.config as RuleSetConfig | null) ?? DEFAULT_RULES)
    setJudges(judgesRes.data ?? [])
    setAssignedJudgeIds((assignRes.data ?? []).map((a: { judge_id: string }) => a.judge_id))
    setStages(stagesRes.data ?? [])

    const latestRound = roundRes.data?.[roundRes.data.length - 1]
    if (latestRound && judgesRes.data) {
      const anomalyInput: AnomalyInput = {
        competition_id: compId,
        scores: (scoreRes.data ?? []).map(s => ({
          id: s.id,
          round_id: s.round_id,
          competition_id: s.competition_id,
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          raw_score: Number(s.raw_score),
          flagged: s.flagged ?? false,
          flag_reason: s.flag_reason ?? null,
        })),
        registrations: (regRes.data ?? []).map(r => ({
          id: r.id,
          dancer_id: r.dancer_id,
          competition_id: r.competition_id,
          competitor_number: r.competitor_number,
          status: r.status,
          status_reason: r.status_reason ?? null,
        })),
        rounds: [{ id: latestRound.id, competition_id: compId, round_number: latestRound.round_number, round_type: latestRound.round_type, judge_sign_offs: latestRound.judge_sign_offs ?? {} }],
        judge_ids: assignRes.data && assignRes.data.length > 0
          ? assignRes.data.map((a: { judge_id: string }) => a.judge_id)
          : judgesRes.data.map((j: { id: string }) => j.id),
        results: (resultRes.data ?? []).map(r => ({
          dancer_id: r.dancer_id,
          final_rank: r.final_rank,
          calculated_payload: r.calculated_payload ?? { total_points: 0, individual_ranks: [] },
        })),
        rules: compRes.data?.rule_sets?.config as RuleSetConfig ?? DEFAULT_RULES,
        recalls: [],
      }
      const detected = detectAnomalies(anomalyInput)
      const status = compRes.data.status as string
      const postScoring = ['ready_to_tabulate', 'complete_unpublished', 'published', 'locked'].includes(status)
      // Only show "no scores" and "incomplete packet" warnings after scoring is done
      const filtered = postScoring
        ? detected
        : detected.filter(a => a.type !== 'unexplained_no_scores' && a.type !== 'incomplete_judge_packet')
      setAnomalies(filtered)
    } else {
      setAnomalies([])
    }

    // Fetch audit entries for this competition (parallel — independent queries)
    const [{ data: auditByEntity }, { data: auditByPayload }] = await Promise.all([
      supabase
        .from('audit_log')
        .select('*')
        .eq('entity_id', compId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('audit_log')
        .select('*')
        .contains('after_data', { competition_id: compId })
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    // Deduplicate by id
    const auditMap = new Map<string, AuditEntry>()
    for (const row of [...(auditByEntity ?? []), ...(auditByPayload ?? [])]) {
      if (!auditMap.has(row.id)) {
        auditMap.set(row.id, row as AuditEntry)
      }
    }
    const sorted = [...auditMap.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    setAuditEntries(sorted)

    setLoading(false)
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps -- loadData depends on supabase/params which are stable

  async function handlePreviewTabulation() {
    if (!ruleset || !comp) {
      showError('Competition data not loaded — try refreshing')
      return
    }

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'complete_unpublished')) {
      showError('Cannot tabulate from current status', { description: `Status is "${currentStatus}" — needs to be "ready_to_tabulate"` })
      return
    }

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) {
      showError('No round found — scores may not have been entered yet')
      return
    }

    try {
      const roundScores: ScoreInput[] = scores
        .filter(s => s.round_id === latestRound.id)
        .map(s => ({
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          raw_score: Number(s.raw_score),
          flagged: s.flagged ?? false,
        }))

      if (roundScores.length === 0) {
        showError('No scores found for this round')
        return
      }

      const tabulationResults = tabulate(roundScores, ruleset)
      setPreviewResults(tabulationResults)
    } catch (err) {
      showCritical('Tabulation failed', { description: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  async function handleApproveResults() {
    if (!previewResults || !ruleset || !comp) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    try {
      const mappedScores = scores.map(s => ({
        dancer_id: s.dancer_id,
        judge_id: s.judge_id,
        raw_score: Number(s.raw_score),
        flagged: s.flagged ?? false,
        flag_reason: s.flag_reason ?? null,
      }))

      // Batch upsert all results at once (avoids N sequential round trips)
      const resultRows = previewResults.map((r) => ({
        dancer_id: r.dancer_id,
        final_rank: r.final_rank,
        display_place: String(r.final_rank),
        calculated_payload: buildCalculatedPayload(
          r, judges, mappedScores, previewResults, ruleset
        ),
      }))

      await approveTabulation(supabase, compId, resultRows)

      setPreviewResults(null)
      await loadData()
      void reload()
      showSuccess('Results approved and saved')
    } catch (err) {
      showCritical('Failed to save results', { description: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  async function handlePublish(approvedBy: string, checks: ApprovalChecks) {
    if (!comp) return

    if (anomalies.some(a => a.blocking)) {
      showError('Cannot publish with unresolved anomaly blockers')
      return
    }

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'published')) return

    try {
      await publishResults(supabase, compId, approvedBy)

      showSuccess('Results published')
      void reload()
      loadData()
    } catch (err) {
      showCritical('Publish failed', { description: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  async function handleUnpublish(unpublishedBy: string, reason: string, note: string | null) {
    if (!comp) return
    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'complete_unpublished')) return
    try {
      await unpublishResults(supabase, compId, unpublishedBy)

      showSuccess('Results unpublished')
      void reload()
      loadData()
    } catch (err) {
      showCritical('Failed to unpublish results', { description: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  async function handleGenerateRecalls() {
    if (!ruleset || !comp) return
    if (!ruleset.recall_top_percent) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'recalled_round_pending')) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    try {
      const roundScores: ScoreInput[] = scores
        .filter(s => s.round_id === latestRound.id)
        .map(s => ({
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          raw_score: Number(s.raw_score),
          flagged: s.flagged ?? false,
        }))

      const tabulationResults = tabulate(roundScores, ruleset)
      const recalled = generateRecalls(tabulationResults, ruleset.recall_top_percent)

      // Atomic RPC: upsert recalls + create round + update status in one transaction
      const recallRows = recalled.map((r) => ({
        dancer_id: r.dancer_id,
        source_round_id: latestRound.id,
      }))

      const nextNum = (rounds[rounds.length - 1]?.round_number ?? 0) + 1
      await generateRecall(supabase, compId, recallRows, nextNum, currentStatus)

      await loadData()
      showSuccess('Recalls generated')
    } catch (err) {
      showCritical('Recall generation failed', { description: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  async function handleAdvance(targetStatus: CompetitionStatus) {
    if (!comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, targetStatus)) {
      showCritical('Cannot transition', { description: `Cannot transition from ${currentStatus} to ${targetStatus}` })
      return
    }

    setAdvancing(true)

    try {
      // Side effect: create Round 1 when opening for scoring
      if (currentStatus === 'in_progress' && targetStatus === 'awaiting_scores' && rounds.length === 0) {
        await createRound(supabase, {
          competition_id: compId,
          round_number: 1,
          round_type: 'standard',
        })
      }

      // Side effect: generate heat snapshot when entering in_progress
      if (targetStatus === 'in_progress') {
        try {
          // Ensure round exists
          const { data: existingRound } = await supabase
            .from('rounds')
            .select('id, heat_snapshot')
            .eq('competition_id', compId)
            .limit(1)
            .maybeSingle()

          let roundId = existingRound?.id ?? null
          if (!roundId) {
            try {
              roundId = await createRound(supabase, {
                competition_id: compId,
                round_number: 1,
                round_type: 'standard',
              })
            } catch {
              // Non-blocking — round creation may fail if already exists
            }
          }

          // Generate snapshot if round exists and doesn't already have one
          if (roundId && !existingRound?.heat_snapshot) {
            const { data: regs } = await supabase
              .from('registrations')
              .select('dancer_id, competitor_number, display_order')
              .eq('competition_id', compId)
              .not('status', 'in', `(${NON_ACTIVE_STATUSES.join(',')})`)

            if (regs && regs.length > 0) {
              const activeDancers: HeatDancer[] = regs.map(
                (r: { dancer_id: string; competitor_number: string | null; display_order: number | null }, idx: number) => ({
                  dancer_id: r.dancer_id,
                  competitor_number: r.competitor_number ?? String(idx + 1),
                  display_order: r.display_order ?? (parseInt(r.competitor_number ?? '0', 10) || idx),
                })
              )
              const groupSize = (comp as Record<string, unknown>).group_size as number ?? 2
              const snapshot = generateHeats(activeDancers, groupSize)
              await updateHeatSnapshot(supabase, roundId, snapshot as unknown as Record<string, unknown>)
            }
          }
        } catch (snapshotErr) {
          console.error('Heat snapshot generation failed (non-blocking):', snapshotErr)
        }
      }

      await transitionCompetitionStatus(supabase, compId, targetStatus)

      await loadData()
      void reload()
      showSuccess(`Status updated to ${getTransitionLabel(currentStatus, targetStatus)}`)
    } catch (err) {
      showCritical('Status update failed', { description: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setAdvancing(false)
    }
  }

  const UNLOCK_REASONS = [
    { value: 'wrong_score', label: 'Wrong score entered' },
    { value: 'wrong_dancer', label: 'Wrong dancer selected' },
    { value: 'judge_requested', label: 'Judge requested change' },
    { value: 'data_entry_error', label: 'Data entry error' },
    { value: 'other', label: 'Other' },
  ] as const

  async function handleUnlockForCorrection() {
    if (!unlockJudgeId || !unlockReason || !comp) return
    if (unlockReason === 'other' && !unlockNote.trim()) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'awaiting_scores')) return

    const latestRnd = rounds[rounds.length - 1]
    if (!latestRnd) return

    setUnlocking(true)

    try {
      // 1. Atomically remove judge's sign-off
      await signOffJudge(supabase, latestRnd.id, unlockJudgeId, compId, 'remove')

      // 2. Unlock judge's scores (clear locked_at)
      const { error: unlockErr } = await supabase
        .from('score_entries')
        .update({ locked_at: null })
        .eq('round_id', latestRnd.id)
        .eq('judge_id', unlockJudgeId)
      if (unlockErr) throw new Error(`Failed to unlock scores: ${unlockErr.message}`)

      // 3. If complete_unpublished, clear stale results
      if (currentStatus === 'complete_unpublished') {
        const { error: clearErr } = await supabase
          .from('results')
          .delete()
          .eq('competition_id', compId)
        if (clearErr) throw new Error(`Failed to clear stale results: ${clearErr.message}`)
      }

      // 4. Transition back to awaiting_scores
      await guardedStatusUpdate(supabase, compId, comp.status as CompetitionStatus, 'awaiting_scores')

      // Reset form
      setUnlockJudgeId(null)
      setUnlockReason('')
      setUnlockNote('')
      await loadData()
      void reload()
      showSuccess('Unlocked for correction')
    } catch (err) {
      showCritical('Unlock failed', { description: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setUnlocking(false)
    }
  }

  const latestRound = rounds[rounds.length - 1]
  // Use assigned judges (not all event judges) to determine sign-off completeness
  const signOffJudges = assignedJudgeIds.length > 0
    ? judges.filter(j => assignedJudgeIds.includes(j.id))
    : judges
  const allSignedOff = latestRound && signOffJudges.length > 0 &&
    signOffJudges.every(j => latestRound.judge_sign_offs?.[j.id])

  function getRelativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins} min ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  function resolveAnomalyMessage(anomaly: Anomaly): string {
    let msg = anomaly.message
    for (const j of judges) {
      if (msg.includes(j.id)) {
        msg = msg.replaceAll(j.id, `${j.first_name} ${j.last_name}`)
      }
    }
    for (const reg of registrations) {
      if (msg.includes(reg.dancer_id)) {
        const name = reg.dancers
          ? `${reg.dancers.first_name} ${reg.dancers.last_name} (#${reg.competitor_number})`
          : reg.dancer_id
        msg = msg.replaceAll(reg.dancer_id, name)
      }
    }
    return msg
  }

  const nameMaps: NameMaps = {
    judges: new Map(judges.map(j => [j.id, `${j.first_name} ${j.last_name}`])),
    dancers: new Map(registrations.map(r => [
      r.dancer_id,
      r.dancers ? `${r.dancers.first_name} ${r.dancers.last_name} (#${r.competitor_number})` : r.dancer_id,
    ])),
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>
  if (!comp) return <p>Competition not found.</p>

  return (
    <div className="space-y-6">
      <Link href={`/dashboard/events/${eventId}/competitions`} className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" /> Competitions
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{comp.code && `${comp.code} — `}{comp.name}</h1>
        <CompetitionStatusBadge status={comp.status} />
      </div>

      {loadWarning && (
        <div className="p-3 rounded-md bg-feis-orange-light border border-feis-orange/20 text-feis-orange text-sm">
          Some competition data could not be loaded. Roster, scores, or judge details may be incomplete. Refresh to try again.
        </div>
      )}

      {/* Next Step — single action card for the organizer */}
      {(() => {
        const currentStatus = comp.status as CompetitionStatus
        const nextStates = getNextStates(currentStatus)
        const operatorTransitions = nextStates.filter(s => {
          if (s === 'awaiting_scores' && currentStatus !== 'in_progress') return false
          return ['ready_for_day_of', 'in_progress', 'awaiting_scores', 'released_to_judge'].includes(s)
        })

        const context: TransitionContext = {
          registrationCount: registrations.length,
          judgeCount: judges.length,
          roundCount: rounds.length,
          rosterConfirmedAt: comp.roster_confirmed_at ?? null,
        }

        // Determine if tabulation/publish actions should show here
        const showTabulate = currentStatus === 'ready_to_tabulate' && !previewResults
        const showRecalls = currentStatus === 'ready_to_tabulate' && ruleset && ruleset.recall_top_percent > 0
        const showPublish = results.length > 0 && currentStatus === 'complete_unpublished'
        const hasActions = operatorTransitions.length > 0 || showTabulate || showPublish

        if (!hasActions && currentStatus !== 'published' && currentStatus !== 'locked') return null

        return (
          <Card className="feis-card border-feis-green/30 bg-feis-green-light/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">
                {currentStatus === 'published' || currentStatus === 'locked' ? 'Complete' : 'Next Step'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {operatorTransitions.map(target => {
                const blockReason = getTransitionBlockReason(currentStatus, target, context)
                const label = getTransitionLabel(currentStatus, target)
                return (
                  <div key={target}>
                    <Button
                      onClick={() => handleAdvance(target)}
                      disabled={!!blockReason || advancing}
                      className="w-full justify-start text-left"
                      size="lg"
                    >
                      {advancing ? 'Advancing...' : label}
                    </Button>
                    {blockReason && (
                      <p className="text-sm text-muted-foreground mt-1 ml-1">{blockReason}</p>
                    )}
                  </div>
                )
              })}
              {showTabulate && (
                <Button
                  onClick={handlePreviewTabulation}
                  disabled={!allSignedOff || anomalies.some(a => a.blocking)}
                  className="w-full justify-start text-left"
                  size="lg"
                >
                  {anomalies.some(a => a.blocking)
                    ? 'Resolve blockers before tabulation'
                    : !allSignedOff
                      ? 'Waiting for judge sign-offs...'
                      : 'Run Tabulation'}
                </Button>
              )}
              {showRecalls && (
                <Button onClick={handleGenerateRecalls} variant="outline" className="w-full justify-start text-left" size="lg">
                  Generate Recalls (Top {ruleset!.recall_top_percent}%)
                </Button>
              )}
              {showPublish && (
                <Button
                  onClick={() => setShowApprovalDialog(true)}
                  disabled={anomalies.some(a => a.blocking)}
                  className="w-full justify-start text-left"
                  size="lg"
                >
                  {anomalies.some(a => a.blocking)
                    ? 'Resolve blockers before publishing'
                    : 'Publish Results'}
                </Button>
              )}
              {(currentStatus === 'published' || currentStatus === 'locked') && (
                <p className="text-sm text-feis-green">Results published.</p>
              )}
              {(currentStatus === 'published') && (
                <Button
                  onClick={() => setShowUnpublishDialog(true)}
                  variant="outline"
                  className="w-full justify-start text-left"
                  size="lg"
                >
                  Unpublish Results
                </Button>
              )}
              <Link
                href={`/dashboard/events/${eventId}/competitions/${compId}/audit`}
                className="text-xs text-muted-foreground hover:underline"
              >
                View audit trail
              </Link>
            </CardContent>
          </Card>
        )
      })()}

      {/* Roster Status — only show when roster actions are still meaningful */}
      {(['draft', 'imported', 'ready_for_day_of'].includes(comp.status)) && (
        <Card className="feis-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Roster Status</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Roster:</span>
              {comp.roster_confirmed_at ? (
                <Badge className="bg-feis-green-light text-feis-green border-feis-green/30">Confirmed ✓</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">Not confirmed</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {!comp.roster_confirmed_at && ['draft', 'imported', 'ready_for_day_of'].includes(comp.status) && (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await confirmRoster(supabase, compId)
                      await loadData()
                      showSuccess('Roster confirmed')
                    } catch (err) {
                      showError('Failed to confirm roster', { description: err instanceof Error ? err.message : 'Unknown error' })
                    }
                  }}
                >
                  Confirm Roster
                </Button>
              )}
              {comp.roster_confirmed_at && comp.status === 'ready_for_day_of' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const { error } = await supabase
                      .from('competitions')
                      .update({ roster_confirmed_at: null, roster_confirmed_by: null })
                      .eq('id', compId)
                    if (error) {
                      showError('Failed to un-confirm roster', { description: error.message })
                      return
                    }
                    await loadData()
                    showSuccess('Roster un-confirmed')
                  }}
                >
                  Un-confirm
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Roster */}
      {(() => {
        const rosterLocked = ['released_to_judge', 'in_progress', 'awaiting_scores', 'ready_to_tabulate', 'complete_unpublished', 'published', 'locked'].includes(comp.status)
        return (
      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">
            Roster ({registrations.length} dancers)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {registrations.map(reg => (
              <div key={reg.id} className="flex items-center justify-between p-2 rounded hover:bg-feis-green-light/50 transition-colors">
                <span>
                  <span className="feis-number font-mono text-sm mr-3">{reg.competitor_number}</span>
                  {reg.dancers?.first_name} {reg.dancers?.last_name}
                </span>
                {rosterLocked ? (
                  <span className={`text-xs px-2 py-1 rounded ${
                    reg.status === 'scratched' || reg.status === 'no_show' || reg.status === 'disqualified'
                      ? 'bg-destructive/10 text-destructive'
                      : 'text-muted-foreground'
                  }`}>
                    {reg.status === 'present' ? '' : reg.status.replace(/_/g, ' ')}
                  </span>
                ) : (
                <select
                  value={reg.status}
                  onChange={async (e) => {
                    const newStatus = e.target.value
                    const { error } = await supabase
                      .from('registrations')
                      .update({ status: newStatus })
                      .eq('id', reg.id)
                    if (error) {
                      showError('Failed to update status', { description: error.message })
                      return
                    }
                    // Update heat snapshot slot if competition is being scored
                    if (
                      (newStatus === 'scratched' || newStatus === 'no_show') &&
                      latestRound?.heat_snapshot
                    ) {
                      const snap = latestRound.heat_snapshot as { heats: Array<{ heat_number: number; slots: Array<{ dancer_id: string; competitor_number: string; status: string }> }>; group_size: number; generated_at: string }
                      const updatedHeats = snap.heats.map(heat => ({
                        ...heat,
                        slots: heat.slots.map(slot =>
                          slot.dancer_id === reg.dancer_id
                            ? { ...slot, status: newStatus }
                            : slot
                        ),
                      }))
                      await supabase
                        .from('rounds')
                        .update({ heat_snapshot: { ...snap, heats: updatedHeats } })
                        .eq('id', latestRound.id)
                    }
                    await loadData()
                    showSuccess('Dancer status updated')
                  }}
                  className={`text-xs border rounded px-2 py-1 ${
                    reg.status === 'scratched' || reg.status === 'no_show' || reg.status === 'disqualified'
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : reg.status === 'medical' || reg.status === 'did_not_complete'
                        ? 'border-feis-orange/30 bg-feis-orange-light text-feis-orange'
                        : 'border'
                  }`}
                >
                  <option value="present">Present</option>
                  <option value="scratched">Scratched</option>
                  <option value="no_show">No Show</option>
                  <option value="did_not_complete">Did Not Complete</option>
                  <option value="medical">Medical</option>
                  <option value="disqualified">Disqualified</option>
                </select>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
        )
      })()}

      {/* Anomaly Checks */}
      {anomalies.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg">
              Pre-Tabulation Checks ({anomalies.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {anomalies.filter(a => a.blocking).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">Blockers — must resolve before tabulation</p>
                {anomalies.filter(a => a.blocking).map((a) => (
                  <div key={a.dedupe_key} className="text-sm p-2 rounded bg-destructive/10 border border-destructive/20 text-destructive">
                    {resolveAnomalyMessage(a)}
                  </div>
                ))}
              </div>
            )}
            {anomalies.filter(a => a.severity === 'warning').length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-feis-orange">Warnings — review recommended</p>
                {anomalies.filter(a => a.severity === 'warning').map((a) => (
                  <div key={a.dedupe_key} className="text-sm p-2 rounded bg-feis-orange-light border border-feis-orange/20 text-feis-orange">
                    {resolveAnomalyMessage(a)}
                  </div>
                ))}
              </div>
            )}
            {anomalies.filter(a => a.severity === 'info').length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground font-medium">
                  Review signals ({anomalies.filter(a => a.severity === 'info').length})
                </summary>
                <div className="mt-2 space-y-2">
                  {anomalies.filter(a => a.severity === 'info').map((a) => (
                    <div key={a.dedupe_key} className="p-2 rounded bg-muted text-muted-foreground">
                      {resolveAnomalyMessage(a)}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Audit Trail Summary */}
      <Card className="feis-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {auditEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No audit entries yet. Entries appear as scores are entered, sign-offs recorded, and actions taken.
            </p>
          ) : (
            <div className="space-y-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-3 font-normal">When</th>
                    <th className="py-1 pr-3 font-normal">Action</th>
                    <th className="py-1 font-normal">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.slice(0, 5).map((entry) => {
                    const formatted = formatAuditEntry(entry, nameMaps)
                    const relTime = getRelativeTime(entry.created_at)
                    return (
                      <tr key={entry.id} className={formatted.isCorrection ? 'bg-feis-orange-light' : ''}>
                        <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap" title={new Date(entry.created_at).toLocaleString()}>
                          {relTime}
                        </td>
                        <td className="py-1 pr-3">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${formatted.badgeColor}`}>
                            {formatted.badgeText}
                          </span>
                        </td>
                        <td className="py-1">{formatted.summary}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <Link
                href={`/dashboard/events/${eventId}/competitions/${compId}/audit`}
                className="text-xs text-muted-foreground hover:underline mt-2 inline-block"
              >
                View full audit trail &rarr;
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Corrections */}
      {(comp.status === 'ready_to_tabulate' || comp.status === 'complete_unpublished') && (
        <Card className="feis-card border-feis-orange/30">
          <CardHeader>
            <CardTitle className="text-lg">Corrections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {comp.status === 'complete_unpublished' && (
              <div className="p-3 rounded-md bg-feis-orange/10 border border-feis-orange/30 text-sm">
                <p className="font-medium text-feis-orange">Results have been tabulated.</p>
                <p className="text-muted-foreground mt-1">
                  Unlocking a judge&apos;s scores will clear all current results and require re-tabulation.
                </p>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Judge to unlock</label>
                <select
                  value={unlockJudgeId ?? ''}
                  onChange={e => setUnlockJudgeId(e.target.value || null)}
                  className="w-full max-w-md border rounded-md px-3 py-2 text-sm mt-1"
                >
                  <option value="">Select judge...</option>
                  {judges.map(j => {
                    const signedOff = latestRound?.judge_sign_offs?.[j.id]
                    return (
                      <option key={j.id} value={j.id} disabled={!signedOff}>
                        {j.first_name} {j.last_name}
                        {signedOff ? '' : ' (not signed off)'}
                      </option>
                    )
                  })}
                </select>
              </div>
              {unlockJudgeId && (
                <>
                  <div>
                    <label className="text-sm font-medium">Reason for correction</label>
                    <select
                      value={unlockReason}
                      onChange={e => setUnlockReason(e.target.value)}
                      className="w-full max-w-md border rounded-md px-3 py-2 text-sm mt-1"
                    >
                      <option value="">Select reason...</option>
                      {UNLOCK_REASONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  {unlockReason === 'other' && (
                    <div>
                      <label className="text-sm font-medium">Note (required for &quot;Other&quot;)</label>
                      <input
                        type="text"
                        value={unlockNote}
                        onChange={e => setUnlockNote(e.target.value)}
                        placeholder="Briefly describe the correction needed..."
                        className="w-full max-w-md border rounded-md px-3 py-2 text-sm mt-1"
                      />
                    </div>
                  )}
                  {unlockReason && unlockReason !== 'other' && (
                    <div>
                      <label className="text-sm font-medium">Optional note</label>
                      <input
                        type="text"
                        value={unlockNote}
                        onChange={e => setUnlockNote(e.target.value)}
                        placeholder="Additional context (optional)..."
                        className="w-full max-w-md border rounded-md px-3 py-2 text-sm mt-1"
                      />
                    </div>
                  )}
                  <Button
                    onClick={handleUnlockForCorrection}
                    variant="outline"
                    disabled={
                      !unlockReason ||
                      (unlockReason === 'other' && !unlockNote.trim()) ||
                      unlocking
                    }
                    className="border-feis-orange text-feis-orange hover:bg-feis-orange/10"
                  >
                    {unlocking ? 'Unlocking...' : 'Unlock for Correction'}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabulation Preview */}
      {previewResults && (
        <Card className="feis-card border-feis-orange/50 bg-feis-orange/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Tabulation Preview</span>
              <Badge variant="outline" className="border-feis-orange text-feis-orange">
                Not saved — not official
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="feis-thead">
                  <tr>
                    <th className="px-4 py-2 text-left">Place</th>
                    <th className="px-4 py-2 text-left">Dancer</th>
                    <th className="px-4 py-2 text-right">Points</th>
                    {judges.map(j => (
                      <th key={j.id} className="px-4 py-2 text-right text-xs">
                        {j.first_name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="feis-tbody">
                  {previewResults.map(r => {
                    const reg = registrations.find(reg => reg.dancer_id === r.dancer_id)
                    return (
                      <tr key={r.dancer_id} className="border-t">
                        <td className={`px-4 py-2 font-bold ${r.final_rank === 1 ? 'feis-place-1' : r.final_rank === 2 ? 'feis-place-2' : r.final_rank === 3 ? 'feis-place-3' : ''}`}>
                          {r.final_rank}
                        </td>
                        <td className="px-4 py-2">
                          {reg?.dancers?.first_name} {reg?.dancers?.last_name}
                        </td>
                        <td className="px-4 py-2 text-right">{r.total_points}</td>
                        {judges.map(j => {
                          const jr = r.individual_ranks.find(ir => ir.judge_id === j.id)
                          return (
                            <td key={j.id} className="px-4 py-2 text-right text-xs text-muted-foreground">
                              {jr ? `#${jr.rank} (${jr.irish_points}pts)` : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleApproveResults} variant="default">
                Approve & Save Results
              </Button>
              <Button onClick={() => setPreviewResults(null)} variant="outline">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Preview */}
      {results.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg">Results</CardTitle>
          </CardHeader>
          <CardContent>
            <ResultsTable results={results} />
          </CardContent>
        </Card>
      )}

      <ApprovalDialog
        open={showApprovalDialog}
        onOpenChange={setShowApprovalDialog}
        compCode={comp?.code ?? ''}
        compName={comp?.name ?? ''}
        onApprove={handlePublish}
      />
      <UnpublishDialog
        open={showUnpublishDialog}
        onOpenChange={setShowUnpublishDialog}
        compCode={comp?.code ?? ''}
        compName={comp?.name ?? ''}
        onUnpublish={handleUnpublish}
      />
    </div>
  )
}
