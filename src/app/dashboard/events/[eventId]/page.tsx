'use client'

import Link from 'next/link'
import { useEvent } from '@/contexts/event-context'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function EventOverviewPage() {
  const { event, competitions } = useEvent()

  if (!event) return null

  const eventId = event.id

  return (
    <Card className="feis-card">
      <CardHeader>
        <CardTitle className="text-lg">Competitions</CardTitle>
      </CardHeader>
      <CardContent>
        {competitions.length === 0 ? (
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
                <CompetitionStatusBadge status={comp.status} />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
