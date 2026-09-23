import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ResultsTable } from '@/components/results-table'
import { CopyLinkButton } from '@/components/copy-link-button'

export const dynamic = 'force-dynamic'

interface PublicEventResults {
  event: { id: string; name: string; start_date: string; location: string | null }
  competitions: {
    id: string
    code: string | null
    name: string
    age_group: string | null
    level: string | null
    results: {
      final_rank: number
      calculated_payload: Record<string, unknown> | null
      published_at: string | null
      dancer_id: string
      dancers: { id: string; first_name: string; last_name: string } | null
    }[]
  }[]
}

export default async function PublicResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const { eventId } = await params
  const { q } = await searchParams
  const supabase = await createClient()

  // Parents are usually not logged in: one narrow read function returns only
  // published competitions and dancer names (never dates of birth).
  const { data, error } = await supabase.rpc('public_event_results', { p_event_id: eventId })
  if (error) throw new Error(`Failed to load results: ${error.message}`)

  const payload = data as PublicEventResults | null
  if (!payload) notFound()

  const event = payload.event
  const competitions = payload.competitions

  const normalized = competitions

  const filtered = q
    ? normalized?.filter(c => {
        const compMatch = c.name.toLowerCase().includes(q.toLowerCase()) ||
          c.code?.toLowerCase().includes(q.toLowerCase())
        const dancerMatch = c.results?.some((r) =>
          `${r.dancers?.first_name} ${r.dancers?.last_name}`.toLowerCase().includes(q.toLowerCase())
        )
        return compMatch || dancerMatch
      })
    : normalized

  const totalComps = filtered?.length ?? 0
  const totalDancers = new Set(
    filtered?.flatMap(c => c.results?.map(r => r.dancer_id) ?? []) ?? []
  ).size

  return (
    <div className="min-h-screen bg-feis-cream">
      {/* Header */}
      <header className="bg-feis-green">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                {event.name}
              </h1>
              <p className="text-white/60 text-sm mt-1 font-mono">
                {event.start_date}
                {event.location && <span className="ml-2">{event.location}</span>}
              </p>
            </div>
            <CopyLinkButton className="text-white/60 hover:text-white text-xs font-mono uppercase tracking-wider transition-colors px-3 py-1.5 rounded border border-white/20 hover:border-white/40" />
          </div>
          <div className="flex gap-6 mt-4 text-white/50 text-xs font-mono uppercase tracking-widest">
            <span>{totalComps} competition{totalComps !== 1 ? 's' : ''}</span>
            <span>{totalDancers} dancer{totalDancers !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </header>

      {/* Search */}
      <div className="max-w-2xl mx-auto px-4 -mt-5">
        <form>
          <input
            name="q"
            placeholder="Search dancer or competition..."
            defaultValue={q}
            className="w-full px-4 py-3 rounded-lg border bg-card text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-feis-green/30 focus:border-feis-green/50"
          />
        </form>
      </div>

      {/* Results */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {(!filtered || filtered.length === 0) ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground/50 text-sm">
              {q ? 'No results match your search.' : 'No published results yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {filtered.map(comp => {
              const sortedResults = [...(comp.results ?? [])]
                .sort((a, b) => a.final_rank - b.final_rank)
                .filter((r) => r.final_rank <= 3)
              return (
                <section key={comp.id}>
                  <div className="flex items-baseline justify-between mb-3">
                    <div>
                      <h2 className="text-base font-semibold text-feis-charcoal">
                        {comp.code && (
                          <span className="font-mono text-feis-green/40 mr-1.5 text-sm">{comp.code}</span>
                        )}
                        {comp.name}
                      </h2>
                    </div>
                    <span className="text-xs text-muted-foreground/50 font-mono">
                      Top {sortedResults.length}
                    </span>
                  </div>
                  <ResultsTable
                    results={sortedResults}
                    publicMode
                  />
                </section>
              )
            })}
          </div>
        )}

        <footer className="mt-16 pb-8 text-center">
          <div className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/50 uppercase tracking-[0.2em] font-mono">
            <span className="w-1 h-1 rounded-full bg-feis-green/30" />
            FeisTab
          </div>
        </footer>
      </main>
    </div>
  )
}
