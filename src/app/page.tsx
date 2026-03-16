'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface EventInfo {
  id: string
  name: string
  start_date: string
  location: string | null
}

export default function HomePage() {
  const supabase = useSupabase()
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [event, setEvent] = useState<EventInfo | null>(null)

  async function handleCodeSubmit() {
    if (!code.trim()) return
    setChecking(true)
    setError('')

    const { data, error: fetchErr } = await supabase
      .from('events')
      .select('id, name, start_date, location, registration_code')
      .eq('registration_code', code.trim().toUpperCase())
      .maybeSingle()

    if (fetchErr || !data) {
      setError('No event found with that code')
      setChecking(false)
      return
    }

    // Save access
    localStorage.setItem(`feistab_access_${data.id}`, code.trim().toUpperCase())
    setEvent({ id: data.id, name: data.name, start_date: data.start_date, location: data.location })
    setChecking(false)
  }

  // Station selector after code validated
  if (event) {
    const stations = [
      {
        label: "I'm the Organizer",
        description: 'Dashboard, tabulation, results',
        href: `/dashboard/events/${event.id}`,
        color: 'bg-feis-green text-white hover:bg-feis-green/90',
      },
      {
        label: "I'm at Registration",
        description: 'Check in dancers, assign numbers',
        href: `/registration/${event.id}`,
        color: 'bg-white border-2 border-feis-green text-feis-green hover:bg-feis-green-light',
      },
      {
        label: "I'm at Side-Stage",
        description: 'Confirm roster, send to judge',
        href: `/checkin/${event.id}`,
        color: 'bg-white border-2 border-feis-orange text-feis-orange hover:bg-feis-orange/5',
      },
      {
        label: "I'm a Judge",
        description: 'Score dancers, leave feedback',
        href: '/judge',
        color: 'bg-white border-2 border-feis-charcoal/30 text-feis-charcoal hover:bg-muted',
      },
    ]

    return (
      <div className="min-h-screen bg-feis-cream flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-feis-charcoal">{event.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {event.start_date}{event.location && ` · ${event.location}`}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">Choose your station</p>
            {stations.map((s) => (
              <button
                key={s.href}
                type="button"
                onClick={() => router.push(s.href)}
                className={`w-full p-4 rounded-lg text-left transition-colors ${s.color}`}
              >
                <span className="text-lg font-semibold block">{s.label}</span>
                <span className="text-sm opacity-70">{s.description}</span>
              </button>
            ))}
          </div>


          <button
            type="button"
            onClick={() => { setEvent(null); setCode('') }}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Different event
          </button>
        </div>
      </div>
    )
  }

  // Code entry
  return (
    <div className="min-h-screen bg-feis-cream flex items-center justify-center p-4">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-feis-charcoal">FeisTab</h1>
          <p className="text-sm text-muted-foreground mt-2">Enter your event code</p>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); handleCodeSubmit() }}
          className="space-y-3"
        >
          <Input
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError('') }}
            placeholder="ACCESS CODE"
            className="text-center font-mono text-lg tracking-widest h-12"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            disabled={!code.trim() || checking}
            className="w-full"
          >
            {checking ? 'Checking...' : 'Enter'}
          </Button>
        </form>
        <Link href="/dashboard" className="block text-sm text-muted-foreground hover:text-feis-green transition-colors py-2 text-center">
          Organizer dashboard →
        </Link>
      </div>
    </div>
  )
}
