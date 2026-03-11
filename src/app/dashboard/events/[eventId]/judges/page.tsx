'use client'

import { useEffect, useState, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
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
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function loadJudges() {
    const { data } = await supabase
      .from('judges')
      .select('id, first_name, last_name, access_code')
      .eq('event_id', eventId)
      .order('created_at')
    setJudges((data as Judge[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { loadJudges() }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) return
    setSaving(true)
    setError('')

    const code = generateAccessCode(lastName)

    const { error: err } = await supabase.from('judges').insert({
      event_id: eventId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      access_code: code,
    })

    if (err) {
      setError(err.message)
    } else {
      setFirstName('')
      setLastName('')
      await loadJudges()
    }
    setSaving(false)
  }

  async function handleRegenCode(judgeId: string, lastName: string) {
    const code = generateAccessCode(lastName)
    await supabase.from('judges').update({ access_code: code }).eq('id', judgeId)
    loadJudges()
  }

  async function handleRemove(judgeId: string) {
    await supabase.from('judges').delete().eq('id', judgeId)
    loadJudges()
  }

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Judges</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Add judges and share their access codes. Judges go to <span className="font-mono text-feis-green">/judge</span> and enter their code.
      </p>

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
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
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
