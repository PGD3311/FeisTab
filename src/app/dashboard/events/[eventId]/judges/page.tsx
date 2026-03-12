'use client'

import { useEffect, useState, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { showSuccess, showError } from '@/lib/feedback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Judge {
  id: string
  first_name: string
  last_name: string
  access_code: string | null
}

function generateAccessCode(lastName: string): string {
  const pin = Math.floor(1000 + Math.random() * 9000).toString()
  const name = lastName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8)
  return `${name}-${pin}`
}

export default function JudgeManagementPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const [judges, setJudges] = useState<Judge[]>([])
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  async function loadJudges() {
    const { data, error } = await supabase
      .from('judges')
      .select('id, first_name, last_name, access_code')
      .eq('event_id', eventId)
      .order('created_at')
    if (error) {
      console.error('Failed to load judges:', error.message)
      setLoadError(true)
      setLoading(false)
      return
    }
    setLoadError(false)
    setJudges((data as Judge[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { loadJudges() }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) return
    setSaving(true)

    const code = generateAccessCode(lastName)

    const { error: err } = await supabase.from('judges').insert({
      event_id: eventId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      access_code: code,
    })

    if (err) {
      showError('Failed to add judge', { description: err.message })
    } else {
      showSuccess('Judge added')
      setFirstName('')
      setLastName('')
      await loadJudges()
    }
    setSaving(false)
  }

  async function handleRegenCode(judgeId: string, lastName: string) {
    const code = generateAccessCode(lastName)
    const { error } = await supabase.from('judges').update({ access_code: code }).eq('id', judgeId)
    if (error) {
      showError('Failed to regenerate code', { description: error.message })
      return
    }
    showSuccess('Access code regenerated')
    loadJudges()
  }

  async function handleRemove(judgeId: string) {
    const { error } = await supabase.from('judges').delete().eq('id', judgeId)
    if (error) {
      showError('Failed to remove judge', { description: error.message })
      return
    }
    showSuccess('Judge removed')
    loadJudges()
  }

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>

  if (loadError) {
    return (
      <div className="max-w-2xl">
        <div className="p-3 rounded-md bg-orange-50 border border-orange-200 text-orange-800 text-sm">
          Could not load judges. Try refreshing.
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <Card className="feis-card mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Add Judge</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-3 items-end">
            <div className="flex-1">
              <Label htmlFor="firstName" className="text-sm font-medium">First Name</Label>
              <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} required />
            </div>
            <div className="flex-1">
              <Label htmlFor="lastName" className="text-sm font-medium">Last Name</Label>
              <Input id="lastName" value={lastName} onChange={e => setLastName(e.target.value)} required />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Adding...' : 'Add Judge'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Judge List ({judges.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {judges.length === 0 ? (
            <p className="text-muted-foreground text-sm">No judges added yet.</p>
          ) : (
            <div className="space-y-3">
              {judges.map(judge => (
                <div key={judge.id} className="flex items-center justify-between p-3 rounded-md border">
                  <div>
                    <p className="font-medium">{judge.first_name} {judge.last_name}</p>
                    <p className="font-mono text-lg tracking-widest text-feis-green font-bold mt-0.5">
                      {judge.access_code ?? 'No code'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRegenCode(judge.id, judge.last_name)}
                    >
                      New Code
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemove(judge.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
