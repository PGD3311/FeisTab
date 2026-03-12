'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
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
import { logAudit } from '@/lib/audit'
import { showSuccess, showError, showCritical } from '@/lib/feedback'
import { formatAuditEntry, type AuditEntry, type NameMaps } from '@/lib/audit-format'
import { buildCalculatedPayload } from '@/lib/result-payload'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
import { ResultsTable } from '@/components/results-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function CompetitionDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; compId: string }>
}) {
  const { eventId, compId } = use(params)
  const supabase = useSupabase()
  const [comp, setComp] = useState<any>(null)
  const [registrations, setRegistrations] = useState<any[]>([])
  const [rounds, setRounds] = useState<any[]>([])
  const [scores, setScores] = useState<any[]>([])
  const [results, setResults] = useState<any[]>([])
  const [ruleset, setRuleset] = useState<RuleSetConfig | null>(null)
  const [judges, setJudges] = useState<{ id: string; first_name: string; last_name: string }[]>([])
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

  async function loadData() {
    const [compRes, regRes, roundRes, scoreRes, resultRes, judgesRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number'),
      supabase.from('score_entries').select('*').eq('competition_id', compId),
      supabase.from('results').select('*, dancers(*)').eq('competition_id', compId).order('final_rank'),
      supabase.from('judges').select('id, first_name, last_name').eq('event_id', eventId),
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
    setRuleset(compRes.data?.rule_sets?.config as RuleSetConfig | null ?? null)
    setJudges(judgesRes.data ?? [])

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
        judge_ids: judgesRes.data.map((j: { id: string }) => j.id),
        results: (resultRes.data ?? []).map(r => ({
          dancer_id: r.dancer_id,
          final_rank: r.final_rank,
          calculated_payload: r.calculated_payload ?? { total_points: 0, individual_ranks: [] },
        })),
        rules: compRes.data?.rule_sets?.config as RuleSetConfig ?? DEFAULT_RULES,
        recalls: [],
      }
      setAnomalies(detectAnomalies(anomalyInput))
    } else {
      setAnomalies([])
    }

    // Fetch audit entries for this competition
    const { data: auditByEntity } = await supabase
      .from('audit_log')
      .select('*')
      .eq('entity_id', compId)
      .order('created_at', { ascending: false })
      .limit(20)

    const { data: auditByPayload } = await supabase
      .from('audit_log')
      .select('*')
      .contains('after_data', { competition_id: compId })
      .order('created_at', { ascending: false })
      .limit(20)

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

  useEffect(() => { loadData() }, [])

  async function handlePreviewTabulation() {
    if (!ruleset || !comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'complete_unpublished')) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    const roundScores: ScoreInput[] = scores
      .filter(s => s.round_id === latestRound.id)
      .map(s => ({
        dancer_id: s.dancer_id,
        judge_id: s.judge_id,
        raw_score: Number(s.raw_score),
        flagged: s.flagged ?? false,
      }))

    const tabulationResults = tabulate(roundScores, ruleset)
    setPreviewResults(tabulationResults)
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

      for (const r of previewResults) {
        const enrichedPayload = buildCalculatedPayload(
          r,
          judges,
          mappedScores,
          previewResults,
          ruleset
        )

        const { error } = await supabase.from('results').upsert(
          {
            competition_id: compId,
            dancer_id: r.dancer_id,
            final_rank: r.final_rank,
            display_place: String(r.final_rank),
            calculated_payload: enrichedPayload,
          },
          { onConflict: 'competition_id,dancer_id' }
        )
        if (error) throw new Error(`Failed to save result for dancer: ${error.message}`)
      }

      const { error: statusErr } = await supabase
        .from('competitions')
        .update({ status: 'complete_unpublished' })
        .eq('id', compId)
      if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)

      void logAudit(supabase, {
        userId: null,
        entityType: 'competition',
        entityId: compId,
        action: 'tabulate',
        afterData: { result_count: previewResults.length, round_id: latestRound.id },
      })

      setPreviewResults(null)
      await loadData()
      showSuccess('Results approved and saved')
    } catch (err) {
      showCritical('Failed to save results', { description: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  async function handlePublish() {
    if (!comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'published')) return

    try {
      const now = new Date().toISOString()
      const { error: pubErr } = await supabase
        .from('results')
        .update({ published_at: now })
        .eq('competition_id', compId)
      if (pubErr) throw new Error(`Failed to publish results: ${pubErr.message}`)

      const { error: statusErr } = await supabase
        .from('competitions')
        .update({ status: 'published' })
        .eq('id', compId)
      if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)

      void logAudit(supabase, {
        userId: null,
        entityType: 'competition',
        entityId: compId,
        action: 'result_publish',
        afterData: { published_at: now },
      })

      await loadData()
      showSuccess('Results published')
    } catch (err) {
      showCritical('Publish failed', { description: err instanceof Error ? err.message : 'Unknown error' })
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

      for (const r of recalled) {
        const { error } = await supabase.from('recalls').upsert(
          {
            competition_id: compId,
            source_round_id: latestRound.id,
            dancer_id: r.dancer_id,
            recall_status: 'recalled',
          },
          { onConflict: 'competition_id,source_round_id,dancer_id' }
        )
        if (error) throw new Error(`Failed to save recall: ${error.message}`)
      }

      const nextNum = (rounds[rounds.length - 1]?.round_number ?? 0) + 1
      const { error: roundErr } = await supabase.from('rounds').insert({
        competition_id: compId,
        round_number: nextNum,
        round_type: 'recall',
      })
      if (roundErr) throw new Error(`Failed to create recall round: ${roundErr.message}`)

      const { error: statusErr } = await supabase
        .from('competitions')
        .update({ status: 'recalled_round_pending' })
        .eq('id', compId)
      if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)

      void logAudit(supabase, {
        userId: null,
        entityType: 'competition',
        entityId: compId,
        action: 'recall_generate',
        afterData: { recalled_count: recalled.length, source_round_id: latestRound.id, new_round_number: nextNum },
      })

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
        const { error: roundErr } = await supabase.from('rounds').insert({
          competition_id: compId,
          round_number: 1,
          round_type: 'standard',
        })
        if (roundErr) throw new Error(`Failed to create round: ${roundErr.message}`)
      }

      const { error: statusErr } = await supabase
        .from('competitions')
        .update({ status: targetStatus })
        .eq('id', compId)

      if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)

      void logAudit(supabase, {
        userId: null,
        entityType: 'competition',
        entityId: compId,
        action: 'status_change',
        beforeData: { status: currentStatus },
        afterData: { status: targetStatus },
      })

      await loadData()
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
      // 1. Remove judge's sign-off
      const currentSignOffs = latestRnd.judge_sign_offs ?? {}
      const { [unlockJudgeId]: _, ...remainingSignOffs } = currentSignOffs
      const { error: signOffErr } = await supabase
        .from('rounds')
        .update({ judge_sign_offs: remainingSignOffs })
        .eq('id', latestRnd.id)
      if (signOffErr) throw new Error(`Failed to remove sign-off: ${signOffErr.message}`)

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
      const { error: statusErr } = await supabase
        .from('competitions')
        .update({ status: 'awaiting_scores' })
        .eq('id', compId)
      if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)

      // 5. Audit log
      const unlockJudge = judges.find(j => j.id === unlockJudgeId)
      void logAudit(supabase, {
        userId: null,
        entityType: 'competition',
        entityId: compId,
        action: 'unlock_for_correction',
        beforeData: { status: currentStatus, judge_id: unlockJudgeId },
        afterData: {
          status: 'awaiting_scores',
          judge_id: unlockJudgeId,
          judge_name: unlockJudge ? `${unlockJudge.first_name} ${unlockJudge.last_name}` : null,
          reason: unlockReason,
          note: unlockNote.trim() || null,
          results_cleared: currentStatus === 'complete_unpublished',
        },
      })

      // Reset form
      setUnlockJudgeId(null)
      setUnlockReason('')
      setUnlockNote('')
      await loadData()
      showSuccess('Unlocked for correction')
    } catch (err) {
      showCritical('Unlock failed', { description: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setUnlocking(false)
    }
  }

  const latestRound = rounds[rounds.length - 1]
  const allSignedOff = latestRound && judges.length > 0 &&
    judges.every(j => latestRound.judge_sign_offs?.[j.id])

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

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>
  if (!comp) return <p>Competition not found.</p>

  return (
    <div className="space-y-6">
      <Link href={`/dashboard/events/${eventId}/competitions`} className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" /> Competitions
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{comp.code && `${comp.code} — `}{comp.name}</h1>
          <p className="text-sm text-muted-foreground">{comp.age_group} · {comp.level}</p>
        </div>
        <div className="flex items-center gap-2">
          <CompetitionStatusBadge status={comp.status} />
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const newValue = !comp.numbers_released
              const { error } = await supabase
                .from('competitions')
                .update({ numbers_released: newValue })
                .eq('id', compId)
              if (error) {
                showError(newValue ? 'Failed to release numbers' : 'Failed to hide numbers')
                return
              }
              await loadData()
              showSuccess(newValue ? 'Numbers released' : 'Numbers hidden')
            }}
          >
            {comp.numbers_released ? '✓ Numbers Released' : 'Release Numbers'}
          </Button>
        </div>
      </div>

      {loadWarning && (
        <div className="p-3 rounded-md bg-orange-50 border border-orange-200 text-orange-800 text-sm">
          Some competition data could not be loaded. Roster, scores, or judge details may be incomplete. Refresh to try again.
        </div>
      )}

      {/* Next Step */}
      {(() => {
        const currentStatus = comp.status as CompetitionStatus
        const nextStates = getNextStates(currentStatus)
        // Only show operator-driven transitions (not tabulate/recalls/publish — those have their own buttons)
        const operatorTransitions = nextStates.filter(s => {
          if (s === 'awaiting_scores' && currentStatus !== 'in_progress') return false
          return ['ready_for_day_of', 'in_progress', 'awaiting_scores'].includes(s)
        })

        if (operatorTransitions.length === 0) return null

        const context: TransitionContext = {
          registrationCount: registrations.length,
          judgeCount: judges.length,
          roundCount: rounds.length,
        }

        return (
          <Card className="feis-card border-feis-green/30 bg-feis-green-light/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Next Step</CardTitle>
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
            </CardContent>
          </Card>
        )
      })()}

      {/* Roster */}
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
                    void logAudit(supabase, {
                      userId: null,
                      entityType: 'registration',
                      entityId: reg.id,
                      action: 'status_change',
                      beforeData: { status: reg.status, dancer_id: reg.dancer_id, competition_id: compId },
                      afterData: { status: newStatus, dancer_id: reg.dancer_id, competition_id: compId },
                    })
                    await loadData()
                    showSuccess('Dancer status updated')
                  }}
                  className={`text-xs border rounded px-2 py-1 ${
                    reg.status === 'scratched' || reg.status === 'no_show' || reg.status === 'disqualified'
                      ? 'border-red-300 bg-red-50 text-red-800'
                      : reg.status === 'medical' || reg.status === 'did_not_complete'
                        ? 'border-orange-300 bg-orange-50 text-orange-800'
                        : 'border-gray-200'
                  }`}
                >
                  <option value="present">Present</option>
                  <option value="scratched">Scratched</option>
                  <option value="no_show">No Show</option>
                  <option value="did_not_complete">Did Not Complete</option>
                  <option value="medical">Medical</option>
                  <option value="disqualified">Disqualified</option>
                </select>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Rounds & Scores */}
      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">
            Rounds ({rounds.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rounds.map(round => {
            const roundScores = scores.filter(s => s.round_id === round.id)
            return (
              <div key={round.id} className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium">Round {round.round_number}</span>
                  <Badge variant="outline">{round.round_type}</Badge>
                  <Badge variant="outline">{round.status}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {roundScores.length} score entries
                  </span>
                </div>
                <div className="flex gap-1 flex-wrap mt-1">
                  {judges.map(j => {
                    const signedOff = round.judge_sign_offs?.[j.id]
                    return (
                      <span key={j.id} className={`text-xs px-2 py-0.5 rounded ${signedOff ? 'bg-feis-green-light text-feis-green' : 'bg-gray-100 text-gray-500'}`}>
                        {j.first_name}: {signedOff ? 'Signed off' : 'Pending'}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

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
                {anomalies.filter(a => a.blocking).map((a, i) => (
                  <div key={a.dedupe_key} className="text-sm p-2 rounded bg-red-50 border border-red-200 text-red-800">
                    {resolveAnomalyMessage(a)}
                  </div>
                ))}
              </div>
            )}
            {anomalies.filter(a => a.severity === 'warning').length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-feis-orange">Warnings — review recommended</p>
                {anomalies.filter(a => a.severity === 'warning').map((a, i) => (
                  <div key={a.dedupe_key} className="text-sm p-2 rounded bg-orange-50 border border-orange-200 text-orange-800">
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
                  {anomalies.filter(a => a.severity === 'info').map((a, i) => (
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

      {/* Recent Activity */}
      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Recent Activity</span>
            {auditEntries.length > 0 && (
              <Link
                href={`/dashboard/events/${eventId}/competitions/${compId}/audit`}
                className="text-sm font-normal text-feis-green hover:underline"
              >
                View full audit trail →
              </Link>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No audit entries yet. Entries appear as scores are entered, sign-offs recorded, and actions taken.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium text-xs">When</th>
                  <th className="pb-2 pr-3 font-medium text-xs">Action</th>
                  <th className="pb-2 font-medium text-xs">Details</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.slice(0, 5).map(entry => {
                  const formatted = formatAuditEntry(entry, nameMaps)
                  return (
                    <tr key={entry.id} className={`border-b last:border-0 ${formatted.isCorrection ? 'bg-orange-50' : ''}`}>
                      <td
                        className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap"
                        title={new Date(entry.created_at).toLocaleString()}
                      >
                        {relativeTime(entry.created_at)}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${formatted.badgeColor}`}>
                          {formatted.badgeText}
                        </span>
                      </td>
                      <td className="py-2 text-xs">{formatted.summary}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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

      {/* Actions */}
      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
          {(comp.status === 'awaiting_scores' || comp.status === 'in_progress') && (
            <Link href={`/dashboard/events/${eventId}/competitions/${compId}/tabulator`}>
              <Button variant="outline">Enter Scores (Tabulator)</Button>
            </Link>
          )}
          <Button
            onClick={handlePreviewTabulation}
            variant="default"
            disabled={!allSignedOff || anomalies.some(a => a.blocking) || !!previewResults}
          >
            {anomalies.some(a => a.blocking)
              ? 'Resolve blockers before tabulation'
              : !allSignedOff
                ? 'Waiting for judge sign-offs...'
                : previewResults
                  ? 'Preview shown below'
                  : 'Run Tabulation'}
          </Button>
          {ruleset && ruleset.recall_top_percent > 0 && (
            <Button onClick={handleGenerateRecalls} variant="outline">
              Generate Recalls (Top {ruleset.recall_top_percent}%)
            </Button>
          )}
          {results.length > 0 && comp.status !== 'published' && (
            <Button onClick={handlePublish} variant="outline">
              Publish Results
            </Button>
          )}
          </div>
        </CardContent>
      </Card>

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
    </div>
  )
}
