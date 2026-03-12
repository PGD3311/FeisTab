import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ResultsTable } from '@/components/results-table'
import { Input } from '@/components/ui/input'

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

  const { data: event } = await supabase
    .from('events')
    .select('id, name, start_date, location')
    .eq('id', eventId)
    .single()

  if (!event) notFound()

  const { data: competitions } = await supabase
    .from('competitions')
    .select(`
      id, code, name, age_group, level,
      results(final_rank, calculated_payload, published_at, dancers(first_name, last_name))
    `)
    .eq('event_id', eventId)
    .eq('status', 'published')
    .order('code')

  interface NormalizedResult {
    final_rank: number
    calculated_payload: Record<string, unknown> | null
    published_at: string | null
    dancers: { first_name: string; last_name: string } | null
  }

  // Normalize dancers from Supabase array join to single object
  const normalized = competitions?.map(c => ({
    ...c,
    results: c.results?.map((r): NormalizedResult => ({
      final_rank: r.final_rank,
      calculated_payload: r.calculated_payload as NormalizedResult['calculated_payload'],
      published_at: r.published_at,
      dancers: Array.isArray(r.dancers) ? r.dancers[0] ?? null : r.dancers as NormalizedResult['dancers'],
    })),
  }))

  const filtered = q
    ? normalized?.filter(c => {
        const compMatch = c.name.toLowerCase().includes(q.toLowerCase()) ||
          c.code?.toLowerCase().includes(q.toLowerCase())
        const dancerMatch = c.results?.some((r: { dancers?: { first_name: string; last_name: string } | null }) =>
          `${r.dancers?.first_name} ${r.dancers?.last_name}`.toLowerCase().includes(q.toLowerCase())
        )
        return compMatch || dancerMatch
      })
    : normalized

  return (
    <div className="feis-bg-texture min-h-screen">
      <header className="bg-feis-green border-b border-feis-green-700">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-white">{event.name}</h1>
          <p className="text-sm text-white/70">
            {event.start_date} {event.location && `· ${event.location}`}
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <form className="mb-6">
          <Input
            name="q"
            placeholder="Search by dancer name or competition..."
            defaultValue={q}
            className="max-w-md"
          />
        </form>

        {(!filtered || filtered.length === 0) ? (
          <p className="text-muted-foreground">No published results yet.</p>
        ) : (
          <div className="space-y-6">
            {filtered.map(comp => {
              const sortedResults = [...(comp.results ?? [])].sort(
                (a, b) => a.final_rank - b.final_rank
              )
              return (
                <div key={comp.id}>
                  <h2 className="font-bold text-lg mb-1 text-feis-charcoal">
                    {comp.code && `${comp.code} — `}{comp.name}
                  </h2>
                  <p className="text-sm text-muted-foreground mb-2">
                    {comp.age_group} · {comp.level}
                  </p>
                  <ResultsTable results={sortedResults} />
                </div>
              )
            })}
          </div>
        )}

        <footer className="mt-12 pt-6 border-t text-center text-xs text-muted-foreground/40">
          Powered by FeisTab
        </footer>
      </main>
    </div>
  )
}
