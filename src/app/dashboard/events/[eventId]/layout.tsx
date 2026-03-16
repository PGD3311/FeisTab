'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
import { EventProvider, type EventData, type CompetitionData } from '@/contexts/event-context'
import { EventTabs } from '@/components/event-tabs'
import { Badge } from '@/components/ui/badge'

export default function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const [event, setEvent] = useState<EventData | null>(null)
  const [competitions, setCompetitions] = useState<CompetitionData[]>([])
  const [loading, setLoading] = useState(true)
  const [compLoadError, setCompLoadError] = useState(false)

  async function loadData() {
    const [eventRes, compRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('competitions').select('*, registrations(count)').eq('event_id', eventId).order('code'),
    ])

    if (eventRes.error) {
      console.error('Failed to load event:', eventRes.error.message)
    }
    if (compRes.error) {
      console.error('Failed to load competitions:', compRes.error.message)
      setCompLoadError(true)
    } else {
      setCompLoadError(false)
    }

    setEvent(eventRes.data as EventData | null)
    setCompetitions((compRes.data as CompetitionData[] | null) ?? [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [eventId])

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>
  }

  if (!event) {
    return <p className="text-muted-foreground">Event not found.</p>
  }

  return (
    <EventProvider value={{ event, competitions, loading, reload: loadData }}>
      <div className="space-y-5">
        {/* Back nav */}
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Events
        </Link>

        {/* Event header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{event.name}</h1>
            <p className="text-muted-foreground text-sm">
              {event.start_date} {event.location && `· ${event.location}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/registration/${eventId}`}
              target="_blank"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-feis-green text-white font-semibold text-sm hover:bg-feis-green/90 transition-colors"
            >
              Registration Desk &#8599;
            </Link>
            <Badge variant={event.status === 'active' ? 'default' : 'secondary'}>
              {event.status}
            </Badge>
          </div>
        </div>

        {/* Segmented tab bar */}
        <EventTabs eventId={eventId} />

        {/* Tab content */}
        {compLoadError && (
          <div className="p-3 rounded-md bg-feis-orange-light border border-feis-orange/20 text-feis-orange text-sm">
            Could not load competitions.
          </div>
        )}
        <div>{children}</div>
      </div>
    </EventProvider>
  )
}
