'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function JudgeLoginPage() {
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
      setError('Enter your access code')
      setLoading(false)
      return
    }

    const { data: judge } = await supabase
      .from('judges')
      .select('id, event_id, first_name, last_name')
      .eq('access_code', trimmed)
      .single()

    if (!judge) {
      setError('Invalid access code. Check with your organizer.')
      setLoading(false)
      return
    }

    // Store judge session in localStorage
    localStorage.setItem('judge_session', JSON.stringify({
      judge_id: judge.id,
      event_id: judge.event_id,
      name: `${judge.first_name} ${judge.last_name}`,
    }))

    router.push(`/judge/${judge.event_id}`)
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="feis-card w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-semibold">Judge Sign In</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Enter the access code from your organizer
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. MURPHY-7291"
              className="text-center text-lg tracking-widest font-mono"
              autoFocus
              autoComplete="off"
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Checking...' : 'Enter'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
