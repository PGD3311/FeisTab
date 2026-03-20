'use client'

import { useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { useEvent } from '@/contexts/event-context'
import { parseRegistrationCSV, type ImportRow, type ImportResult } from '@/lib/csv/import'
import { CSVPreviewTable } from '@/components/csv-preview-table'
import { syncCompetitorNumberToRegistrations } from '@/lib/check-in-sync'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ImportPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [conflicts, setConflicts] = useState<string[]>([])
  const [syncFailures, setSyncFailures] = useState<number>(0)
  const router = useRouter()
  const supabase = useSupabase()
  const { reload } = useEvent()

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const result = parseRegistrationCSV(text)
      setPreview(result)
      setDone(false)
      setError('')
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (!preview || preview.valid.length === 0) return
    setImporting(true)
    setError('')

    try {
      // Group by competition code
      const compMap = new Map<string, ImportRow[]>()
      for (const row of preview.valid) {
        if (!compMap.has(row.competition_code)) compMap.set(row.competition_code, [])
        compMap.get(row.competition_code)!.push(row)
      }

      // Get default ruleset
      const { data: defaultRuleset, error: rulesetErr } = await supabase
        .from('rule_sets')
        .select('id')
        .eq('name', 'Default - Irish Points')
        .single()

      if (rulesetErr) throw new Error(`Failed to load default ruleset: ${rulesetErr.message}`)

      // --- Step 1: Batch upsert all unique dancers ---
      const uniqueDancers = new Map<string, ImportRow>()
      for (const row of preview.valid) {
        const key = `${row.first_name}|${row.last_name}|${row.school_name ?? ''}`.toLowerCase()
        if (!uniqueDancers.has(key)) uniqueDancers.set(key, row)
      }

      const dancerInserts = [...uniqueDancers.values()].map(row => ({
        first_name: row.first_name,
        last_name: row.last_name,
        school_name: row.school_name || null,
        teacher_name: row.teacher_name || null,
        date_of_birth: row.date_of_birth || null,
      }))

      const { error: dancerErr } = await supabase
        .from('dancers')
        .upsert(dancerInserts, { onConflict: 'first_name,last_name,coalesce(school_name, \'\')' })
        .select()

      if (dancerErr) throw new Error(`Failed to upsert dancers: ${dancerErr.message}`)

      const { data: allDancers, error: allDancersErr } = await supabase
        .from('dancers')
        .select('id, first_name, last_name, school_name')

      if (allDancersErr) throw new Error(`Failed to load dancers: ${allDancersErr.message}`)

      const dancerLookup = new Map<string, string>()
      for (const d of allDancers ?? []) {
        const key = `${d.first_name}|${d.last_name}|${d.school_name ?? ''}`.toLowerCase()
        dancerLookup.set(key, d.id)
      }

      for (const [key, row] of uniqueDancers) {
        if (!dancerLookup.has(key)) {
          const { data: newDancer, error: insertErr } = await supabase
            .from('dancers')
            .insert({
              first_name: row.first_name,
              last_name: row.last_name,
              school_name: row.school_name || null,
              teacher_name: row.teacher_name || null,
              date_of_birth: row.date_of_birth || null,
            })
            .select()
            .single()
          if (insertErr) throw new Error(`Failed to insert dancer ${row.first_name} ${row.last_name}: ${insertErr.message}`)
          if (newDancer) dancerLookup.set(key, newDancer.id)
        }
      }

      // --- Step 2: Create competitions ---
      for (const [code, rows] of compMap) {
        const sample = rows[0]

        let { data: comp } = await supabase
          .from('competitions')
          .select('id')
          .eq('event_id', eventId)
          .eq('code', code)
          .single()

        if (!comp) {
          const { data: newComp, error: compErr } = await supabase
            .from('competitions')
            .insert({
              event_id: eventId,
              code,
              name: sample.competition_name,
              age_group: sample.age_group,
              level: sample.level,
              dance_type: sample.dance_type || null,
              status: 'imported',
              ruleset_id: defaultRuleset?.id,
            })
            .select()
            .single()

          if (compErr) throw compErr
          comp = newComp

          const { error: roundErr } = await supabase.from('rounds').insert({
            competition_id: comp!.id,
            round_number: 1,
            round_type: 'standard',
          })

          if (roundErr) throw new Error(`Failed to create round for ${code}: ${roundErr.message}`)
        }

        // --- Step 3: Batch upsert registrations ---
        const regInserts = rows
          .map(row => {
            const dancerKey = `${row.first_name}|${row.last_name}|${row.school_name ?? ''}`.toLowerCase()
            const dancerId = dancerLookup.get(dancerKey)
            if (!dancerId) return null
            return {
              event_id: eventId,
              dancer_id: dancerId,
              competition_id: comp!.id,
              competitor_number: null, // Written by syncCompetitorNumberToRegistrations via event_check_ins
              status: 'registered',
            }
          })
          .filter(Boolean)

        if (regInserts.length > 0) {
          const { error: regErr } = await supabase.from('registrations').upsert(
            regInserts as any[],
            { onConflict: 'competition_id,dancer_id' }
          )

          if (regErr) throw new Error(`Failed to upsert registrations for ${code}: ${regErr.message}`)
        }
      }

      // --- Step 4: Create event_check_ins for dancers with competitor numbers ---
      const dancerNumbers = new Map<string, Set<string>>()
      for (const row of preview.valid) {
        if (!row.competitor_number) continue
        const dancerKey = `${row.first_name}|${row.last_name}|${row.school_name ?? ''}`.toLowerCase()
        const dancerId = dancerLookup.get(dancerKey)
        if (!dancerId) continue

        if (!dancerNumbers.has(dancerId)) dancerNumbers.set(dancerId, new Set())
        dancerNumbers.get(dancerId)!.add(row.competitor_number)
      }

      const checkInConflicts: string[] = []
      let syncFailureCount = 0
      for (const [dancerId, numbers] of dancerNumbers) {
        if (numbers.size > 1) {
          checkInConflicts.push(dancerId)
          continue
        }

        const competitorNumber = [...numbers][0]

        const { data: existing, error: checkInLookupErr } = await supabase
          .from('event_check_ins')
          .select('id, competitor_number')
          .eq('event_id', eventId)
          .eq('dancer_id', dancerId)
          .maybeSingle()

        if (checkInLookupErr) {
          checkInConflicts.push(dancerId)
          continue
        }

        if (existing) {
          if (existing.competitor_number !== competitorNumber) {
            checkInConflicts.push(dancerId)
          }
          continue
        }

        const { error: checkInErr } = await supabase
          .from('event_check_ins')
          .insert({
            event_id: eventId,
            dancer_id: dancerId,
            competitor_number: competitorNumber,
            checked_in_by: 'import',
          })

        if (checkInErr) {
          checkInConflicts.push(dancerId)
          continue
        }

        const syncResult = await syncCompetitorNumberToRegistrations(
          supabase, eventId, dancerId, competitorNumber
        )
        if (syncResult.error) {
          console.error('Sync failed for dancer:', dancerId, syncResult.error.message)
          syncFailureCount++
        }
      }

      setConflicts(checkInConflicts)
      setSyncFailures(syncFailureCount)

      setDone(true)
      void reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <Card className="feis-card mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Upload CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Required: first_name, last_name, age_group, level, competition_code, competition_name.
            Optional: competitor_number, date_of_birth, school_name, teacher_name, dance_type.
            One row per dancer per competition.
          </p>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="text-sm"
          />
        </CardContent>
      </Card>

      {preview && (
        <Card className="feis-card mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <CSVPreviewTable
              valid={preview.valid}
              errors={preview.errors}
              warnings={preview.warnings}
            />
          </CardContent>
        </Card>
      )}

      {preview && preview.valid.length > 0 && !done && (
        <div className="flex gap-2">
          <Button onClick={handleImport} disabled={importing}>
            {importing ? 'Importing...' : `Import ${preview.valid.length} registrations`}
          </Button>
          <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
        </div>
      )}

      {done && (
        <div className="border border-feis-green/30 rounded-md p-4 bg-feis-green-light">
          <p className="text-feis-green font-medium">Import complete.</p>
          {conflicts.length > 0 && (
            <p className="text-sm text-feis-orange mt-2">
              {conflicts.length} dancer(s) had competitor number conflicts and were not assigned numbers.
              Review and assign numbers at the registration desk.
            </p>
          )}
          {syncFailures > 0 && (
            <p className="text-sm text-feis-orange mt-2">
              {syncFailures} dancer(s) had competitor number sync failures.
              Their check-in numbers were saved but may not appear on registrations until the next sync.
            </p>
          )}
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => router.push(`/dashboard/events/${eventId}`)}
          >
            Back to Event
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive mt-4">{error}</p>}
    </div>
  )
}
