'use client'

import { useEffect, useState, useMemo, use } from 'react'
import { logAudit } from '@/lib/audit'
import {
  getCheckInState,
  deriveCheckInStats,
  computeNextNumber,
  type CheckInRow,
} from '@/lib/check-in'
import { syncCompetitorNumberToRegistrations } from '@/lib/check-in-sync'
import { showSuccess, showCritical } from '@/lib/feedback'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

interface DancerWithRegistrations {
  dancer_id: string
  first_name: string
  last_name: string
  school_name: string | null
  registrations: {
    id: string
    competition_code: string | null
    competition_name: string
  }[]
}

export default function RegistrationDeskPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const [event, setEvent] = useState<{ id: string; name: string } | null>(null)
  const [dancers, setDancers] = useState<DancerWithRegistrations[]>([])
  const [checkInMap, setCheckInMap] = useState<Map<string, CheckInRow>>(new Map())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  async function loadData() {
    const [eventRes, regRes, checkInRes] = await Promise.all([
      supabase.from('events').select('id, name').eq('id', eventId).single(),
      supabase
        .from('registrations')
        .select('id, dancer_id, competition_id, dancers(id, first_name, last_name, school_name), competitions(id, code, name)')
        .eq('event_id', eventId)
        .order('dancer_id'),
      supabase
        .from('event_check_ins')
        .select('dancer_id, competitor_number, checked_in_at')
        .eq('event_id', eventId),
    ])

    if (eventRes.error) {
      console.error('Failed to load event:', eventRes.error.message)
      setLoading(false)
      return
    }
    if (regRes.error) {
      console.error('Failed to load registrations:', regRes.error.message)
      setLoading(false)
      return
    }

    setEvent(eventRes.data)

    const ciMap = new Map<string, CheckInRow>()
    for (const row of checkInRes.data ?? []) {
      ciMap.set(row.dancer_id, {
        competitor_number: row.competitor_number,
        checked_in_at: row.checked_in_at,
      })
    }
    setCheckInMap(ciMap)

    const dancerMap = new Map<string, DancerWithRegistrations>()
    for (const reg of regRes.data ?? []) {
      const dancer = reg.dancers as unknown as { id: string; first_name: string; last_name: string; school_name: string | null } | null
      const comp = reg.competitions as unknown as { id: string; code: string | null; name: string } | null
      if (!dancer || !comp) continue

      if (!dancerMap.has(dancer.id)) {
        dancerMap.set(dancer.id, {
          dancer_id: dancer.id,
          first_name: dancer.first_name,
          last_name: dancer.last_name,
          school_name: dancer.school_name,
          registrations: [],
        })
      }

      dancerMap.get(dancer.id)!.registrations.push({
        id: reg.id,
        competition_code: comp.code,
        competition_name: comp.name,
      })
    }

    const sorted = [...dancerMap.values()].sort((a, b) => {
      const lastCmp = a.last_name.localeCompare(b.last_name)
      if (lastCmp !== 0) return lastCmp
      return a.first_name.localeCompare(b.first_name)
    })

    setDancers(sorted)
    setLoading(false)
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const nextNumber = useMemo(() => {
    const existing = [...checkInMap.values()].map((r) => r.competitor_number)
    return computeNextNumber(existing)
  }, [checkInMap])

  const allDancerIds = useMemo(() => dancers.map((d) => d.dancer_id), [dancers])
  const stats = useMemo(() => deriveCheckInStats(allDancerIds, checkInMap), [allDancerIds, checkInMap])

  const filtered = useMemo(() => {
    if (!search.trim()) return dancers
    const q = search.toLowerCase()
    return dancers.filter(
      (d) =>
        d.first_name.toLowerCase().includes(q) ||
        d.last_name.toLowerCase().includes(q) ||
        (d.school_name && d.school_name.toLowerCase().includes(q))
    )
  }, [dancers, search])

  async function handleAssignAndCheckIn(dancer: DancerWithRegistrations) {
    setActing(dancer.dancer_id)
    const numberStr = String(nextNumber)

    try {
      const { error: insertErr } = await supabase
        .from('event_check_ins')
        .insert({
          event_id: eventId,
          dancer_id: dancer.dancer_id,
          competitor_number: numberStr,
          checked_in_at: new Date().toISOString(),
          checked_in_by: 'registration_desk',
        })

      if (insertErr) {
        showCritical('Failed to assign number', { description: insertErr.message })
        return
      }

      const syncResult = await syncCompetitorNumberToRegistrations(
        supabase, eventId, dancer.dancer_id, numberStr
      )
      if (syncResult.error) {
        showCritical('Number assigned but sync failed — retry', { description: syncResult.error.message })
        return
      }

      void logAudit(supabase, {
        userId: null,
        entityType: 'dancer',
        entityId: dancer.dancer_id,
        action: 'check_in',
        afterData: {
          competitor_number: numberStr,
          event_id: eventId,
          source: 'desk_assigned',
        },
      })

      setCheckInMap((prev) => {
        const next = new Map(prev)
        next.set(dancer.dancer_id, {
          competitor_number: numberStr,
          checked_in_at: new Date().toISOString(),
        })
        return next
      })

      showSuccess(`#${numberStr} assigned to ${dancer.first_name} ${dancer.last_name}`)
    } catch (err) {
      showCritical('Unexpected error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setActing(null)
    }
  }

  async function handleCheckIn(dancer: DancerWithRegistrations) {
    setActing(dancer.dancer_id)
    const checkInRow = checkInMap.get(dancer.dancer_id)
    if (!checkInRow) return

    try {
      const { error: updateErr } = await supabase
        .from('event_check_ins')
        .update({
          checked_in_at: new Date().toISOString(),
          checked_in_by: 'registration_desk',
        })
        .eq('event_id', eventId)
        .eq('dancer_id', dancer.dancer_id)

      if (updateErr) {
        showCritical('Failed to check in', { description: updateErr.message })
        return
      }

      const syncResult = await syncCompetitorNumberToRegistrations(
        supabase, eventId, dancer.dancer_id, checkInRow.competitor_number
      )
      if (syncResult.error) {
        showCritical('Checked in but sync failed — retry', { description: syncResult.error.message })
        return
      }

      void logAudit(supabase, {
        userId: null,
        entityType: 'dancer',
        entityId: dancer.dancer_id,
        action: 'check_in',
        afterData: {
          competitor_number: checkInRow.competitor_number,
          event_id: eventId,
          source: 'pre_assigned',
        },
      })

      setCheckInMap((prev) => {
        const next = new Map(prev)
        next.set(dancer.dancer_id, {
          ...checkInRow,
          checked_in_at: new Date().toISOString(),
        })
        return next
      })

      showSuccess(`${dancer.first_name} ${dancer.last_name} checked in`)
    } catch (err) {
      showCritical('Unexpected error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setActing(null)
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/dashboard/events/${eventId}`}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="h-3 w-3" /> Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold">Registration Desk</h1>
        {event && <p className="text-muted-foreground">{event.name}</p>}
      </div>

      <div className="flex gap-3 items-center">
        <input
          type="text"
          placeholder="Search by dancer name or school..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-4 py-3 text-lg shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="bg-feis-green-light text-feis-green px-4 py-3 rounded-md font-semibold text-sm whitespace-nowrap">
          Next #: <span className="font-mono text-lg">{nextNumber}</span>
        </div>
      </div>

      {filtered.length === 0 && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {search ? 'No dancers match your search.' : 'No dancers imported yet.'}
            </p>
          </CardContent>
        </Card>
      )}

      {filtered.map((dancer) => {
        const checkInRow = checkInMap.get(dancer.dancer_id) ?? null
        const state = getCheckInState(checkInRow)

        return (
          <Card
            key={dancer.dancer_id}
            className={`feis-card ${state === 'checked_in' ? 'border-feis-green/30' : ''}`}
          >
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-lg font-semibold">
                    {dancer.first_name} {dancer.last_name}
                  </div>
                  {dancer.school_name && (
                    <div className="text-sm text-muted-foreground">{dancer.school_name}</div>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {dancer.registrations.map((reg) => (
                      <Badge key={reg.id} variant="secondary" className="text-xs">
                        {reg.competition_code && `${reg.competition_code} — `}
                        {reg.competition_name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="shrink-0">
                  {state === 'checked_in' && checkInRow && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-lg bg-feis-green-light text-feis-green px-3 py-1 rounded-md">
                        #{checkInRow.competitor_number}
                      </span>
                      <CheckCircle2 className="h-5 w-5 text-feis-green" />
                    </div>
                  )}
                  {state === 'awaiting_arrival' && checkInRow && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-lg border border-muted-foreground/30 text-muted-foreground px-3 py-1 rounded-md">
                        #{checkInRow.competitor_number}
                      </span>
                      <Button
                        onClick={() => handleCheckIn(dancer)}
                        disabled={acting === dancer.dancer_id}
                        size="lg"
                      >
                        {acting === dancer.dancer_id ? 'Checking in...' : 'Check In'}
                      </Button>
                    </div>
                  )}
                  {state === 'needs_number' && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">
                        Needs Number
                      </Badge>
                      <Button
                        onClick={() => handleAssignAndCheckIn(dancer)}
                        disabled={acting === dancer.dancer_id}
                        size="lg"
                      >
                        {acting === dancer.dancer_id
                          ? 'Assigning...'
                          : `Assign #${nextNumber} & Check In`}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}

      <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-4">
        <div className="flex gap-4">
          <span><strong className="text-foreground">{stats.checkedIn}</strong> Checked In</span>
          <span><strong className="text-foreground">{stats.awaitingArrival}</strong> Awaiting Arrival</span>
          <span><strong className="text-foreground">{stats.needsNumber}</strong> Needs Number</span>
        </div>
        <span>
          Next: <strong className="font-mono text-foreground">#{nextNumber}</strong>
        </span>
      </div>
    </div>
  )
}
