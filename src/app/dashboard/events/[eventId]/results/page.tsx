'use client'

import { useEffect, useState, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { useEvent } from '@/contexts/event-context'
import { showSuccess, showError, showCritical } from '@/lib/feedback'
import { logAudit } from '@/lib/audit'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
import { ResultsTable } from '@/components/results-table'
import { ApprovalDialog, type ApprovalChecks } from '@/components/approval-dialog'
import { UnpublishDialog } from '@/components/unpublish-dialog'
import { publishResults, unpublishResults } from '@/lib/supabase/rpc'
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
  dancer_id?: string
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
  const { reload } = useEvent()
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [expandedCompId, setExpandedCompId] = useState<string | null>(null)
  const [expandedResults, setExpandedResults] = useState<ResultRow[]>([])
  const [loadingResults, setLoadingResults] = useState(false)
  const [expandError, setExpandError] = useState(false)
  const [approvalTarget, setApprovalTarget] = useState<{ id: string; code: string; name: string; status: CompetitionStatus } | null>(null)
  const [unpublishTarget, setUnpublishTarget] = useState<{ id: string; code: string; name: string; status: CompetitionStatus } | null>(null)

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
      .select('final_rank, calculated_payload, dancer_id, dancers(first_name, last_name)')
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
      dancer_id: (r as unknown as { dancer_id: string }).dancer_id,
      calculated_payload: r.calculated_payload as Record<string, unknown> | null,
      dancers: Array.isArray(r.dancers) ? r.dancers[0] ?? null : r.dancers as { first_name: string; last_name: string } | null,
    }))

    setExpandedResults(normalized)
    setLoadingResults(false)
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- initial data load

  async function handlePublish(
    compId: string,
    currentStatus: CompetitionStatus,
    approvedBy: string,
    checks: ApprovalChecks
  ): Promise<void> {
    try {
      if (!canTransition(currentStatus, 'published')) {
        showError('Cannot publish from current status')
        return
      }
      await publishResults(supabase, compId, approvedBy)

      await logAudit(supabase, {
        userId: null,
        entityType: 'competition',
        entityId: compId,
        action: 'result_publish',
        afterData: { approved_by: approvedBy, checks: { ...checks }, competition_id: compId },
      })
      showSuccess('Results published')
      loadData()
      void reload()
    } catch (err) {
      showCritical('Unexpected error publishing results', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function handleUnpublish(
    compId: string,
    currentStatus: CompetitionStatus,
    unpublishedBy: string,
    reason: string,
    note: string | null
  ): Promise<void> {
    try {
      if (!canTransition(currentStatus, 'complete_unpublished')) {
        showError('Cannot unpublish from current status')
        return
      }
      await unpublishResults(supabase, compId, unpublishedBy)

      await logAudit(supabase, {
        userId: null,
        entityType: 'competition',
        entityId: compId,
        action: 'result_unpublish',
        afterData: { unpublished_by: unpublishedBy, reason, note, competition_id: compId },
      })
      showSuccess('Results unpublished')
      loadData()
      void reload()
    } catch (err) {
      showCritical('Unexpected error unpublishing results', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  if (loadError) {
    return (
      <div className="p-3 rounded-md bg-feis-orange-light border border-feis-orange/20 text-feis-orange text-sm">
        Could not load results. Try refreshing.
      </div>
    )
  }

  const publishable = competitions.filter(c =>
    ['complete_unpublished'].includes(c.status) && (c.results?.[0]?.count ?? 0) > 0
  )
  const published = competitions.filter(c => c.status === 'published')
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
                className="text-sm text-feis-orange hover:text-feis-orange/80 py-2 cursor-pointer"
              >
                Failed to load results. Click to retry.
              </button>
            ) : (
              <ResultsTable results={expandedResults} eventId={eventId} />
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
              <Button size="sm" onClick={() => setApprovalTarget({ id: c.id, code: c.code ?? '', name: c.name, status: c.status })}>Publish</Button>
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
              <Button size="sm" variant="outline" onClick={() => setUnpublishTarget({ id: c.id, code: c.code ?? '', name: c.name, status: c.status })}>
                Unpublish
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {publishable.length === 0 && published.length === 0 && (
        <p className="text-muted-foreground">No competitions with results yet.</p>
      )}

      <ApprovalDialog
        open={!!approvalTarget}
        onOpenChange={(open) => { if (!open) setApprovalTarget(null) }}
        compCode={approvalTarget?.code ?? ''}
        compName={approvalTarget?.name ?? ''}
        onApprove={(approvedBy, checks) => {
          if (approvalTarget) handlePublish(approvalTarget.id, approvalTarget.status, approvedBy, checks)
          setApprovalTarget(null)
        }}
      />
      <UnpublishDialog
        open={!!unpublishTarget}
        onOpenChange={(open) => { if (!open) setUnpublishTarget(null) }}
        compCode={unpublishTarget?.code ?? ''}
        compName={unpublishTarget?.name ?? ''}
        onUnpublish={(unpublishedBy, reason, note) => {
          if (unpublishTarget) handleUnpublish(unpublishTarget.id, unpublishTarget.status, unpublishedBy, reason, note)
          setUnpublishTarget(null)
        }}
      />
    </div>
  )
}
