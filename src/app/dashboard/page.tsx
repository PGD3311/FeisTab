'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { showSuccess, showError, showCritical } from '@/lib/feedback'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

interface Event {
  id: string
  name: string
  start_date: string
  location: string | null
  status: string
  registration_code: string | null
}

function getAuthorizedEventIds(): string[] {
  const ids: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('feistab_access_')) {
      ids.push(key.replace('feistab_access_', ''))
    }
  }
  return ids
}

export default function DashboardPage() {
  const supabase = useSupabase()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function loadEvents() {
    const authorizedIds = getAuthorizedEventIds()

    if (authorizedIds.length === 0) {
      setEvents([])
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('events')
      .select('id, name, start_date, location, status, registration_code')
      .in('id', authorizedIds)
      .order('start_date', { ascending: false })

    if (error) {
      console.error('Failed to load events:', error.message)
    }

    setEvents((data as Event[] | null) ?? [])
    setLoading(false)
  }

  useEffect(() => { loadEvents() }, []) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- initial data load

  async function handleJoin() {
    if (!joinCode.trim()) return
    setJoining(true)

    const { data, error } = await supabase
      .from('events')
      .select('id, registration_code')
      .eq('registration_code', joinCode.trim().toUpperCase())
      .maybeSingle()

    if (error || !data) {
      showError('No event found with that code')
      setJoining(false)
      return
    }

    localStorage.setItem(`feistab_access_${data.id}`, joinCode.trim().toUpperCase())
    setJoinCode('')
    showSuccess('Event added to your dashboard')
    await loadEvents()
    setJoining(false)
  }

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

    localStorage.removeItem(`feistab_access_${eventId}`)
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

      {/* Join existing event */}
      <div className="flex gap-2 mb-6">
        <Input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') handleJoin() }}
          placeholder="Enter event access code..."
          className="font-mono tracking-widest max-w-xs"
        />
        <Button
          variant="outline"
          onClick={handleJoin}
          disabled={!joinCode.trim() || joining}
        >
          {joining ? 'Joining...' : 'Join Event'}
        </Button>
      </div>

      {events.length === 0 ? (
        <Card className="feis-card">
          <CardContent className="py-12 text-center text-muted-foreground">
            No events yet. Create a new event or enter an access code to join one.
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
