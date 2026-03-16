'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface DancerRow {
  dancerId: string
  firstName: string
  lastName: string
  school: string | null
  competitorNumber: string | null
  commentCount: number
}

export default function CommentsIndexPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const [dancers, setDancers] = useState<DancerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')

  async function loadData() {
    // 1. Load all dancers registered for this event with check-in info
    const { data: registrations, error: regErr } = await supabase
      .from('registrations')
      .select(
        'dancer_id, competitor_number, dancers(id, first_name, last_name, school_name)'
      )
      .eq('event_id', eventId)

    if (regErr) {
      console.error('Failed to load registrations:', regErr.message)
      setLoadError(true)
      setLoading(false)
      return
    }

    // 2. Load event_check_ins for competitor numbers (source of truth)
    const { data: checkIns, error: checkInErr } = await supabase
      .from('event_check_ins')
      .select('dancer_id, competitor_number')
      .eq('event_id', eventId)

    if (checkInErr) {
      console.error('Failed to load check-ins:', checkInErr.message)
      // Supplementary — falls back to registration competitor numbers
    }

    const checkInMap = new Map<string, string>()
    for (const ci of checkIns ?? []) {
      checkInMap.set(ci.dancer_id, ci.competitor_number)
    }

    // 3. Deduplicate dancers (a dancer may be in multiple competitions)
    const dancerMap = new Map<
      string,
      { firstName: string; lastName: string; school: string | null; competitorNumber: string | null }
    >()

    type RegRow = {
      dancer_id: string
      competitor_number: string | null
      dancers: { id: string; first_name: string; last_name: string; school_name: string | null }
    }

    for (const reg of (registrations as unknown as RegRow[]) ?? []) {
      const d = reg.dancers
      if (!d) continue
      if (dancerMap.has(d.id)) continue
      dancerMap.set(d.id, {
        firstName: d.first_name,
        lastName: d.last_name,
        school: d.school_name,
        competitorNumber: checkInMap.get(d.id) ?? reg.competitor_number ?? null,
      })
    }

    // 4. Load score_entries with comment data for all competitions in this event
    const { data: compIds, error: compErr } = await supabase
      .from('competitions')
      .select('id')
      .eq('event_id', eventId)

    if (compErr) {
      console.error('Failed to load competitions:', compErr.message)
      setLoadError(true)
      setLoading(false)
      return
    }

    const competitionIds = (compIds ?? []).map((c: { id: string }) => c.id)

    // Count comments per dancer
    const commentCounts = new Map<string, number>()

    if (competitionIds.length > 0) {
      const { data: scores, error: scoreErr } = await supabase
        .from('score_entries')
        .select('dancer_id, competition_id, comment_data, comments')
        .in('competition_id', competitionIds)

      if (scoreErr) {
        console.error('Failed to load score entries:', scoreErr.message)
        // Supplementary — comment counts will show 0 but page still works
      }

      type ScoreRow = {
        dancer_id: string
        competition_id: string
        comment_data: { codes: string[]; note: string | null } | null
        comments: string | null
      }

      // Count distinct competitions with comments per dancer
      for (const score of (scores as ScoreRow[] | null) ?? []) {
        const hasComment =
          (score.comment_data &&
            (score.comment_data.codes.length > 0 || score.comment_data.note)) ||
          (score.comments && score.comments.trim().length > 0)

        if (hasComment) {
          const key = `${score.dancer_id}:${score.competition_id}`
          // Use a set-like approach: track unique comp/dancer pairs
          if (!commentCounts.has(key)) {
            commentCounts.set(key, 1)
          }
        }
      }
    }

    // Aggregate comment counts per dancer
    const dancerCommentCounts = new Map<string, number>()
    for (const key of commentCounts.keys()) {
      const dancerId = key.split(':')[0]
      dancerCommentCounts.set(dancerId, (dancerCommentCounts.get(dancerId) ?? 0) + 1)
    }

    // 5. Build final list
    const rows: DancerRow[] = []
    for (const [dancerId, info] of dancerMap) {
      rows.push({
        dancerId,
        firstName: info.firstName,
        lastName: info.lastName,
        school: info.school,
        competitorNumber: info.competitorNumber,
        commentCount: dancerCommentCounts.get(dancerId) ?? 0,
      })
    }

    // Sort by competitor number (numeric), then by name
    rows.sort((a, b) => {
      const numA = a.competitorNumber ? parseInt(a.competitorNumber, 10) : Infinity
      const numB = b.competitorNumber ? parseInt(b.competitorNumber, 10) : Infinity
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB
      const nameA = `${a.lastName} ${a.firstName}`.toLowerCase()
      const nameB = `${b.lastName} ${b.firstName}`.toLowerCase()
      return nameA.localeCompare(nameB)
    })

    setDancers(rows)
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const filtered = search.trim()
    ? dancers.filter((d) => {
        const q = search.toLowerCase()
        return (
          d.firstName.toLowerCase().includes(q) ||
          d.lastName.toLowerCase().includes(q) ||
          `${d.firstName} ${d.lastName}`.toLowerCase().includes(q) ||
          (d.competitorNumber && d.competitorNumber.includes(q))
        )
      })
    : dancers

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  if (loadError) {
    return (
      <div className="p-3 rounded-md bg-feis-orange-light border border-feis-orange/20 text-feis-orange text-sm">
        Could not load comment sheets. Check your connection and try again.
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Comment Sheets</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search by name or number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4"
          />

          {filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {dancers.length === 0
                ? 'No dancers registered for this event yet.'
                : 'No dancers match your search.'}
            </p>
          ) : (
            <table className="feis-table w-full">
              <thead className="feis-thead">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">School</th>
                  <th className="text-right p-2">Comments</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.dancerId} className="border-t hover:bg-feis-green-light/30 transition-colors">
                    <td className="p-2 font-mono text-sm">
                      {d.competitorNumber ?? '—'}
                    </td>
                    <td className="p-2">
                      <Link
                        href={`/dashboard/events/${eventId}/comments/${d.dancerId}`}
                        className="text-feis-green hover:underline font-medium"
                      >
                        {d.firstName} {d.lastName}
                      </Link>
                    </td>
                    <td className="p-2 text-sm text-muted-foreground">
                      {d.school ?? '—'}
                    </td>
                    <td className="p-2 text-right font-mono text-sm">
                      {d.commentCount > 0 ? (
                        <span>{d.commentCount} comp{d.commentCount === 1 ? '' : 's'}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
