'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

export default function NewEventPage() {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [location, setLocation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = useSupabase()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Generate a 6-character access code
    const accessCode = Math.random().toString(36).substring(2, 8).toUpperCase()

    const { data, error: insertError } = await supabase
      .from('events')
      .insert({
        name,
        start_date: startDate,
        location: location || null,
        status: 'active',
        registration_code: accessCode,
        created_by: user?.id,
      })
      .select()
      .single()

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
    } else {
      // Auto-authorize the creator
      localStorage.setItem(`feistab_access_${data.id}`, accessCode)

      // Auto-create Stage 1 so the event is immediately usable
      await supabase.from('stages').insert({
        event_id: data.id,
        name: 'Stage 1',
        display_order: 1,
      })
      router.push(`/dashboard/events/${data.id}`)
    }
  }

  return (
    <div className="max-w-xl">
      <Link
        href="/dashboard"
        className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1 mb-4"
      >
        <ChevronLeft className="h-4 w-4" /> Events
      </Link>
      <h1 className="text-3xl font-bold mb-6">Create Event</h1>
      <Card className="feis-card">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name" className="font-medium text-sm text-feis-charcoal">
                Event Name
              </Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="start" className="font-medium text-sm text-feis-charcoal">
                Date
              </Label>
              <Input
                id="start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="location" className="font-medium text-sm text-feis-charcoal">
                Location
              </Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Creating...' : 'Create Event'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
