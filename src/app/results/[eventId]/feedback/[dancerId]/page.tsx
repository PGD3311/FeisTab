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

interface FeedbackRow {
  comp_name: string
  final_rank: number | null
  judge_name: string
  comment_data: CommentData | null
}

export default async function PublicFeedbackPage({
  params,
}: {
  params: Promise<{ eventId: string; dancerId: string }>
}) {
  const { eventId, dancerId } = await params
  const supabase = await createClient()

  // Load dancer + event header info and feedback via narrow read function
  const [dancerRes, eventRes, feedbackRes] = await Promise.all([
    supabase.from('dancers').select('first_name, last_name').eq('id', dancerId).single(),
    supabase.from('events').select('id, name, start_date').eq('id', eventId).single(),
    supabase.rpc('public_feedback', { p_dancer_id: dancerId, p_event_id: eventId }),
  ])

  if (!dancerRes.data || !eventRes.data) notFound()

  const dancer = dancerRes.data
  const event = eventRes.data
  const feedbackRows = (feedbackRes.data ?? []) as FeedbackRow[]

  if (feedbackRows.length === 0) {
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

  // Build sections by competition from the flat feedback rows
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

  const sectionMap = new Map<string, CompSection>()

  for (const row of feedbackRows) {
    let section = sectionMap.get(row.comp_name)
    if (!section) {
      section = {
        comp: { code: null, name: row.comp_name },
        rank: row.final_rank,
        points: null,
        entries: [],
      }
      sectionMap.set(row.comp_name, section)
    }

    const cd = row.comment_data
    const hasContent = cd && (cd.codes.length > 0 || cd.note)
    if (hasContent) {
      section.entries.push({
        judgeName: row.judge_name ?? 'Judge',
        codes: cd?.codes ?? [],
        note: cd?.note ?? null,
        legacyComments: null,
      })
    }
  }

  const sections = [...sectionMap.values()]

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
