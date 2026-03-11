'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface JudgeSession {
  judge_id: string
  event_id: string
  name: string
}

export default function JudgeEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const router = useRouter()
  const [session, setSession] = useState<JudgeSession | null>(null)
  const [event, setEvent] = useState<any>(null)
  const [competitions, setCompetitions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('judge_session')
    if (!stored) {
      router.push('/judge')
      return
    }
    const parsed: JudgeSession = JSON.parse(stored)
    if (parsed.event_id !== eventId) {
      router.push('/judge')
      return
    }
    setSession(parsed)

    async function load() {
      const [eventRes, compRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('competitions').select('*').eq('event_id', eventId).order('code'),
      ])
      setEvent(eventRes.data)
      setCompetitions(compRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  function handleLogout() {
    localStorage.removeItem('judge_session')
    router.push('/judge')
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  const activeComps = competitions.filter(c =>
    ['in_progress', 'awaiting_scores'].includes(c.status)
  )
  const otherComps = competitions.filter(c =>
    !['in_progress', 'awaiting_scores'].includes(c.status)
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{event?.name}</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-feis-green">{session?.name}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Sign Out
        </Button>
      </div>

      {activeComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg">Ready to Score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeComps.map(comp => (
              <Link
                key={comp.id}
                href={`/judge/${eventId}/${comp.id}`}
                className="flex items-center justify-between p-4 rounded-md border border-feis-green/30 bg-feis-green-light/30 hover:bg-feis-green-light/60 transition-colors"
              >
                <div>
                  <span className="font-medium">{comp.code && `${comp.code} — `}{comp.name}</span>
                  <span className="ml-2 text-sm text-muted-foreground">{comp.age_group} · {comp.level}</span>
                </div>
                <Badge variant="default">Score Now</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {activeComps.length === 0 && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No competitions ready for scoring right now.</p>
            <p className="text-sm text-muted-foreground mt-1">Check back when the organizer opens a competition.</p>
          </CardContent>
        </Card>
      )}

      {otherComps.length > 0 && (
        <Card className="feis-card">
          <CardHeader>
            <CardTitle className="text-lg text-muted-foreground">Other Competitions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {otherComps.map(comp => (
              <div
                key={comp.id}
                className="flex items-center justify-between p-3 rounded-md border opacity-60"
              >
                <div>
                  <span className="font-medium">{comp.code && `${comp.code} — `}{comp.name}</span>
                  <span className="ml-2 text-sm text-muted-foreground">{comp.age_group} · {comp.level}</span>
                </div>
                <Badge variant="outline">{comp.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
