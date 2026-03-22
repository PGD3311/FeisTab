import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { COMMENT_CODES } from '@/lib/comment-codes'

export const dynamic = 'force-dynamic'

function resolveCodeLabels(codes: string[]): string {
  const codeMap = new Map(COMMENT_CODES.map((c) => [c.code as string, c.label]))
  return codes.map((c) => codeMap.get(c) ?? c).join(' \u00b7 ')
}

interface CommentData {
  codes: string[]
  note: string | null
}

export default async function PublicFeedbackPage({
  params,
}: {
  params: Promise<{ eventId: string; dancerId: string }>
}) {
  const { eventId, dancerId } = await params
  const supabase = await createClient()

  // Load dancer, event, and competitor number
  const [dancerRes, eventRes, checkInRes] = await Promise.all([
    supabase.from('dancers').select('first_name, last_name').eq('id', dancerId).single(),
    supabase.from('events').select('id, name, start_date').eq('id', eventId).single(),
    supabase
      .from('event_check_ins')
      .select('competitor_number')
      .eq('event_id', eventId)
      .eq('dancer_id', dancerId)
      .maybeSingle(),
  ])

  if (!dancerRes.data || !eventRes.data) notFound()

  const dancer = dancerRes.data
  const event = eventRes.data
  const competitorNumber = (checkInRes.data as { competitor_number: string } | null)?.competitor_number ?? null

  // Load published competitions and this dancer's score entries with comments
  const { data: competitions } = await supabase
    .from('competitions')
    .select('id, code, name')
    .eq('event_id', eventId)
    .eq('status', 'published')
    .order('code')

  const compList = competitions ?? []
  const compIds = compList.map((c) => c.id)

  if (compIds.length === 0) {
    return (
      <div className="min-h-screen bg-feis-cream">
        <header className="bg-feis-green">
          <div className="max-w-2xl mx-auto px-4 py-8">
            <h1 className="text-2xl font-bold text-white">{dancer.first_name} {dancer.last_name}</h1>
            <p className="text-white/60 text-sm mt-1">{event.name}</p>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-8">
          <p className="text-muted-foreground">No published results yet.</p>
        </main>
      </div>
    )
  }

  // Load score entries with comments for this dancer
  const { data: scores } = await supabase
    .from('score_entries')
    .select('competition_id, judge_id, round_id, comment_data, comments')
    .eq('dancer_id', dancerId)
    .in('competition_id', compIds)

  // Load results for this dancer
  const { data: results } = await supabase
    .from('results')
    .select('competition_id, final_rank, calculated_payload')
    .eq('dancer_id', dancerId)
    .in('competition_id', compIds)

  // Load judges and rounds
  const judgeIds = [...new Set((scores ?? []).map((s) => s.judge_id))]
  const roundIds = [...new Set((scores ?? []).map((s) => s.round_id))]

  const [judgesRes] = await Promise.all([
    judgeIds.length > 0
      ? supabase.from('judges').select('id, first_name, last_name').in('id', judgeIds)
      : { data: [] },
    roundIds.length > 0
      ? supabase.from('rounds').select('id, round_number').in('id', roundIds)
      : { data: [] },
  ])

  const judgeMap = new Map(
    ((judgesRes.data ?? []) as Array<{ id: string; first_name: string; last_name: string }>).map(
      (j) => [j.id, `${j.first_name} ${j.last_name}`]
    )
  )
  const resultMap = new Map(
    (results ?? []).map((r) => [
      r.competition_id,
      { final_rank: r.final_rank, total_points: (r.calculated_payload as Record<string, unknown>)?.total_points as number | undefined },
    ])
  )

  // Build sections by competition
  interface FeedbackEntry {
    judgeName: string
    codes: string[]
    note: string | null
    legacyComments: string | null
  }

  interface CompSection {
    comp: { code: string | null; name: string }
    rank: number | null
    points: number | null
    entries: FeedbackEntry[]
  }

  const sections: CompSection[] = []

  for (const comp of compList) {
    const compScores = (scores ?? []).filter((s) => s.competition_id === comp.id)
    const result = resultMap.get(comp.id)

    const entries: FeedbackEntry[] = compScores
      .map((s) => {
        const cd = s.comment_data as CommentData | null
        const hasContent =
          (cd && (cd.codes.length > 0 || cd.note)) ||
          (s.comments && s.comments.trim().length > 0)
        if (!hasContent) return null
        return {
          judgeName: judgeMap.get(s.judge_id) ?? 'Judge',
          codes: cd?.codes ?? [],
          note: cd?.note ?? null,
          legacyComments: !cd ? s.comments : null,
        }
      })
      .filter((e): e is FeedbackEntry => e !== null)

    sections.push({
      comp: { code: comp.code, name: comp.name },
      rank: result?.final_rank ?? null,
      points: result?.total_points ?? null,
      entries,
    })
  }

  function ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
  }

  return (
    <div className="min-h-screen bg-feis-cream">
      <header className="bg-feis-green">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold text-white">
            {dancer.first_name} {dancer.last_name}
            {competitorNumber && (
              <span className="ml-2 text-white/50 font-mono">#{competitorNumber}</span>
            )}
          </h1>
          <p className="text-white/60 text-sm mt-1">{event.name} · {event.start_date}</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {sections.map((section, i) => (
          <div key={i} className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">
                {section.comp.code && (
                  <span className="font-mono text-feis-green/50 mr-1.5 text-sm">{section.comp.code}</span>
                )}
                {section.comp.name}
              </h2>
              {section.rank && (
                <span className={`font-mono font-bold ${
                  section.rank === 1 ? 'text-feis-gold' : section.rank <= 3 ? 'text-feis-green' : 'text-muted-foreground'
                }`}>
                  {ordinal(section.rank)}
                  {section.points != null && (
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      ({section.points} pts)
                    </span>
                  )}
                </span>
              )}
            </div>

            {section.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No feedback recorded.</p>
            ) : (
              <div className="space-y-2">
                {section.entries.map((entry, j) => (
                  <div key={j} className="pl-3 border-l-2 border-feis-green/20">
                    <p className="text-xs text-muted-foreground mb-0.5">{entry.judgeName}</p>
                    {entry.codes.length > 0 && (
                      <p className="text-sm">{resolveCodeLabels(entry.codes)}</p>
                    )}
                    {entry.note && (
                      <p className="text-sm italic text-muted-foreground">{entry.note}</p>
                    )}
                    {entry.legacyComments && (
                      <p className="text-sm text-muted-foreground">{entry.legacyComments}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        <Link
          href={`/results/${eventId}`}
          className="text-sm text-feis-green hover:underline inline-block"
        >
          &larr; Back to all results
        </Link>

        <footer className="pt-8 pb-4 text-center">
          <div className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/50 uppercase tracking-[0.2em] font-mono">
            <span className="w-1 h-1 rounded-full bg-feis-green/30" />
            FeisTab
          </div>
        </footer>
      </main>
    </div>
  )
}
