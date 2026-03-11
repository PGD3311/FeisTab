'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Competition {
  id: string
  code: string | null
  name: string
  age_group: string | null
  level: string | null
}

export default function RegisterPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const router = useRouter()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [age, setAge] = useState('')
  const [school, setSchool] = useState('')
  const [teacherName, setTeacherName] = useState('')
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [selectedComps, setSelectedComps] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('competitions')
        .select('id, code, name, age_group, level')
        .eq('event_id', eventId)
        .order('code')
      setCompetitions((data as Competition[]) ?? [])
    }
    load()
  }, [])

  function toggleComp(compId: string) {
    setSelectedComps(prev => {
      const next = new Set(prev)
      if (next.has(compId)) next.delete(compId)
      else next.add(compId)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selectedComps.size === 0) {
      setError('Select at least one competition')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      // Upsert dancer
      const { data: existingDancers } = await supabase
        .from('dancers')
        .select('id')
        .eq('first_name', firstName)
        .eq('last_name', lastName)
        .limit(1)

      let dancerId: string

      if (existingDancers && existingDancers.length > 0) {
        dancerId = existingDancers[0].id
        if (teacherName) {
          await supabase.from('dancers').update({ teacher_name: teacherName }).eq('id', dancerId)
        }
      } else {
        const { data: newDancer, error: dancerErr } = await supabase
          .from('dancers')
          .insert({
            first_name: firstName,
            last_name: lastName,
            school_name: school || null,
            teacher_name: teacherName || null,
          })
          .select()
          .single()
        if (dancerErr) throw dancerErr
        dancerId = newDancer.id
      }

      // Get next competitor number
      const { data: maxReg } = await supabase
        .from('registrations')
        .select('competitor_number')
        .eq('event_id', eventId)
        .order('competitor_number', { ascending: false })
        .limit(1)

      const lastNum = maxReg?.[0]?.competitor_number
        ? parseInt(maxReg[0].competitor_number, 10)
        : 0
      let nextNum = isNaN(lastNum) ? 100 : lastNum + 1

      // Create registrations for each selected competition
      for (const compId of selectedComps) {
        await supabase.from('registrations').upsert(
          {
            event_id: eventId,
            dancer_id: dancerId,
            competition_id: compId,
            competitor_number: String(nextNum),
            status: 'registered',
          },
          { onConflict: 'competition_id,dancer_id' }
        )
        nextNum++
      }

      setSuccess(`${firstName} ${lastName} registered for ${selectedComps.size} competition${selectedComps.size > 1 ? 's' : ''}`)
      setFirstName('')
      setLastName('')
      setAge('')
      setSchool('')
      setTeacherName('')
      setSelectedComps(new Set())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Register Competitor</h1>
      <p className="text-muted-foreground text-sm mb-6">Add a dancer and select which competitions they are entering.</p>

      <form onSubmit={handleSubmit}>
        <Card className="feis-card mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Dancer Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName" className="font-medium text-sm text-feis-charcoal">First Name</Label>
                <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="lastName" className="font-medium text-sm text-feis-charcoal">Last Name</Label>
                <Input id="lastName" value={lastName} onChange={e => setLastName(e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="age" className="font-medium text-sm text-feis-charcoal">Age</Label>
                <Input id="age" type="number" min="4" max="99" value={age} onChange={e => setAge(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="school" className="font-medium text-sm text-feis-charcoal">Dance School</Label>
                <Input id="school" value={school} onChange={e => setSchool(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="teacherName" className="font-medium text-sm text-feis-charcoal">Teacher Name</Label>
                <Input id="teacherName" value={teacherName} onChange={e => setTeacherName(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="feis-card mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Select Competitions</CardTitle>
          </CardHeader>
          <CardContent>
            {competitions.length === 0 ? (
              <p className="text-muted-foreground text-sm">No competitions created yet. Import registrations or create competitions first.</p>
            ) : (
              <div className="space-y-2">
                {competitions.map(comp => {
                  const isSelected = selectedComps.has(comp.id)
                  return (
                    <button
                      type="button"
                      key={comp.id}
                      onClick={() => toggleComp(comp.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-md border text-left transition-colors ${
                        isSelected
                          ? 'bg-feis-green-light border-feis-green/40 ring-1 ring-feis-green/20'
                          : 'hover:bg-feis-green-light/30'
                      }`}
                    >
                      <div>
                        <span className="font-medium">
                          {comp.code && <span className="font-mono text-xs text-feis-green/70 mr-2">{comp.code}</span>}
                          {comp.name}
                        </span>
                        <span className="ml-2 text-sm text-muted-foreground">
                          {comp.age_group} · {comp.level}
                        </span>
                      </div>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-feis-green border-feis-green text-white'
                          : 'border-gray-300'
                      }`}>
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive mb-4">{error}</p>}

        {success && (
          <div className="border border-feis-green/30 rounded-md p-4 bg-feis-green-light mb-4">
            <p className="text-feis-green font-medium">{success}</p>
          </div>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Registering...' : `Register${selectedComps.size > 0 ? ` for ${selectedComps.size} competition${selectedComps.size > 1 ? 's' : ''}` : ''}`}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
