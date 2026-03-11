'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { ScoreEntryForm } from '@/components/score-entry-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  const [comp, setComp] = useState<any>(null)
  const [registrations, setRegistrations] = useState<any[]>([])
  const [round, setRound] = useState<any>(null)
  const [scores, setScores] = useState<any[]>([])
  const [ruleConfig, setRuleConfig] = useState<any>(null)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)

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
    loadData(parsed.judge_id)
  }, [])

  async function loadData(judgeId: string) {
    const [compRes, regRes, roundRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId).order('competitor_number'),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number', { ascending: false }).limit(1).single(),
    ])

    setComp(compRes.data)
    setRegistrations(regRes.data ?? [])
    setRound(roundRes.data)
    setRuleConfig(compRes.data?.rule_sets?.config)

    if (roundRes.data) {
      // Check if this judge already signed off
      if (roundRes.data.judge_sign_offs?.[judgeId]) {
        setSubmitted(true)
      }

      const { data: existingScores } = await supabase
        .from('score_entries')
        .select('*')
        .eq('round_id', roundRes.data.id)
        .eq('judge_id', judgeId)
      setScores(existingScores ?? [])
    }

    setLoading(false)
  }

  async function handleScoreSubmit(dancerId: string, score: number, flagged: boolean, flagReason: string | null) {
    if (!session || !round) return

    await supabase.from('score_entries').upsert(
      {
        round_id: round.id,
        competition_id: compId,
        dancer_id: dancerId,
        judge_id: session.judge_id,
        raw_score: score,
        flagged,
        flag_reason: flagReason,
      },
      { onConflict: 'round_id,dancer_id,judge_id' }
    )

    loadData(session.judge_id)
  }

  async function handleSignOff() {
    if (!session || !round) return

    // Lock all scores for this judge/round
    await supabase
      .from('score_entries')
      .update({ locked_at: new Date().toISOString() })
      .eq('round_id', round.id)
      .eq('judge_id', session.judge_id)

    // Record sign-off in round's judge_sign_offs jsonb
    const currentSignOffs = round.judge_sign_offs || {}
    const updatedSignOffs = {
      ...currentSignOffs,
      [session.judge_id]: new Date().toISOString(),
    }
    await supabase
      .from('rounds')
      .update({ judge_sign_offs: updatedSignOffs })
      .eq('id', round.id)

    // Check if all judges have now signed off
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
    <div>
      <div className="mb-4">
        <Link href={`/judge/${eventId}`} className="text-sm text-muted-foreground hover:text-feis-green transition-colors">
          &larr; Back to competitions
        </Link>
      </div>

      <Card className="feis-card feis-accent-left mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-2xl">{comp.code && `${comp.code} — `}{comp.name}</CardTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Round {round?.round_number}</span>
            <Badge variant="outline">{scoredCount}/{totalDancers} scored</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Scoring as <span className="font-medium text-feis-green">{session?.name}</span>
          </p>
        </CardHeader>
      </Card>

      {submitted ? (
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
