'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function getStorageKey(eventId: string): string {
  return `feistab_access_${eventId}`
}

export function EventGate({
  eventId,
  children,
}: {
  eventId: string
  children: React.ReactNode
}) {
  const supabase = useSupabase()
  const [authorized, setAuthorized] = useState(false)
  const [checking, setChecking] = useState(true)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const validateCode = useCallback(async (inputCode: string, silent?: boolean) => {
    if (!silent) setSubmitting(true)
    setError('')

    const { data, error: fetchErr } = await supabase
      .from('events')
      .select('registration_code')
      .eq('id', eventId)
      .single()

    if (fetchErr || !data) {
      if (!silent) {
        setError('Could not verify code')
        setSubmitting(false)
      } else {
        setChecking(false)
      }
      return
    }

    const correct = data.registration_code?.toUpperCase() === inputCode.toUpperCase()

    if (correct) {
      localStorage.setItem(getStorageKey(eventId), inputCode.toUpperCase())
      setAuthorized(true)
    } else {
      localStorage.removeItem(getStorageKey(eventId))
      if (!silent) {
        setError('Wrong code')
      }
    }

    if (!silent) setSubmitting(false)
    setChecking(false)
  }, [supabase, eventId])

  // Check localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(getStorageKey(eventId))
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
      validateCode(saved, true)
    } else {
      setChecking(false)
    }
  }, [eventId, validateCode])

  if (checking) {
    return <p className="text-muted-foreground p-6">Loading...</p>
  }

  if (authorized) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-feis-cream p-4">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold text-feis-charcoal">FeisTab</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter event access code</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim()) validateCode(code.trim())
          }}
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
            disabled={!code.trim() || submitting}
            className="w-full"
          >
            {submitting ? 'Checking...' : 'Enter'}
          </Button>
        </form>
      </div>
    </div>
  )
}
