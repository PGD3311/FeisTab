'use client'

import { useEffect, useState, useMemo, use } from 'react'
import { logAudit } from '@/lib/audit'
import { showSuccess, showCritical } from '@/lib/feedback'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

interface RegistrationDancer {
  id: string
  first_name: string
  last_name: string
  school_name: string | null
}

interface RegistrationCompetition {
  id: string
  code: string | null
  name: string
}

interface DancerWithRegistrations {
  dancer_id: string
  first_name: string
  last_name: string
  school_name: string | null
  competitor_number: string | null
  registrations: {
    id: string
    competition_id: string
    competition_code: string | null
    competition_name: string
    competitor_number: string | null
    status: string
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
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState<string | null>(null)

  async function loadData() {
    const [eventRes, regRes] = await Promise.all([
      supabase.from('events').select('id, name').eq('id', eventId).single(),
      supabase
        .from('registrations')
        .select('id, dancer_id, competition_id, competitor_number, status, dancers(id, first_name, last_name, school_name), competitions(id, code, name)')
        .eq('event_id', eventId)
        .order('dancer_id'),
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

    // Group registrations by dancer
    const dancerMap = new Map<string, DancerWithRegistrations>()
    for (const reg of regRes.data ?? []) {
      const dancer = reg.dancers as unknown as RegistrationDancer | null
      const comp = reg.competitions as unknown as RegistrationCompetition | null
      if (!dancer || !comp) continue

      if (!dancerMap.has(dancer.id)) {
        dancerMap.set(dancer.id, {
          dancer_id: dancer.id,
          first_name: dancer.first_name,
          last_name: dancer.last_name,
          school_name: dancer.school_name,
          competitor_number: reg.competitor_number,
          registrations: [],
        })
      }

      const entry = dancerMap.get(dancer.id)!
      if (reg.competitor_number && !entry.competitor_number) {
        entry.competitor_number = reg.competitor_number
      }
      entry.registrations.push({
        id: reg.id,
        competition_id: comp.id,
        competition_code: comp.code,
        competition_name: comp.name,
        competitor_number: reg.competitor_number,
        status: reg.status,
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
    let max = 99
    for (const d of dancers) {
      if (d.competitor_number) {
        const num = parseInt(d.competitor_number, 10)
        if (!isNaN(num) && num > max) max = num
      }
    }
    return max + 1
  }, [dancers])

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

  const checkedInCount = dancers.filter((d) => d.competitor_number).length
  const totalCount = dancers.length

  async function handleAssign(dancer: DancerWithRegistrations) {
    setAssigning(dancer.dancer_id)

    try {
      const numberToAssign = String(nextNumber)

      const regIds = dancer.registrations.map((r) => r.id)
      const { error } = await supabase
        .from('registrations')
        .update({
          competitor_number: numberToAssign,
          status: 'checked_in',
        })
        .in('id', regIds)

      if (error) {
        showCritical('Failed to assign number', { description: error.message })
        setAssigning(null)
        return
      }

      void logAudit(supabase, {
        userId: null,
        entityType: 'dancer',
        entityId: dancer.dancer_id,
        action: 'check_in',
        afterData: {
          competitor_number: numberToAssign,
          event_id: eventId,
          registrations_updated: regIds.length,
        },
      })

      setDancers((prev) =>
        prev.map((d) => {
          if (d.dancer_id !== dancer.dancer_id) return d
          return {
            ...d,
            competitor_number: numberToAssign,
            registrations: d.registrations.map((r) => ({
              ...r,
              competitor_number: numberToAssign,
              status: 'checked_in',
            })),
          }
        })
      )

      showSuccess(`#${numberToAssign} assigned to ${dancer.first_name} ${dancer.last_name}`)
    } catch (err) {
      showCritical('Unexpected error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setAssigning(null)
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-4">
      <div>
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
        const isCheckedIn = !!dancer.competitor_number

        return (
          <Card
            key={dancer.dancer_id}
            className={`feis-card ${isCheckedIn ? 'border-feis-green/30' : ''}`}
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
                </div>
                <div className="shrink-0">
                  {isCheckedIn ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-lg bg-feis-green-light text-feis-green px-3 py-1 rounded-md">
                        #{dancer.competitor_number}
                      </span>
                      <CheckCircle2 className="h-5 w-5 text-feis-green" />
                    </div>
                  ) : (
                    <Button
                      onClick={() => handleAssign(dancer)}
                      disabled={assigning === dancer.dancer_id}
                      size="lg"
                    >
                      {assigning === dancer.dancer_id
                        ? 'Assigning...'
                        : `Assign #${nextNumber}`}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}

      <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-4">
        <span>
          <strong className="text-foreground">{checkedInCount}</strong> / {totalCount} checked in
        </span>
        <span>
          Last assigned: <strong className="font-mono text-foreground">#{nextNumber > 100 ? nextNumber - 1 : '—'}</strong>
        </span>
      </div>
    </div>
  )
}
