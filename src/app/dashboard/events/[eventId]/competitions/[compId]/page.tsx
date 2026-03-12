'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
import { tabulate, type ScoreInput } from '@/lib/engine/tabulate'
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
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
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
  const [advanceError, setAdvanceError] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function handleTabulate() {
    if (!ruleset || !comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'complete_unpublished')) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    setActionError(null)

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

      for (const r of tabulationResults) {
        const { error } = await supabase.from('results').upsert(
          {
            competition_id: compId,
            dancer_id: r.dancer_id,
            final_rank: r.final_rank,
            display_place: String(r.final_rank),
            calculated_payload: {
              total_points: r.total_points,
              individual_ranks: r.individual_ranks,
              rules_snapshot: ruleset,
            },
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

      await loadData()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Tabulation failed')
    }
  }

  async function handlePublish() {
    if (!comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'published')) return

    setActionError(null)

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

      await loadData()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Publish failed')
    }
  }

  async function handleGenerateRecalls() {
    if (!ruleset || !comp) return
    if (!ruleset.recall_top_percent) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'recalled_round_pending')) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    setActionError(null)

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

      await loadData()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Recall generation failed')
    }
  }

  async function handleAdvance(targetStatus: CompetitionStatus) {
    if (!comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, targetStatus)) {
      setAdvanceError(`Cannot transition from ${currentStatus} to ${targetStatus}`)
      return
    }

    setAdvancing(true)
    setAdvanceError(null)

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

      await loadData()
    } catch (err) {
      setAdvanceError(err instanceof Error ? err.message : 'Failed to advance competition')
    } finally {
      setAdvancing(false)
    }
  }

  const latestRound = rounds[rounds.length - 1]
  const allSignedOff = latestRound && judges.length > 0 &&
    judges.every(j => latestRound.judge_sign_offs?.[j.id])

  function resolveAnomalyMessage(anomaly: Anomaly): string {
    let msg = anomaly.message
    const judgeId = anomaly.entity_ids.judge_id
    if (judgeId) {
      const judge = judges.find(j => j.id === judgeId)
      if (judge) msg = msg.replace(judgeId, `${judge.first_name} ${judge.last_name}`)
    }
    const dancerId = anomaly.entity_ids.dancer_id
    if (dancerId) {
      const reg = registrations.find(r => r.dancer_id === dancerId)
      const name = reg?.dancers
        ? `${reg.dancers.first_name} ${reg.dancers.last_name} (#${reg.competitor_number})`
        : dancerId
      msg = msg.replace(dancerId, name)
    }
    return msg
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
                setActionError(`Failed to update numbers: ${error.message}`)
                return
              }
              loadData()
            }}
          >
            {comp.numbers_released ? '✓ Numbers Released' : 'Release Numbers'}
          </Button>
        </div>
      </div>

      {/* Next Step */}
      {(() => {
        const currentStatus = comp.status as CompetitionStatus
        const nextStates = getNextStates(currentStatus)
        // Only show operator-driven transitions (not tabulate/recalls/publish — those have their own buttons)
        const operatorTransitions = nextStates.filter(s =>
          ['ready_for_day_of', 'in_progress', 'awaiting_scores'].includes(s)
        )

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
              {advanceError && (
                <div className="p-2 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
                  {advanceError}
                </div>
              )}
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
                <Badge variant="outline">{reg.status}</Badge>
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

      {/* Actions */}
      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {actionError && (
            <div className="p-2 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
              {actionError}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
          {(comp.status === 'awaiting_scores' || comp.status === 'in_progress') && (
            <Link href={`/dashboard/events/${eventId}/competitions/${compId}/tabulator`}>
              <Button variant="outline">Enter Scores (Tabulator)</Button>
            </Link>
          )}
          <Button
            onClick={handleTabulate}
            variant="default"
            disabled={!allSignedOff || anomalies.some(a => a.blocking)}
          >
            {anomalies.some(a => a.blocking)
              ? 'Resolve blockers before tabulation'
              : !allSignedOff
                ? 'Waiting for judge sign-offs...'
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

      {/* Results Preview */}
      {results.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg">Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="feis-thead">
                  <tr>
                    <th className="px-4 py-2 text-left">Place</th>
                    <th className="px-4 py-2 text-left">Dancer</th>
                    <th className="px-4 py-2 text-right">Points</th>
                  </tr>
                </thead>
                <tbody className="feis-tbody">
                  {results.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className={`px-4 py-2 font-bold ${r.final_rank === 1 ? 'feis-place-1' : r.final_rank === 2 ? 'feis-place-2' : r.final_rank === 3 ? 'feis-place-3' : ''}`}>{r.final_rank}</td>
                      <td className="px-4 py-2">
                        {r.dancers?.first_name} {r.dancers?.last_name}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {r.calculated_payload?.total_points ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
