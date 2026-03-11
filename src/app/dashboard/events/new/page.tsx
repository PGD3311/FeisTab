'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function NewEventPage() {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [location, setLocation] = useState('')
  const [registrationCode, setRegistrationCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = useSupabase()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()

    const { data, error: insertError } = await supabase
      .from('events')
      .insert({
        name,
        start_date: startDate,
        end_date: endDate || null,
        location: location || null,
        registration_code: registrationCode.toUpperCase() || null,
        created_by: user?.id,
      })
      .select()
      .single()

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
    } else {
      router.push(`/dashboard/events/${data.id}`)
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-3xl font-bold mb-6">Create Event</h1>
      <Card className="feis-card">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name" className="font-medium text-sm text-feis-charcoal">Event Name</Label>
              <Input id="name" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start" className="font-medium text-sm text-feis-charcoal">Start Date</Label>
                <Input id="start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="end" className="font-medium text-sm text-feis-charcoal">End Date</Label>
                <Input id="end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="location" className="font-medium text-sm text-feis-charcoal">Location</Label>
                <Input id="location" value={location} onChange={e => setLocation(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="regCode" className="font-medium text-sm text-feis-charcoal">Registration Code</Label>
                <Input id="regCode" value={registrationCode} onChange={e => setRegistrationCode(e.target.value.toUpperCase())} placeholder="e.g. SPRING26" className="font-mono tracking-widest" />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Event'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
