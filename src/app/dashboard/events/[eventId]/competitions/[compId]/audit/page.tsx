'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import {
  formatAuditEntry,
  matchesFilter,
  sortAuditEntries,
  FILTER_GROUPS,
  type AuditEntry,
  type NameMaps,
} from '@/lib/audit-format'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const PAGE_SIZE = 25
const SCORE_ID_CHUNK = 100

interface JudgeRow {
  id: string
  first_name: string
  last_name: string
  user_id: string | null
}

interface RegistrationRow {
  dancer_id: string
  competitor_number: string | number | null
  dancers: { first_name: string; last_name: string } | null
}

interface EventRoleRow {
  user_id: string
  role: string
}

interface RoundRow {
  id: string
  round_number: number
}

interface ScoreEntryRow {
  id: string
  judge_id: string
  dancer_id: string
}

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
    const [compRes, judgesRes, regRes, rolesRes, roundsRes, scoresRes] = await Promise.all([
      supabase.from('competitions').select('code, name').eq('id', compId).single(),
      supabase.from('judges').select('id, first_name, last_name, user_id').eq('event_id', eventId),
      supabase
        .from('registrations')
        .select('dancer_id, competitor_number, dancers(first_name, last_name)')
        .eq('competition_id', compId),
      supabase.from('event_roles').select('user_id, role').eq('event_id', eventId),
      supabase.from('rounds').select('id, round_number').eq('competition_id', compId),
      supabase.from('score_entries').select('id, judge_id, dancer_id').eq('competition_id', compId)
    ])

    if (compRes.error) {
      console.error('Failed to load competition:', compRes.error.message)
      setLoading(false)
      return
    }

    for (const [label, res] of [
      ['judges', judgesRes],
      ['registrations', regRes],
      ['event roles', rolesRes],
      ['rounds', roundsRes],
      ['score entries', scoresRes]
    ] as const) {
      if (res.error) console.error(`Failed to load ${label}:`, res.error.message)
    }

    const judges = (judgesRes.data ?? []) as JudgeRow[]
    // Untyped client infers the dancers join as an array; it's many-to-one, so an object
    const registrations = (regRes.data ?? []) as unknown as RegistrationRow[]
    const roles = (rolesRes.data ?? []) as EventRoleRow[]
    const rounds = (roundsRes.data ?? []) as RoundRow[]
    const scoreEntries = (scoresRes.data ?? []) as ScoreEntryRow[]

    const rolesByUser = new Map<string, string[]>()
    for (const r of roles) {
      rolesByUser.set(r.user_id, [...(rolesByUser.get(r.user_id) ?? []), r.role])
    }

    setComp(compRes.data)
    setNameMaps({
      judges: new Map(judges.map((j) => [j.id, `${j.first_name} ${j.last_name}`])),
      dancers: new Map(
        registrations.map((r) => [
          r.dancer_id,
          r.dancers
            ? `${r.dancers.first_name} ${r.dancers.last_name} (#${r.competitor_number})`
            : r.dancer_id
        ])
      ),
      judgesByUser: new Map(
        judges
          .filter((j): j is JudgeRow & { user_id: string } => j.user_id !== null)
          .map((j) => [j.user_id, `${j.first_name} ${j.last_name}`])
      ),
      rolesByUser,
      rounds: new Map(rounds.map((r) => [r.id, r.round_number])),
      scoreEntries: new Map(
        scoreEntries.map((s) => [s.id, { judge_id: s.judge_id, dancer_id: s.dancer_id }])
      )
    })

    // Audit rows for this competition live under four keys:
    // the competition itself, payloads naming it, its rounds (sign-offs, recalls)
    // and its score entries (score RPCs). Score ids are chunked to keep URLs short.
    const roundIds = rounds.map((r) => r.id)
    const scoreIds = scoreEntries.map((s) => s.id)
    const scoreChunks: string[][] = []
    for (let i = 0; i < scoreIds.length; i += SCORE_ID_CHUNK) {
      scoreChunks.push(scoreIds.slice(i, i + SCORE_ID_CHUNK))
    }

    const auditQueries = [
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
      ...(roundIds.length > 0
        ? [
            supabase
              .from('audit_log')
              .select('*')
              .eq('entity_type', 'round')
              .in('entity_id', roundIds)
              .limit(1000)
          ]
        : []),
      ...scoreChunks.map((ids) =>
        supabase
          .from('audit_log')
          .select('*')
          .eq('entity_type', 'score_entry')
          .in('entity_id', ids)
          .limit(1000)
      )
    ]
    const auditResults = await Promise.all(auditQueries)

    const auditMap = new Map<string, AuditEntry>()
    for (const res of auditResults) {
      if (res.error) {
        console.error('Failed to load audit entries:', res.error.message)
        continue
      }
      for (const row of (res.data ?? []) as AuditEntry[]) {
        if (!auditMap.has(row.id)) auditMap.set(row.id, row)
      }
    }
    setEntries(sortAuditEntries([...auditMap.values()]))
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadData depends on supabase/params which are stable
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
