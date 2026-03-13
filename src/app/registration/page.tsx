'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function RegistrationLandingPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const trimmed = code.trim().toUpperCase()
    if (!trimmed) {
      setError('Enter the event registration code')
      setLoading(false)
      return
    }

    const { data: event, error: queryError } = await supabase
      .from('events')
      .select('id')
      .eq('registration_code', trimmed)
      .single()

    if (queryError || !event) {
      setError('No event found with that code. Check with your organizer.')
      setLoading(false)
      return
    }

    router.push(`/registration/${event.id}`)
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="feis-card w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-semibold">Registration Desk</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Enter the event code from your organizer
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. SPRING26"
              className="text-center text-lg tracking-widest font-mono"
              autoFocus
              autoComplete="off"
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Looking up...' : 'Enter'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
