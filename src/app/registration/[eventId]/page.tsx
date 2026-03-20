'use client'

import { useEffect, useState, useMemo, useRef, useCallback, use } from 'react'
import { logAudit } from '@/lib/audit'
import {
  getCheckInState,
  deriveCheckInStats,
  computeNextNumber,
  type CheckInRow,
} from '@/lib/check-in'
import { syncCompetitorNumberToRegistrations } from '@/lib/check-in-sync'
import { showSuccess, showError, showCritical } from '@/lib/feedback'
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
  date_of_birth: string | null
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
    const [eventRes, checkInRes] = await Promise.all([
      supabase.from('events').select('id, name').eq('id', eventId).single(),
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
    if (checkInRes.error) {
      console.error('Failed to load check-ins:', checkInRes.error.message)
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

    // Step 1: Get unique dancer IDs for this event (light query — just IDs)
    const { data: regRows, error: regErr } = await supabase
      .from('registrations')
      .select('dancer_id')
      .eq('event_id', eventId)
      .limit(10000)

    if (regErr) {
      console.error('Failed to load registrations:', regErr.message)
      setLoading(false)
      return
    }

    const uniqueIds = [...new Set((regRows ?? []).map((r: { dancer_id: string }) => r.dancer_id))]

    if (uniqueIds.length === 0) {
      setDancers([])
      setLoading(false)
      return
    }

    // Step 2: Load dancer details in chunks (Supabase .in() has URL length limits)
    const CHUNK_SIZE = 100
    const allDancerRows: Array<{ id: string; first_name: string; last_name: string; school_name: string | null; date_of_birth: string | null }> = []

    for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + CHUNK_SIZE)
      const { data: dancerRows, error: dancerErr } = await supabase
        .from('dancers')
        .select('id, first_name, last_name, school_name, date_of_birth')
        .in('id', chunk)

      if (dancerErr) {
        console.error('Failed to load dancers chunk:', dancerErr.message)
        continue
      }
      for (const row of dancerRows ?? []) {
        allDancerRows.push(row as typeof allDancerRows[number])
      }
    }

    const sorted = allDancerRows
      .map((d: { id: string; first_name: string; last_name: string; school_name: string | null; date_of_birth: string | null }) => ({
        dancer_id: d.id,
        first_name: d.first_name,
        last_name: d.last_name,
        school_name: d.school_name,
        date_of_birth: d.date_of_birth,
        registrations: [],
      }))
      .sort((a: DancerWithRegistrations, b: DancerWithRegistrations) => {
        const lastCmp = a.last_name.localeCompare(b.last_name)
        if (lastCmp !== 0) return lastCmp
        return a.first_name.localeCompare(b.first_name)
      })

    setDancers(sorted)
    setLoading(false)
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Live sync: re-fetch check-ins when another device assigns a number
  const refreshCheckIns = useCallback(async () => {
    const { data, error } = await supabase
      .from('event_check_ins')
      .select('dancer_id, competitor_number, checked_in_at')
      .eq('event_id', eventId)
    if (error) return
    const map = new Map<string, CheckInRow>()
    for (const row of data ?? []) {
      map.set(row.dancer_id, {
        competitor_number: row.competitor_number,
        checked_in_at: row.checked_in_at,
      })
    }
    setCheckInMap(map)
  }, [supabase, eventId])

  // Realtime: instant update when any device assigns a number
  useEffect(() => {
    if (loading) return
    const channel = supabase
      .channel('reg-desk-checkins')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_check_ins' }, () => {
        void refreshCheckIns()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loading, supabase, refreshCheckIns])

  // Polling fallback: 5s interval, visibility-aware
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (loading) return
    function startPolling() {
      if (pollTimerRef.current) return
      pollTimerRef.current = setInterval(() => { void refreshCheckIns() }, 5000)
    }
    function stopPolling() {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    }
    function handleVis() {
      if (document.hidden) { stopPolling() } else { void refreshCheckIns(); startPolling() }
    }
    startPolling()
    document.addEventListener('visibilitychange', handleVis)
    return () => { stopPolling(); document.removeEventListener('visibilitychange', handleVis) }
  }, [loading, refreshCheckIns])

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
        `${d.first_name} ${d.last_name}`.toLowerCase().includes(q) ||
        (d.school_name && d.school_name.toLowerCase().includes(q))
    )
  }, [dancers, search])

  async function handleAssignAndCheckIn(dancer: DancerWithRegistrations) {
    setActing(dancer.dancer_id)

    try {
      // Collision-safe: retry with next number if unique constraint fails
      const MAX_RETRIES = 3
      let assignedNumber: string | null = null

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // Re-fetch latest check-ins to get the freshest nextNumber
        if (attempt > 0) {
          await refreshCheckIns()
        }

        // Compute number from current state
        const existing = [...checkInMap.values()].map((r) => r.competitor_number)
        const tryNumber = String(computeNextNumber(existing) + attempt)

        const { error: insertErr } = await supabase
          .from('event_check_ins')
          .insert({
            event_id: eventId,
            dancer_id: dancer.dancer_id,
            competitor_number: tryNumber,
            checked_in_at: new Date().toISOString(),
            checked_in_by: 'registration_desk',
          })

        if (!insertErr) {
          assignedNumber = tryNumber
          break
        }

        // If it's a unique constraint violation, retry with next number
        if (insertErr.code === '23505') {
          continue
        }

        // Any other error — stop retrying
        showCritical('Failed to assign number', { description: insertErr.message })
        return
      }

      if (!assignedNumber) {
        showCritical('Number conflict — refresh and try again')
        await refreshCheckIns()
        return
      }

      const syncResult = await syncCompetitorNumberToRegistrations(
        supabase, eventId, dancer.dancer_id, assignedNumber
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
          competitor_number: assignedNumber,
          event_id: eventId,
          source: 'desk_assigned',
        },
      })

      setCheckInMap((prev) => {
        const next = new Map(prev)
        next.set(dancer.dancer_id, {
          competitor_number: assignedNumber!,
          checked_in_at: new Date().toISOString(),
        })
        return next
      })

      showSuccess(`#${assignedNumber} assigned to ${dancer.first_name} ${dancer.last_name}`)
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
    if (!checkInRow) {
      setActing(null)
      return
    }

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
          <ArrowLeft className="h-3 w-3" /> Dashboard
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
                    {dancer.date_of_birth && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        age {Math.floor((Date.now() - new Date(dancer.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))}
                      </span>
                    )}
                  </div>
                  {dancer.school_name && (
                    <div className="text-sm text-muted-foreground">{dancer.school_name}</div>
                  )}
                </div>
                <div className="shrink-0">
                  {state === 'checked_in' && checkInRow && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-lg bg-feis-green-light text-feis-green px-3 py-1 rounded-md">
                        #{checkInRow.competitor_number}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => {
                          const printWindow = window.open('', '_blank', 'width=400,height=500')
                          if (!printWindow) return

                          const number = String(checkInRow.competitor_number)
                          const { document } = printWindow

                          document.title = `#${number}`
                          document.head.innerHTML = ''
                          document.body.innerHTML = ''

                          const style = document.createElement('style')
                          style.textContent = `
                            body {
                              margin: 0;
                              display: flex;
                              align-items: center;
                              justify-content: center;
                              height: 100vh;
                            }
                            .number {
                              font-size: 250px;
                              font-weight: 900;
                              font-family: monospace;
                              line-height: 1;
                            }
                            @media print {
                              body {
                                height: auto;
                                padding: 20vh 0;
                              }
                            }
                          `

                          const numberEl = document.createElement('div')
                          numberEl.className = 'number'
                          numberEl.textContent = number

                          document.head.appendChild(style)
                          document.body.appendChild(numberEl)

                          printWindow.focus()
                          printWindow.print()
                        }}
                      >
                        Print #
                      </Button>
                      <CheckCircle2 className="h-5 w-5 text-feis-green" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground hover:text-destructive"
                        disabled={acting === dancer.dancer_id}
                        onClick={async () => {
                          if (!confirm(`Undo check-in for ${dancer.first_name} ${dancer.last_name}?`)) return
                          setActing(dancer.dancer_id)
                          try {
                            await supabase
                              .from('event_check_ins')
                              .delete()
                              .eq('event_id', eventId)
                              .eq('dancer_id', dancer.dancer_id)
                            await supabase
                              .from('registrations')
                              .update({ competitor_number: null })
                              .eq('event_id', eventId)
                              .eq('dancer_id', dancer.dancer_id)
                            setCheckInMap((prev) => {
                              const next = new Map(prev)
                              next.delete(dancer.dancer_id)
                              return next
                            })
                            showSuccess(`Undid check-in for ${dancer.first_name} ${dancer.last_name}`)
                          } catch (err) {
                            showError('Failed to undo', { description: err instanceof Error ? err.message : 'Unknown error' })
                          } finally {
                            setActing(null)
                          }
                        }}
                      >
                        Undo
                      </Button>
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
