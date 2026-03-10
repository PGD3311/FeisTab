'use client'

import { useEffect, useState, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface CompetitionRow {
  id: string
  code: string | null
  name: string
  status: CompetitionStatus
  event_id: string
  results: [{ count: number }] | null
}

export default function ResultsPublishingPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([])
  const [loading, setLoading] = useState(true)

  async function loadData(): Promise<void> {
    const { data } = await supabase
      .from('competitions')
      .select('*, results(count)')
      .eq('event_id', eventId)
      .order('code')
    setCompetitions((data as CompetitionRow[] | null) ?? [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function handlePublish(compId: string, currentStatus: CompetitionStatus): Promise<void> {
    if (!canTransition(currentStatus, 'published')) return
    const now = new Date().toISOString()
    await supabase.from('results').update({ published_at: now }).eq('competition_id', compId)
    await supabase.from('competitions').update({ status: 'published' }).eq('id', compId)
    loadData()
  }

  async function handleUnpublish(compId: string, currentStatus: CompetitionStatus): Promise<void> {
    if (!canTransition(currentStatus, 'complete_unpublished')) return
    await supabase.from('results').update({ published_at: null }).eq('competition_id', compId)
    await supabase.from('competitions').update({ status: 'complete_unpublished' }).eq('id', compId)
    loadData()
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  const publishable = competitions.filter(c =>
    ['complete_unpublished'].includes(c.status) && (c.results?.[0]?.count ?? 0) > 0
  )
  const published = competitions.filter(c => c.status === 'published')

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Results Publishing</h1>

      <div className="flex items-center gap-4 mb-6">
        <span className="text-sm text-muted-foreground">
          Public results page:
        </span>
        <code className="text-sm bg-gray-100 px-2 py-1 rounded">
          /results/{eventId}
        </code>
      </div>

      {publishable.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Ready to Publish ({publishable.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {publishable.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 border rounded-md">
                <div>
                  <span className="font-medium">{c.code && `${c.code} — `}{c.name}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {c.results?.[0]?.count ?? 0} results
                  </span>
                </div>
                <Button size="sm" onClick={() => handlePublish(c.id, c.status)}>Publish</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {published.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Published ({published.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {published.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 border rounded-md">
                <div>
                  <span className="font-medium">{c.code && `${c.code} — `}{c.name}</span>
                  <CompetitionStatusBadge status={c.status} />
                </div>
                <Button size="sm" variant="outline" onClick={() => handleUnpublish(c.id, c.status)}>
                  Unpublish
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {publishable.length === 0 && published.length === 0 && (
        <p className="text-muted-foreground">No competitions with results yet.</p>
      )}
    </div>
  )
}
