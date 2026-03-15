'use client'

import { useEffect, useState, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { showSuccess, showCritical } from '@/lib/feedback'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
import { ResultsTable } from '@/components/results-table'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { CopyLinkButton } from '@/components/copy-link-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronDown } from 'lucide-react'

interface CompetitionRow {
  id: string
  code: string | null
  name: string
  status: CompetitionStatus
  event_id: string
  results: [{ count: number }] | null
}

interface ResultRow {
  final_rank: number
  dancers: { first_name: string; last_name: string } | null
  calculated_payload: Record<string, unknown> | null
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
  const [loadError, setLoadError] = useState(false)
  const [expandedCompId, setExpandedCompId] = useState<string | null>(null)
  const [expandedResults, setExpandedResults] = useState<ResultRow[]>([])
  const [loadingResults, setLoadingResults] = useState(false)
  const [expandError, setExpandError] = useState(false)

  async function loadData(): Promise<void> {
    const { data, error } = await supabase
      .from('competitions')
      .select('*, results(count)')
      .eq('event_id', eventId)
      .order('code')
    if (error) {
      console.error('Failed to load competitions:', error.message)
      setLoadError(true)
      setLoading(false)
      return
    }
    setLoadError(false)
    setCompetitions((data as CompetitionRow[] | null) ?? [])
    setLoading(false)
  }

  async function loadResultsForComp(compId: string, retry?: boolean) {
    if (expandedCompId === compId && !retry) {
      setExpandedCompId(null)
      return
    }

    setLoadingResults(true)
    setExpandedCompId(compId)
    setExpandError(false)

    const { data, error } = await supabase
      .from('results')
      .select('final_rank, calculated_payload, dancers(first_name, last_name)')
      .eq('competition_id', compId)
      .order('final_rank')

    if (error) {
      console.error('Failed to load results:', error.message)
      setExpandError(true)
      setLoadingResults(false)
      return
    }

    const normalized = (data ?? []).map((r) => ({
      final_rank: r.final_rank,
      calculated_payload: r.calculated_payload as Record<string, unknown> | null,
      dancers: Array.isArray(r.dancers) ? r.dancers[0] ?? null : r.dancers as { first_name: string; last_name: string } | null,
    }))

    setExpandedResults(normalized)
    setLoadingResults(false)
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePublish(compId: string, currentStatus: CompetitionStatus): Promise<void> {
    if (!canTransition(currentStatus, 'published')) return
    const now = new Date().toISOString()
    const { error: pubErr } = await supabase.from('results').update({ published_at: now }).eq('competition_id', compId)
    if (pubErr) {
      showCritical('Failed to publish results', { description: pubErr.message })
      return
    }
    const { error: statusErr } = await supabase.from('competitions').update({ status: 'published' }).eq('id', compId)
    if (statusErr) {
      showCritical('Failed to publish results', { description: statusErr.message })
      return
    }
    showSuccess('Results published')
    loadData()
  }

  async function handleUnpublish(compId: string, currentStatus: CompetitionStatus): Promise<void> {
    if (!canTransition(currentStatus, 'complete_unpublished')) return
    const { error: pubErr } = await supabase.from('results').update({ published_at: null }).eq('competition_id', compId)
    if (pubErr) {
      showCritical('Failed to unpublish results', { description: pubErr.message })
      return
    }
    const { error: statusErr } = await supabase.from('competitions').update({ status: 'complete_unpublished' }).eq('id', compId)
    if (statusErr) {
      showCritical('Failed to unpublish results', { description: statusErr.message })
      return
    }
    showSuccess('Results unpublished')
    loadData()
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  if (loadError) {
    return (
      <div className="p-3 rounded-md bg-orange-50 border border-orange-200 text-orange-800 text-sm">
        Could not load results. Try refreshing.
      </div>
    )
  }

  const publishable = competitions.filter(c =>
    ['complete_unpublished'].includes(c.status) && (c.results?.[0]?.count ?? 0) > 0
  )
  const published = competitions.filter(c => c.status === 'published')
  const withResults = competitions.filter(c =>
    (c.status === 'published' || c.status === 'complete_unpublished') && (c.results?.[0]?.count ?? 0) > 0
  )

  function renderCompRow(c: CompetitionRow, action: React.ReactNode) {
    const isExpanded = expandedCompId === c.id
    const hasResults = (c.results?.[0]?.count ?? 0) > 0

    return (
      <div key={c.id}>
        <div className="flex items-center justify-between p-3 border rounded-md hover:bg-feis-green-light/30 transition-colors">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {hasResults && (
              <button
                type="button"
                onClick={() => loadResultsForComp(c.id)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
            <span
              className={`font-medium ${hasResults ? 'cursor-pointer hover:text-feis-green' : ''}`}
              onClick={() => hasResults && loadResultsForComp(c.id)}
            >
              {c.code && `${c.code} `}{c.name}
            </span>
            <span className="text-sm text-muted-foreground">
              {c.results?.[0]?.count ?? 0} results
            </span>
            <CompetitionStatusBadge status={c.status} />
          </div>
          <div className="shrink-0 ml-2">{action}</div>
        </div>
        {isExpanded && (
          <div className="mt-2 mb-4 ml-6">
            {loadingResults ? (
              <p className="text-sm text-muted-foreground py-2">Loading results...</p>
            ) : expandError ? (
              <button
                type="button"
                onClick={() => loadResultsForComp(c.id, true)}
                className="text-sm text-orange-600 hover:text-orange-800 py-2 cursor-pointer"
              >
                Failed to load results. Click to retry.
              </button>
            ) : (
              <ResultsTable results={expandedResults} />
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <span className="text-sm text-muted-foreground">Public results:</span>
        <code className="text-sm bg-feis-cream-dark px-2 py-1 rounded font-mono">
          /results/{eventId}
        </code>
        <CopyLinkButton url={`${typeof window !== 'undefined' ? window.location.origin : ''}/results/${eventId}`} />
        <a
          href={`/results/${eventId}`}
          target="_blank"
          className="text-xs text-feis-green hover:underline font-medium"
        >
          Open public page &#8599;
        </a>
      </div>

      {publishable.length > 0 && (
        <Card className="feis-card mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Ready to Publish ({publishable.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {publishable.map(c => renderCompRow(c,
              <Button size="sm" onClick={() => handlePublish(c.id, c.status)}>Publish</Button>
            ))}
          </CardContent>
        </Card>
      )}

      {published.length > 0 && (
        <Card className="feis-card mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Published ({published.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {published.map(c => renderCompRow(c,
              <Button size="sm" variant="outline" onClick={() => handleUnpublish(c.id, c.status)}>
                Unpublish
              </Button>
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
