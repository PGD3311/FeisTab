'use client'

import { useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { parseRegistrationCSV, type ImportRow, type ImportResult } from '@/lib/csv/import'
import { CSVPreviewTable } from '@/components/csv-preview-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ImportPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = useSupabase()

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
      const { data: defaultRuleset } = await supabase
        .from('rule_sets')
        .select('id')
        .eq('name', 'Default - Raw Score Average')
        .single()

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
      }))

      const { error: dancerErr } = await supabase
        .from('dancers')
        .upsert(dancerInserts, { onConflict: 'first_name,last_name,coalesce(school_name, \'\')' })
        .select()

      const { data: allDancers } = await supabase
        .from('dancers')
        .select('id, first_name, last_name, school_name')

      const dancerLookup = new Map<string, string>()
      for (const d of allDancers ?? []) {
        const key = `${d.first_name}|${d.last_name}|${d.school_name ?? ''}`.toLowerCase()
        dancerLookup.set(key, d.id)
      }

      for (const [key, row] of uniqueDancers) {
        if (!dancerLookup.has(key)) {
          const { data: newDancer } = await supabase
            .from('dancers')
            .insert({
              first_name: row.first_name,
              last_name: row.last_name,
              school_name: row.school_name || null,
            })
            .select()
            .single()
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
              status: 'imported',
              ruleset_id: defaultRuleset?.id,
            })
            .select()
            .single()

          if (compErr) throw compErr
          comp = newComp

          await supabase.from('rounds').insert({
            competition_id: comp!.id,
            round_number: 1,
            round_type: 'standard',
          })
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
              competitor_number: row.competitor_number,
              status: 'registered',
            }
          })
          .filter(Boolean)

        if (regInserts.length > 0) {
          await supabase.from('registrations').upsert(
            regInserts as any[],
            { onConflict: 'competition_id,dancer_id' }
          )
        }
      }

      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Import Registrations</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Upload CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Required columns: first_name, last_name, competitor_number, age_group, level, competition_code, competition_name
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
        <Card className="mb-6">
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
        <div className="border border-green-200 rounded-md p-4 bg-green-50">
          <p className="text-green-800 font-medium">Import complete.</p>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => router.push(`/dashboard/events/${eventId}`)}
          >
            Back to Event
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
    </div>
  )
}
