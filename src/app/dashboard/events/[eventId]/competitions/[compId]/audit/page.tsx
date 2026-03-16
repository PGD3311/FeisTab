'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import {
  formatAuditEntry,
  matchesFilter,
  FILTER_GROUPS,
  type AuditEntry,
  type NameMaps,
} from '@/lib/audit-format'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const PAGE_SIZE = 25

export default function AuditTrailPage({
  params,
}: {
  params: Promise<{ eventId: string; compId: string }>
}) {
  const { eventId, compId } = use(params)
  const supabase = useSupabase()
  const [comp, setComp] = useState<{ code: string | null; name: string } | null>(null)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [nameMaps, setNameMaps] = useState<NameMaps>({ judges: new Map(), dancers: new Map() })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function loadData() {
    const [compRes, judgesRes, regRes] = await Promise.all([
      supabase.from('competitions').select('code, name').eq('id', compId).single(),
      supabase.from('judges').select('id, first_name, last_name').eq('event_id', eventId),
      supabase
        .from('registrations')
        .select('dancer_id, competitor_number, dancers(first_name, last_name)')
        .eq('competition_id', compId),
    ])

    if (compRes.error) {
      console.error('Failed to load competition:', compRes.error.message)
      setLoading(false)
      return
    }

    if (judgesRes.error) {
      console.error('Failed to load judges:', judgesRes.error.message)
    }

    if (regRes.error) {
      console.error('Failed to load registrations:', regRes.error.message)
    }

    setComp(compRes.data)
    setNameMaps({
      judges: new Map(
        (judgesRes.data ?? []).map((j) => [j.id, `${j.first_name} ${j.last_name}`])
      ),
      dancers: new Map(
        // TODO: type when Supabase types generated
        (regRes.data ?? []).map((r: any) => [
          r.dancer_id,
          r.dancers
            ? `${r.dancers.first_name} ${r.dancers.last_name} (#${r.competitor_number})`
            : r.dancer_id,
        ])
      ),
    })

    // Fetch audit entries — two queries, deduplicate
    const [byEntity, byPayload] = await Promise.all([
      supabase
        .from('audit_log')
        .select('*')
        .eq('entity_id', compId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('audit_log')
        .select('*')
        .contains('after_data', { competition_id: compId })
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    if (byEntity.error) {
      console.error('Failed to load audit entries by entity:', byEntity.error.message)
    }
    if (byPayload.error) {
      console.error('Failed to load audit entries by payload:', byPayload.error.message)
    }

    const auditMap = new Map<string, AuditEntry>()
    for (const row of [...(byEntity.data ?? []), ...(byPayload.data ?? [])]) {
      if (!auditMap.has(row.id)) {
        auditMap.set(row.id, row as AuditEntry)
      }
    }
    const sorted = [...auditMap.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    setEntries(sorted)
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = entries.filter((e) => matchesFilter(e.action, filter))
  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  if (loading) return <p className="text-muted-foreground">Loading...</p>

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
          Audit Trail{comp ? ` — ${comp.code ? `${comp.code} ` : ''}${comp.name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Shows score entry, sign-off, correction, and publish history for this competition.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setVisibleCount(PAGE_SIZE)
          }}
          className="border rounded-md px-3 py-2 text-sm"
        >
          {FILTER_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {entries.length === 0
                ? 'No audit entries yet. Entries appear as scores are entered, sign-offs recorded, and actions taken.'
                : 'No entries match this filter.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="feis-card">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-feis-green">
                  <th className="px-4 py-3 font-semibold text-xs">Time</th>
                  <th className="px-4 py-3 font-semibold text-xs">Action</th>
                  <th className="px-4 py-3 font-semibold text-xs">Actor</th>
                  <th className="px-4 py-3 font-semibold text-xs">Details</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const formatted = formatAuditEntry(entry, nameMaps)
                  const isExpanded = expanded.has(entry.id)
                  return (
                    <tr
                      key={entry.id}
                      className={`border-b last:border-0 ${formatted.isCorrection ? 'bg-feis-orange-light' : ''}`}
                    >
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap align-top">
                        {new Date(entry.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                        <br />
                        {new Date(entry.created_at).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-medium ${formatted.badgeColor}`}
                        >
                          {formatted.badgeText}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs align-top">{formatted.actor}</td>
                      <td className="px-4 py-3 text-xs align-top">
                        <div>{formatted.summary}</div>
                        {formatted.hasRawData && (
                          <button
                            onClick={() => toggleExpanded(entry.id)}
                            className="text-xs text-muted-foreground hover:text-feis-green mt-1 underline"
                          >
                            {isExpanded ? 'Hide raw data' : 'View raw data'}
                          </button>
                        )}
                        {isExpanded && (
                          <pre className="mt-2 p-2 rounded bg-feis-cream border text-xs font-mono whitespace-pre-wrap break-all select-all">
                            {entry.before_data && (
                              <>
                                <span className="text-muted-foreground">before: </span>
                                {JSON.stringify(entry.before_data, null, 2)}
                                {'\n'}
                              </>
                            )}
                            <span className="text-muted-foreground">after: </span>
                            {JSON.stringify(entry.after_data, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {hasMore && (
        <div className="text-center">
          <Button variant="outline" onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}>
            Load more ({filtered.length - visibleCount} remaining)
          </Button>
        </div>
      )}
    </div>
  )
}
