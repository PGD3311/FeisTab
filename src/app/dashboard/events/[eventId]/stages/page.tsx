'use client'

import { useEffect, useState, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { DancerStatusToggle } from '@/components/dancer-status-toggle'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Competition {
  id: string
  code: string | null
  name: string
  status: string
}

interface Dancer {
  first_name: string
  last_name: string
}

interface Registration {
  id: string
  competitor_number: string
  status: 'registered' | 'checked_in' | 'present' | 'scratched' | 'no_show' | 'danced'
  dancer_id: string
  dancers: Dancer | null
}

export default function StageManagerPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [selectedComp, setSelectedComp] = useState<string | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loading, setLoading] = useState(true)

  async function loadComps() {
    const { data } = await supabase
      .from('competitions')
      .select('id, code, name, status')
      .eq('event_id', eventId)
      .order('code')
    setCompetitions((data as Competition[]) ?? [])
    setLoading(false)
  }

  async function loadRegistrations(compId: string) {
    const { data } = await supabase
      .from('registrations')
      .select('*, dancers(*)')
      .eq('competition_id', compId)
      .order('competitor_number')
    setRegistrations((data as Registration[]) ?? [])
  }

  useEffect(() => { loadComps() }, [])

  useEffect(() => {
    if (selectedComp) loadRegistrations(selectedComp)
  }, [selectedComp])

  async function handleStatusChange(regId: string, dancerId: string, oldStatus: string, newStatus: string) {
    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('registrations').update({ status: newStatus }).eq('id', regId)

    await supabase.from('status_changes').insert({
      competition_id: selectedComp,
      dancer_id: dancerId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: user?.id,
    })

    loadRegistrations(selectedComp!)
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Stage Manager</h1>

      <div className="flex gap-2 flex-wrap mb-6">
        {competitions.map(c => (
          <button
            key={c.id}
            onClick={() => setSelectedComp(c.id)}
            className={`px-3 py-2 rounded-md text-sm border ${
              selectedComp === c.id ? 'bg-feis-green text-white' : 'hover:bg-feis-green-light'
            }`}
          >
            {c.code || c.name}
          </button>
        ))}
      </div>

      {selectedComp && (
        <div className="space-y-2">
          {registrations.map(reg => (
            <DancerStatusToggle
              key={reg.id}
              competitorNumber={reg.competitor_number}
              dancerName={`${reg.dancers?.first_name} ${reg.dancers?.last_name}`}
              currentStatus={reg.status}
              onStatusChange={(newStatus) =>
                handleStatusChange(reg.id, reg.dancer_id, reg.status, newStatus)
              }
            />
          ))}
          {registrations.length === 0 && (
            <p className="text-muted-foreground text-sm">No dancers in this competition.</p>
          )}
        </div>
      )}
    </div>
  )
}
