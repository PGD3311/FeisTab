'use client'

import { useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { useEvent } from '@/contexts/event-context'
import { parseRegistrationCSV, type ImportResult } from '@/lib/csv/import'
import { importEventRows, type ImportResult as ImportOutcome } from '@/lib/supabase/rpc'
import { CSVPreviewTable } from '@/components/csv-preview-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ImportPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [imported, setImported] = useState<ImportOutcome | null>(null)
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
      // One atomic database call: dancers, competitions (+ round 1), registrations,
      // and competitor numbers. Nothing is half-imported if it fails.
      const result = await importEventRows(supabase, eventId, preview.valid)
      setImported(result)
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
          {imported && (
            <p className="text-sm text-muted-foreground mt-1">
              {imported.registrations} new registration{imported.registrations !== 1 ? 's' : ''},{' '}
              {imported.competitions_created} new competition{imported.competitions_created !== 1 ? 's' : ''},{' '}
              {imported.check_ins} competitor number{imported.check_ins !== 1 ? 's' : ''} assigned.
            </p>
          )}
          {imported && imported.conflicts.length > 0 && (
            <p className="text-sm text-feis-orange mt-2">
              {imported.conflicts.length} dancer(s) had competitor number conflicts and were not assigned numbers.
              Review and assign numbers at the registration desk.
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
