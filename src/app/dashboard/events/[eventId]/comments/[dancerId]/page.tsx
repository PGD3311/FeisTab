'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { COMMENT_CODES, type CommentData } from '@/lib/comment-codes'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'

interface ScoreEntry {
  id: string
  competition_id: string
  judge_id: string
  round_id: string
  comment_data: CommentData | null
  comments: string | null
}

interface Competition {
  id: string
  code: string | null
  name: string
}

interface Judge {
  id: string
  first_name: string
  last_name: string
}

interface Round {
  id: string
  round_number: number
  round_type: string
}

interface DancerInfo {
  first_name: string
  last_name: string
}

interface GroupedEntry {
  judge: Judge
  rounds: {
    round: Round
    commentData: CommentData | null
    legacyComments: string | null
  }[]
}

interface CompetitionSection {
  competition: Competition
  judges: GroupedEntry[]
}

function resolveCodeLabels(codes: string[]): string {
  const codeMap = new Map<string, string>(
    COMMENT_CODES.map((c) => [c.code, c.label])
  )
  return codes.map((c) => codeMap.get(c) ?? c).join(' \u00b7 ')
}

export default function DancerCommentSheetPage({
  params,
}: {
  params: Promise<{ eventId: string; dancerId: string }>
}) {
  const { eventId, dancerId } = use(params)
  const supabase = useSupabase()
  const [dancer, setDancer] = useState<DancerInfo | null>(null)
  const [eventName, setEventName] = useState('')
  const [competitorNumber, setCompetitorNumber] = useState<string | null>(null)
  const [sections, setSections] = useState<CompetitionSection[]>([])
  const [loading, setLoading] = useState(true)

  async function loadData() {
    // Load dancer info, event info, and check-in in parallel
    const [dancerRes, eventRes, checkInRes] = await Promise.all([
      supabase.from('dancers').select('first_name, last_name').eq('id', dancerId).single(),
      supabase.from('events').select('name').eq('id', eventId).single(),
      supabase
        .from('event_check_ins')
        .select('competitor_number')
        .eq('event_id', eventId)
        .eq('dancer_id', dancerId)
        .maybeSingle(),
    ])

    if (dancerRes.error) {
      console.error('Failed to load dancer:', dancerRes.error.message)
      setLoading(false)
      return
    }

    if (eventRes.error) {
      console.error('Failed to load event:', eventRes.error.message)
    }

    setDancer(dancerRes.data as DancerInfo)
    setEventName((eventRes.data as { name: string } | null)?.name ?? '')

    // Competitor number: check-in first, fallback to registration
    let compNum = (checkInRes.data as { competitor_number: string } | null)?.competitor_number ?? null
    if (!compNum) {
      const { data: regData } = await supabase
        .from('registrations')
        .select('competitor_number')
        .eq('event_id', eventId)
        .eq('dancer_id', dancerId)
        .not('competitor_number', 'is', null)
        .limit(1)

      type RegRow = { competitor_number: string | null }
      const rows = regData as RegRow[] | null
      if (rows && rows.length > 0 && rows[0].competitor_number) {
        compNum = rows[0].competitor_number
      }
    }
    setCompetitorNumber(compNum)

    // Load competitions for this event
    const { data: competitions, error: compErr } = await supabase
      .from('competitions')
      .select('id, code, name')
      .eq('event_id', eventId)
      .order('code')

    if (compErr) {
      console.error('Failed to load competitions:', compErr.message)
      setLoading(false)
      return
    }

    const compList = (competitions as Competition[] | null) ?? []
    const compIds = compList.map((c) => c.id)

    if (compIds.length === 0) {
      setSections([])
      setLoading(false)
      return
    }

    // Load all score_entries for this dancer across all competitions
    const { data: scores, error: scoreErr } = await supabase
      .from('score_entries')
      .select('id, competition_id, judge_id, round_id, comment_data, comments')
      .eq('dancer_id', dancerId)
      .in('competition_id', compIds)

    if (scoreErr) {
      console.error('Failed to load score entries:', scoreErr.message)
      setLoading(false)
      return
    }

    const scoreEntries = (scores as ScoreEntry[] | null) ?? []

    // Collect unique judge IDs and round IDs
    const judgeIds = [...new Set(scoreEntries.map((s) => s.judge_id))]
    const roundIds = [...new Set(scoreEntries.map((s) => s.round_id))]

    // Load judges and rounds
    let judgeMap = new Map<string, Judge>()
    let roundMap = new Map<string, Round>()

    if (judgeIds.length > 0) {
      const { data: judges, error: judgeErr } = await supabase
        .from('judges')
        .select('id, first_name, last_name')
        .in('id', judgeIds)

      if (judgeErr) {
        console.error('Failed to load judges:', judgeErr.message)
      }
      for (const j of (judges as Judge[] | null) ?? []) {
        judgeMap.set(j.id, j)
      }
    }

    if (roundIds.length > 0) {
      const { data: rounds, error: roundErr } = await supabase
        .from('rounds')
        .select('id, round_number, round_type')
        .in('id', roundIds)

      if (roundErr) {
        console.error('Failed to load rounds:', roundErr.message)
      }
      for (const r of (rounds as Round[] | null) ?? []) {
        roundMap.set(r.id, r)
      }
    }

    // Group by competition, then by judge
    const compMap = new Map<string, Competition>()
    for (const c of compList) {
      compMap.set(c.id, c)
    }

    const sectionMap = new Map<string, Map<string, { round: Round; commentData: CommentData | null; legacyComments: string | null }[]>>()

    for (const entry of scoreEntries) {
      if (!sectionMap.has(entry.competition_id)) {
        sectionMap.set(entry.competition_id, new Map())
      }
      const judgeGroup = sectionMap.get(entry.competition_id)!
      if (!judgeGroup.has(entry.judge_id)) {
        judgeGroup.set(entry.judge_id, [])
      }

      const round = roundMap.get(entry.round_id) ?? {
        id: entry.round_id,
        round_number: 1,
        round_type: 'standard',
      }

      judgeGroup.get(entry.judge_id)!.push({
        round,
        commentData: entry.comment_data,
        legacyComments: entry.comments,
      })
    }

    // Build sections — only include competitions that have score entries
    const builtSections: CompetitionSection[] = []

    for (const [compId, judgeGroup] of sectionMap) {
      const comp = compMap.get(compId)
      if (!comp) continue

      const judges: GroupedEntry[] = []
      for (const [judgeId, rounds] of judgeGroup) {
        const judge = judgeMap.get(judgeId) ?? {
          id: judgeId,
          first_name: 'Unknown',
          last_name: 'Judge',
        }
        // Sort rounds by round_number
        rounds.sort((a, b) => a.round.round_number - b.round.round_number)
        judges.push({ judge, rounds })
      }

      // Sort judges by name
      judges.sort((a, b) =>
        `${a.judge.last_name} ${a.judge.first_name}`.localeCompare(
          `${b.judge.last_name} ${b.judge.first_name}`
        )
      )

      builtSections.push({ competition: comp, judges })
    }

    // Sort sections by competition code
    builtSections.sort((a, b) => {
      const codeA = a.competition.code ?? ''
      const codeB = b.competition.code ?? ''
      const numA = parseInt(codeA, 10)
      const numB = parseInt(codeB, 10)
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB
      return codeA.localeCompare(codeB)
    })

    setSections(builtSections)
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  if (!dancer) {
    return <p className="text-muted-foreground">Dancer not found.</p>
  }

  const hasAnyComments = sections.some((s) =>
    s.judges.some((j) =>
      j.rounds.some(
        (r) =>
          (r.commentData && (r.commentData.codes.length > 0 || r.commentData.note)) ||
          (r.legacyComments && r.legacyComments.trim().length > 0)
      )
    )
  )

  return (
    <div className="max-w-3xl">
      {/* Header — hidden on print */}
      <div className="print:hidden mb-4">
        <Link
          href={`/dashboard/events/${eventId}/comments`}
          className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Comments
        </Link>
      </div>

      {/* Dancer info — visible on screen and print */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold">
          {dancer.first_name} {dancer.last_name}
        </h2>
        <p className="text-muted-foreground text-sm">
          {competitorNumber ? `#${competitorNumber}` : 'No competitor number'}
          {eventName && ` \u00b7 ${eventName}`}
        </p>
      </div>

      {/* Print button */}
      <div className="print:hidden mb-6">
        <Button variant="outline" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      {/* Comment sections */}
      {!hasAnyComments ? (
        <p className="text-muted-foreground">No feedback recorded for this dancer yet.</p>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => {
            const sectionHasComments = section.judges.some((j) =>
              j.rounds.some(
                (r) =>
                  (r.commentData && (r.commentData.codes.length > 0 || r.commentData.note)) ||
                  (r.legacyComments && r.legacyComments.trim().length > 0)
              )
            )
            if (!sectionHasComments) return null

            return (
              <div key={section.competition.id} className="border rounded-md p-4">
                <h3 className="font-semibold text-lg mb-3">
                  {section.competition.code && (
                    <span className="font-mono mr-2">{section.competition.code}</span>
                  )}
                  {section.competition.name}
                </h3>

                <div className="space-y-3">
                  {section.judges.map((judgeEntry) => (
                    <div key={judgeEntry.judge.id} className="pl-3 border-l-2 border-feis-green/20">
                      <p className="font-medium text-sm mb-1">
                        {judgeEntry.judge.first_name} {judgeEntry.judge.last_name}
                      </p>

                      {judgeEntry.rounds.map((roundEntry, idx) => {
                        const hasStructured =
                          roundEntry.commentData &&
                          (roundEntry.commentData.codes.length > 0 || roundEntry.commentData.note)
                        const hasLegacy =
                          roundEntry.legacyComments && roundEntry.legacyComments.trim().length > 0

                        if (!hasStructured && !hasLegacy) {
                          return (
                            <p key={idx} className="text-sm text-muted-foreground ml-2">
                              {judgeEntry.rounds.length > 1 && (
                                <span className="font-mono text-xs mr-1">
                                  R{roundEntry.round.round_number}
                                  {roundEntry.round.round_type === 'recall' ? ' (Recall)' : ''}:
                                </span>
                              )}
                              No comments recorded
                            </p>
                          )
                        }

                        return (
                          <div key={idx} className="ml-2 mb-1">
                            {judgeEntry.rounds.length > 1 && (
                              <span className="font-mono text-xs text-muted-foreground mr-1">
                                R{roundEntry.round.round_number}
                                {roundEntry.round.round_type === 'recall' ? ' (Recall)' : ''}:
                              </span>
                            )}

                            {hasStructured && roundEntry.commentData && (
                              <>
                                {roundEntry.commentData.codes.length > 0 && (
                                  <p className="text-sm">
                                    {resolveCodeLabels(roundEntry.commentData.codes)}
                                  </p>
                                )}
                                {roundEntry.commentData.note && (
                                  <p className="text-sm text-muted-foreground italic">
                                    {roundEntry.commentData.note}
                                  </p>
                                )}
                              </>
                            )}

                            {!hasStructured && hasLegacy && (
                              <p className="text-sm text-muted-foreground">
                                Note: {roundEntry.legacyComments}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
