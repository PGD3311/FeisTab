'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { showSuccess, showCritical } from '@/lib/feedback'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Event {
  id: string
  name: string
  start_date: string
  location: string | null
  status: string
  registration_code: string | null
}

export default function DashboardPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function loadEvents() {
    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.push('/auth/login?next=/dashboard')
      return
    }

    // Query event_roles for organizer events
    const { data: roleRows, error: roleErr } = await supabase
      .from('event_roles')
      .select('event_id')
      .eq('user_id', user.id)
      .eq('role', 'organizer')

    if (roleErr) {
      console.error('Failed to load event roles:', roleErr.message)
      setEvents([])
      setLoading(false)
      return
    }

    const eventIds = (roleRows ?? []).map((r: { event_id: string }) => r.event_id)

    if (eventIds.length === 0) {
      setEvents([])
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('events')
      .select('id, name, start_date, location, status, registration_code')
      .in('id', eventIds)
      .order('start_date', { ascending: false })

    if (error) {
      console.error('Failed to load events:', error.message)
    }

    setEvents((data as Event[] | null) ?? [])
    setLoading(false)
  }

  useEffect(() => { loadEvents() }, []) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- initial data load

  async function handleDelete(eventId: string, eventName: string) {
    if (!confirm(`Delete "${eventName}"? This removes all competitions, scores, and results. This cannot be undone.`)) {
      return
    }
    setDeleting(eventId)

    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId)

    if (error) {
      showCritical('Failed to delete event', { description: error.message })
      setDeleting(null)
      return
    }

    showSuccess('Event deleted')
    await loadEvents()
    setDeleting(null)
  }

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Events</h1>
        <Link href="/dashboard/events/new">
          <Button>Create Event</Button>
        </Link>
      </div>

      {events.length === 0 ? (
        <Card className="feis-card">
          <CardContent className="py-12 text-center text-muted-foreground">
            No events yet. Create a new event to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {events.map(event => (
            <Card key={event.id} className="feis-card">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Link href={`/dashboard/events/${event.id}`} className="flex-1">
                    <CardTitle className="text-lg hover:text-feis-green transition-colors cursor-pointer">
                      {event.name}
                    </CardTitle>
                  </Link>
                  <div className="flex items-center gap-2">
                    <Badge variant={event.status === 'active' ? 'default' : 'secondary'}>
                      {event.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(event.id, event.name)}
                      disabled={deleting === event.id}
                    >
                      {deleting === event.id ? '...' : 'Delete'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Link href={`/dashboard/events/${event.id}`}>
                  <p className="text-sm text-muted-foreground">
                    {event.start_date} {event.location && `· ${event.location}`}
                  </p>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
