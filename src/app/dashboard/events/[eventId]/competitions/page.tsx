import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'

export default async function CompetitionsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const supabase = await createClient()

  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', eventId)
    .single()

  if (!event) notFound()

  const { data: competitions } = await supabase
    .from('competitions')
    .select(`
      *,
      registrations(count),
      rounds(
        id,
        round_number,
        status,
        score_entries(count)
      )
    `)
    .eq('event_id', eventId)
    .order('code')

  return (
    <div className="feis-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="feis-thead">
          <tr>
            <th className="text-left font-medium">Code</th>
            <th className="text-left font-medium">Competition</th>
            <th className="text-left font-medium">Age/Level</th>
            <th className="text-center font-medium">Dancers</th>
            <th className="text-center font-medium">Scores</th>
            <th className="text-center font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="feis-tbody">
          {competitions?.map((comp) => {
            const totalScores =
              comp.rounds?.reduce(
                (sum: number, r: { score_entries: { count: number }[] }) =>
                  sum + (r.score_entries?.[0]?.count ?? 0),
                0
              ) ?? 0

            return (
              <tr key={comp.id} className="border-t">
                <td className="px-4 py-3 font-mono text-xs text-feis-green/70">{comp.code}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/events/${eventId}/competitions/${comp.id}`}
                    className="font-medium text-feis-green hover:underline"
                  >
                    {comp.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {comp.age_group} · {comp.level}
                </td>
                <td className="px-4 py-3 text-center">
                  {comp.registrations?.[0]?.count ?? 0}
                </td>
                <td className="px-4 py-3 text-center">{totalScores}</td>
                <td className="px-4 py-3 text-center">
                  <CompetitionStatusBadge status={comp.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
