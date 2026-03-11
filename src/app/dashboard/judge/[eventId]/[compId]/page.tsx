'use client'

import { useEffect, useState, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { ScoreEntryForm } from '@/components/score-entry-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export default function JudgeEntryPage({
  params,
}: {
  params: Promise<{ eventId: string; compId: string }>
}) {
  const { eventId, compId } = use(params)
  const supabase = useSupabase()
  const [comp, setComp] = useState<any>(null)
  const [registrations, setRegistrations] = useState<any[]>([])
  const [round, setRound] = useState<any>(null)
  const [scores, setScores] = useState<any[]>([])
  const [judgeId, setJudgeId] = useState<string | null>(null)
  const [judges, setJudges] = useState<any[]>([])
  const [ruleConfig, setRuleConfig] = useState<any>(null)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)

  async function loadData(selectedJudgeId?: string) {
    const [compRes, regRes, roundRes, judgesRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number', { ascending: false }).limit(1).single(),
      supabase.from('judges').select('*').eq('event_id', eventId),
    ])

    setComp(compRes.data)
    setRegistrations(regRes.data ?? [])
    setRound(roundRes.data)
    setRuleConfig(compRes.data?.rule_sets?.config)
    setJudges(judgesRes.data ?? [])

    // Use selected judge or first available
    const jId = selectedJudgeId || judgeId || judgesRes.data?.[0]?.id
    if (jId && roundRes.data) {
      setJudgeId(jId)
      const { data: existingScores } = await supabase
        .from('score_entries')
        .select('*')
        .eq('round_id', roundRes.data.id)
        .eq('judge_id', jId)
      setScores(existingScores ?? [])
    }

    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function handleScoreSubmit(dancerId: string, score: number, flagged: boolean, flagReason: string | null) {
    if (!judgeId || !round) return

    await supabase.from('score_entries').upsert(
      {
        round_id: round.id,
        competition_id: compId,
        dancer_id: dancerId,
        judge_id: judgeId,
        raw_score: score,
        flagged,
        flag_reason: flagReason,
      },
      { onConflict: 'round_id,dancer_id,judge_id' }
    )

    loadData()
  }

  async function handleSignOff() {
    if (!judgeId || !round) return

    // Lock all scores for this judge/round
    await supabase
      .from('score_entries')
      .update({ locked_at: new Date().toISOString() })
      .eq('round_id', round.id)
      .eq('judge_id', judgeId)

    // Record sign-off in round's judge_sign_offs jsonb
    const currentSignOffs = round.judge_sign_offs || {}
    const updatedSignOffs = {
      ...currentSignOffs,
      [judgeId]: new Date().toISOString(),
    }
    await supabase
      .from('rounds')
      .update({ judge_sign_offs: updatedSignOffs })
      .eq('id', round.id)

    // Check if all judges have now signed off — if so, advance competition to ready_to_tabulate
    const { data: allJudges } = await supabase
      .from('judges')
      .select('id')
      .eq('event_id', eventId)
    const allJudgeIds = allJudges?.map(j => j.id) ?? []
    const allDone = allJudgeIds.length > 0 && allJudgeIds.every(id => updatedSignOffs[id])

    if (allDone) {
      const { data: currentComp } = await supabase
        .from('competitions')
        .select('status')
        .eq('id', compId)
        .single()
      if (currentComp?.status === 'awaiting_scores') {
        await supabase
          .from('competitions')
          .update({ status: 'ready_to_tabulate' })
          .eq('id', compId)
      }
    }

    setSubmitted(true)
  }

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>
  if (!comp) return <p className="p-6">Competition not found.</p>

  const scoreMin = ruleConfig?.score_min ?? 0
  const scoreMax = ruleConfig?.score_max ?? 100
  const scoredCount = scores.length
  const totalDancers = registrations.length

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card className="feis-card feis-accent-left mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-2xl">{comp.code && `${comp.code} — `}{comp.name}</CardTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Round {round?.round_number}</span>
            <Badge variant="outline">{scoredCount}/{totalDancers} scored</Badge>
          </div>
          {/* Judge selector — prototype only, replace with auth later */}
          {judges.length > 0 && (
            <div className="flex gap-2 mt-2">
              {judges.map(j => (
                <button
                  key={j.id}
                  onClick={() => { setJudgeId(j.id); loadData(j.id) }}
                  className={`px-2 py-1 text-xs rounded border ${judgeId === j.id ? 'bg-feis-green text-white' : ''}`}
                >
                  {j.first_name} {j.last_name}
                </button>
              ))}
            </div>
          )}
        </CardHeader>
      </Card>

      {submitted ? (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-feis-green">Round signed off. Scores locked.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Contact the tabulator if you need to make changes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2 mb-6">
            {registrations.map(reg => {
              const existing = scores.find(s => s.dancer_id === reg.dancer_id)
              return (
                <ScoreEntryForm
                  key={reg.id}
                  dancerId={reg.dancer_id}
                  dancerName={`${reg.dancers?.first_name} ${reg.dancers?.last_name}`}
                  competitorNumber={reg.competitor_number}
                  existingScore={existing?.raw_score}
                  existingFlagged={existing?.flagged ?? false}
                  existingFlagReason={existing?.flag_reason}
                  scoreMin={scoreMin}
                  scoreMax={scoreMax}
                  onSubmit={handleScoreSubmit}
                  locked={submitted}
                />
              )
            })}
          </div>

          <Button
            onClick={handleSignOff}
            disabled={scoredCount < totalDancers}
            className="w-full text-lg font-semibold"
            size="lg"
          >
            {scoredCount < totalDancers
              ? `Score all dancers to sign off (${scoredCount}/${totalDancers})`
              : 'Sign Off Round'}
          </Button>
        </>
      )}
    </div>
  )
}
