import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const supabase = await createClient()

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single()

  if (!event) notFound()

  const { data: competitions } = await supabase
    .from('competitions')
    .select('*, registrations(count)')
    .eq('event_id', eventId)
    .order('code')

  const { data: stages } = await supabase
    .from('stages')
    .select('*')
    .eq('event_id', eventId)
    .order('display_order')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">{event.name}</h1>
          <p className="text-muted-foreground text-sm">
            {event.start_date} {event.location && `· ${event.location}`}
          </p>
        </div>
        <Badge variant={event.status === 'active' ? 'default' : 'secondary'}>
          {event.status}
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card className="feis-card">
          <CardContent className="pt-4 pb-4">
            <p className="feis-stat">{competitions?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Competitions</p>
          </CardContent>
        </Card>
        <Card className="feis-card">
          <CardContent className="pt-4 pb-4">
            <p className="feis-stat">{stages?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Stages</p>
          </CardContent>
        </Card>
        <Card className="feis-card">
          <CardContent className="pt-4 pb-4">
            <p className="feis-stat">
              {competitions?.filter(c => c.status === 'published').length ?? 0}
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Published</p>
          </CardContent>
        </Card>
        <Card className="feis-card">
          <CardContent className="pt-4 pb-4">
            <p className="feis-stat">
              {competitions?.filter(c => !['published', 'locked', 'draft'].includes(c.status)).length ?? 0}
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">In Progress</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3 mb-6">
        <Link href={`/dashboard/events/${eventId}/import`}>
          <Button variant="default">Import Registrations</Button>
        </Link>
        <Link href={`/dashboard/events/${eventId}/competitions`}>
          <Button variant="outline">Competition Control</Button>
        </Link>
        <Link href={`/dashboard/events/${eventId}/stages`}>
          <Button variant="outline">Stage Manager</Button>
        </Link>
        <Link href={`/dashboard/events/${eventId}/results`}>
          <Button variant="outline">Results</Button>
        </Link>
      </div>

      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Competitions</CardTitle>
        </CardHeader>
        <CardContent>
          {(!competitions || competitions.length === 0) ? (
            <p className="text-muted-foreground text-sm">
              No competitions yet. Import registrations to create competitions automatically.
            </p>
          ) : (
            <div className="space-y-2">
              {competitions.map(comp => (
                <Link
                  key={comp.id}
                  href={`/dashboard/events/${eventId}/competitions/${comp.id}`}
                  className="flex items-center justify-between p-3 rounded-md border hover:bg-feis-green-light/50 transition-colors"
                >
                  <div>
                    <span className="font-medium">{comp.code && `${comp.code} — `}{comp.name}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {comp.age_group} · {comp.level}
                    </span>
                  </div>
                  <Badge variant="outline">{comp.status}</Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
