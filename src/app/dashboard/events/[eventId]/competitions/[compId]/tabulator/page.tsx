'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
import { ScoreEntryForm } from '@/components/score-entry-form'
import { logAudit } from '@/lib/audit'
import { canEnterScores, type EntryMode } from '@/lib/entry-mode'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface Judge {
  id: string
  first_name: string
  last_name: string
}

interface Registration {
  id: string
  dancer_id: string
  competitor_number: string
  dancers: { first_name: string; last_name: string } | null
}

interface Round {
  id: string
  round_number: number
  round_type: string
  judge_sign_offs: Record<string, string> | null
}

interface ScoreEntry {
  id: string
  dancer_id: string
  raw_score: number
  flagged: boolean
  flag_reason: string | null
  entry_mode: EntryMode
}

export default function TabulatorEntryPage({
  params,
}: {
  params: Promise<{ eventId: string; compId: string }>
}) {
  const { eventId, compId } = use(params)
  const supabase = useSupabase()

  const [judges, setJudges] = useState<Judge[]>([])
  const [selectedJudgeId, setSelectedJudgeId] = useState<string>('')
  const [compCode, setCompCode] = useState('')
  const [compStatus, setCompStatus] = useState<CompetitionStatus>('draft')
  const [ruleConfig, setRuleConfig] = useState<{ score_min: number; score_max: number } | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [round, setRound] = useState<Round | null>(null)
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [packetBlocked, setPacketBlocked] = useState<string | null>(null)
  const [signedOff, setSignedOff] = useState(false)

  async function loadBase() {
    const [compRes, judgesRes, regRes, roundRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('judges').select('id, first_name, last_name').eq('event_id', eventId),
      supabase
        .from('registrations')
        .select('id, dancer_id, competitor_number, dancers(first_name, last_name)')
        .eq('competition_id', compId)
        .order('competitor_number'),
      supabase
        .from('rounds')
        .select('*')
        .eq('competition_id', compId)
        .order('round_number', { ascending: false })
        .limit(1)
        .single(),
    ])

    if (compRes.error) {
      setError(`Failed to load competition: ${compRes.error.message}`)
      setLoading(false)
      return
    }
    if (judgesRes.error) {
      setError(`Failed to load judges: ${judgesRes.error.message}`)
      setLoading(false)
      return
    }
    if (regRes.error) {
      setError(`Failed to load registrations: ${regRes.error.message}`)
      setLoading(false)
      return
    }
    if (roundRes.error) {
      if (roundRes.error.code !== 'PGRST116') {
        setError(`Failed to load round: ${roundRes.error.message}`)
        setLoading(false)
        return
      }
    }

    const status = (compRes.data?.status as CompetitionStatus) ?? 'draft'
    setCompCode(compRes.data?.code ?? '')
    setCompStatus(status)
    setRuleConfig(compRes.data?.rule_sets?.config ?? null)
    setJudges(judgesRes.data ?? [])
    setRegistrations((regRes.data as unknown as Registration[]) ?? [])
    setRound(roundRes.data as Round | null)
    setLoading(false)
  }

  async function loadJudgeScores(judgeId: string) {
    if (!round) return

    setPacketBlocked(null)
    setSignedOff(false)

    if (round.judge_sign_offs?.[judgeId]) {
      setSignedOff(true)
    }

    const { data: existingScores, error: scoresErr } = await supabase
      .from('score_entries')
      .select('id, dancer_id, raw_score, flagged, flag_reason, entry_mode')
      .eq('round_id', round.id)
      .eq('judge_id', judgeId)

    if (scoresErr) {
      setError(`Failed to load scores: ${scoresErr.message}`)
      return
    }

    const entries = (existingScores ?? []) as ScoreEntry[]

    const existingModes = entries.map(s => s.entry_mode)
    const check = canEnterScores(existingModes, 'tabulator_transcription')
    if (!check.allowed) {
      setPacketBlocked(check.reason ?? 'Packet locked to another entry mode.')
      setScores([])
      return
    }

    setScores(entries)
  }

  useEffect(() => {
    loadBase()
  }, [])

  useEffect(() => {
    if (selectedJudgeId && round) {
      loadJudgeScores(selectedJudgeId)
    } else {
      setScores([])
      setPacketBlocked(null)
      setSignedOff(false)
    }
  }, [selectedJudgeId, round])

  async function handleScoreSubmit(
    dancerId: string,
    score: number,
    flagged: boolean,
    flagReason: string | null
  ) {
    if (!selectedJudgeId || !round) return

    const { error: upsertErr } = await supabase.from('score_entries').upsert(
      {
        round_id: round.id,
        competition_id: compId,
        dancer_id: dancerId,
        judge_id: selectedJudgeId,
        raw_score: score,
        flagged,
        flag_reason: flagReason,
        entry_mode: 'tabulator_transcription' as EntryMode,
        entered_by_user_id: null,
      },
      { onConflict: 'round_id,dancer_id,judge_id' }
    )

    if (upsertErr) {
      setError(`Failed to save score: ${upsertErr.message}`)
      return
    }

    void logAudit(supabase, {
      userId: null,
      entityType: 'score_entry',
      entityId: compId,
      action: 'score_transcribe',
      afterData: {
        dancer_id: dancerId,
        judge_id: selectedJudgeId,
        raw_score: score,
        flagged,
        entry_mode: 'tabulator_transcription',
      },
    })

    await loadJudgeScores(selectedJudgeId)
  }

  async function handleSignOff() {
    if (!selectedJudgeId || !round) return

    try {
      const { error: lockErr } = await supabase
        .from('score_entries')
        .update({ locked_at: new Date().toISOString() })
        .eq('round_id', round.id)
        .eq('judge_id', selectedJudgeId)

      if (lockErr) throw new Error(`Failed to lock scores: ${lockErr.message}`)

      const currentSignOffs = round.judge_sign_offs || {}
      const updatedSignOffs = {
        ...currentSignOffs,
        [selectedJudgeId]: new Date().toISOString(),
      }

      const { error: signOffErr } = await supabase
        .from('rounds')
        .update({ judge_sign_offs: updatedSignOffs })
        .eq('id', round.id)

      if (signOffErr) throw new Error(`Failed to record sign-off: ${signOffErr.message}`)

      const allDone =
        judges.length > 0 && judges.every(j => updatedSignOffs[j.id])

      if (allDone && canTransition(compStatus, 'ready_to_tabulate')) {
        const { error: statusErr } = await supabase
          .from('competitions')
          .update({ status: 'ready_to_tabulate' })
          .eq('id', compId)

        if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)
      }

      void logAudit(supabase, {
        userId: null,
        entityType: 'round',
        entityId: round.id,
        action: 'sign_off',
        afterData: {
          judge_id: selectedJudgeId,
          competition_id: compId,
          entry_mode: 'tabulator_transcription',
          all_judges_done: allDone,
        },
      })

      setSignedOff(true)
      setRound({ ...round, judge_sign_offs: updatedSignOffs })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-off failed')
    }
  }

  const scoreMin = ruleConfig?.score_min ?? 0
  const scoreMax = ruleConfig?.score_max ?? 100
  const scoredCount = scores.length
  const totalDancers = registrations.length
  const selectedJudge = judges.find(j => j.id === selectedJudgeId)

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  const canScore = compStatus === 'awaiting_scores' || compStatus === 'in_progress'

  if (!canScore) {
    return (
      <div className="space-y-6">
        <Link
          href={`/dashboard/events/${eventId}/competitions/${compId}`}
          className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Competition
        </Link>
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              Score entry is not available. Competition status: {compStatus}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!round) {
    return (
      <div className="space-y-6">
        <Link
          href={`/dashboard/events/${eventId}/competitions/${compId}`}
          className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Competition
        </Link>
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              No round available for scoring yet.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/events/${eventId}/competitions/${compId}`}
        className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" /> Back to Competition
      </Link>

      <div>
        <h1 className="text-3xl font-bold">
          {compCode && `${compCode} — `}Tabulator Entry
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter scores from paper score sheets on behalf of a judge
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline text-red-600"
          >
            Dismiss
          </button>
        </div>
      )}

      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Select Judge</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={selectedJudgeId}
            onChange={e => setSelectedJudgeId(e.target.value)}
            className="w-full max-w-md border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Choose a judge...</option>
            {judges.map(j => {
              const judgeSignedOff = round?.judge_sign_offs?.[j.id]
              return (
                <option key={j.id} value={j.id}>
                  {j.first_name} {j.last_name}
                  {judgeSignedOff ? ' (signed off)' : ''}
                </option>
              )
            })}
          </select>
          {selectedJudge && (
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="outline">
                Entering for: {selectedJudge.first_name} {selectedJudge.last_name}
              </Badge>
              <Badge variant="outline">
                Round {round?.round_number ?? '—'}
              </Badge>
              <Badge variant="outline">
                {scoredCount}/{totalDancers} scored
              </Badge>
              <Badge variant="secondary">Tabulator Mode</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {packetBlocked && selectedJudgeId && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-6 text-center">
            <p className="text-sm font-medium text-red-800">{packetBlocked}</p>
            <p className="text-xs text-red-600 mt-1">
              This judge has already started entering scores via their own device.
              One entry path per judge per round.
            </p>
          </CardContent>
        </Card>
      )}

      {signedOff && selectedJudgeId && !packetBlocked && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-feis-green">
              Scores signed off for {selectedJudge?.first_name} {selectedJudge?.last_name}.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Select another judge to continue, or go back to the competition.
            </p>
          </CardContent>
        </Card>
      )}

      {selectedJudgeId && !packetBlocked && !signedOff && (
        <>
          <div className="space-y-2">
            {registrations.map(reg => {
              const existing = scores.find(s => s.dancer_id === reg.dancer_id)
              return (
                <ScoreEntryForm
                  key={`${selectedJudgeId}-${reg.id}`}
                  dancerId={reg.dancer_id}
                  dancerName={`${reg.dancers?.first_name ?? ''} ${reg.dancers?.last_name ?? ''}`}
                  competitorNumber={reg.competitor_number}
                  existingScore={existing ? Number(existing.raw_score) : undefined}
                  existingFlagged={existing?.flagged ?? false}
                  existingFlagReason={existing?.flag_reason}
                  scoreMin={scoreMin}
                  scoreMax={scoreMax}
                  onSubmit={handleScoreSubmit}
                  locked={signedOff}
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
              : `Sign Off for ${selectedJudge?.first_name ?? 'Judge'}`}
          </Button>
        </>
      )}

      {!selectedJudgeId && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>Select a judge above to begin entering scores from their paper sheet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
