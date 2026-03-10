'use client'

import { useEffect, useState, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { tabulate, type ScoreInput, type TabulationResult } from '@/lib/engine/tabulate'
import { generateRecalls } from '@/lib/engine/recalls'
import { type RuleSetConfig } from '@/lib/engine/rules'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
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
  const [loading, setLoading] = useState(true)

  async function loadData() {
    const [compRes, regRes, roundRes, scoreRes, resultRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number'),
      supabase.from('score_entries').select('*').eq('competition_id', compId),
      supabase.from('results').select('*, dancers(*)').eq('competition_id', compId).order('final_rank'),
    ])

    setComp(compRes.data)
    setRegistrations(regRes.data ?? [])
    setRounds(roundRes.data ?? [])
    setScores(scoreRes.data ?? [])
    setResults(resultRes.data ?? [])
    setRuleset(compRes.data?.rule_sets?.config as RuleSetConfig | null ?? null)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function handleTabulate() {
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
      }))

    const tabulationResults: TabulationResult[] = tabulate(roundScores, ruleset)

    for (const r of tabulationResults) {
      await supabase.from('results').upsert(
        {
          competition_id: compId,
          dancer_id: r.dancer_id,
          final_rank: r.final_rank,
          display_place: String(r.final_rank),
          calculated_payload: r,
        },
        { onConflict: 'competition_id,dancer_id' }
      )
    }

    await supabase
      .from('competitions')
      .update({ status: 'complete_unpublished' })
      .eq('id', compId)

    loadData()
  }

  async function handlePublish() {
    if (!comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'published')) return

    const now = new Date().toISOString()
    await supabase
      .from('results')
      .update({ published_at: now })
      .eq('competition_id', compId)

    await supabase
      .from('competitions')
      .update({ status: 'published' })
      .eq('id', compId)

    loadData()
  }

  async function handleGenerateRecalls() {
    if (!ruleset || !comp) return
    if (!ruleset.recall_top_n) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'recalled_round_pending')) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    const roundScores: ScoreInput[] = scores
      .filter(s => s.round_id === latestRound.id)
      .map(s => ({
        dancer_id: s.dancer_id,
        judge_id: s.judge_id,
        raw_score: Number(s.raw_score),
      }))

    const tabulationResults: TabulationResult[] = tabulate(roundScores, ruleset)
    const recalled: TabulationResult[] = generateRecalls(tabulationResults, ruleset.recall_top_n)

    for (const r of recalled) {
      await supabase.from('recalls').upsert(
        {
          competition_id: compId,
          source_round_id: latestRound.id,
          dancer_id: r.dancer_id,
          recall_status: 'recalled',
        },
        { onConflict: 'competition_id,source_round_id,dancer_id' }
      )
    }

    const nextNum = (rounds[rounds.length - 1]?.round_number ?? 0) + 1
    await supabase.from('rounds').insert({
      competition_id: compId,
      round_number: nextNum,
      round_type: 'recall',
    })

    await supabase
      .from('competitions')
      .update({ status: 'recalled_round_pending' })
      .eq('id', compId)

    loadData()
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>
  if (!comp) return <p>Competition not found.</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{comp.code && `${comp.code} — `}{comp.name}</h1>
          <p className="text-sm text-muted-foreground">{comp.age_group} · {comp.level}</p>
        </div>
        <CompetitionStatusBadge status={comp.status} />
      </div>

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
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2 flex-wrap">
          <Button onClick={handleTabulate} variant="default">
            Run Tabulation
          </Button>
          {ruleset && ruleset.recall_top_n > 0 && (
            <Button onClick={handleGenerateRecalls} variant="outline">
              Generate Recalls (Top {ruleset.recall_top_n})
            </Button>
          )}
          {results.length > 0 && comp.status !== 'published' && (
            <Button onClick={handlePublish} variant="outline">
              Publish Results
            </Button>
          )}
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
                    <th className="px-4 py-2 text-right">Score</th>
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
                        {r.calculated_payload?.average_score?.toFixed(1)}
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
