'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface ScoreEntryFormProps {
  dancerId: string
  dancerName: string
  competitorNumber: string
  existingScore?: number | null
  existingFlagged?: boolean
  existingFlagReason?: string | null
  scoreMin: number
  scoreMax: number
  onSubmit: (dancerId: string, score: number, flagged: boolean, flagReason: string | null) => Promise<void>
  locked?: boolean
}

export function ScoreEntryForm({
  dancerId,
  dancerName,
  competitorNumber,
  existingScore,
  existingFlagged,
  existingFlagReason,
  scoreMin,
  scoreMax,
  onSubmit,
  locked,
}: ScoreEntryFormProps) {
  const [score, setScore] = useState(existingScore?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [flagged, setFlagged] = useState(existingFlagged ?? false)
  const [flagReason, setFlagReason] = useState(existingFlagReason ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSave() {
    const num = parseFloat(score)
    if (isNaN(num) || num < scoreMin || num > scoreMax) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSubmit(dancerId, num, flagged, flagged ? flagReason || null : null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save score')
    } finally {
      setSaving(false)
    }
  }

  const numScore = parseFloat(score)
  const isValid = !isNaN(numScore) && numScore >= scoreMin && numScore <= scoreMax
  const hasError = score !== '' && !isValid

  return (
    <div className={`flex items-center gap-3 p-3 rounded-md border transition-colors ${
      flagged
        ? 'border-feis-orange/60 bg-feis-orange/5'
        : 'hover:bg-feis-green-light/50'
    }`}>
      <span className="feis-number font-mono text-2xl font-bold w-16 text-center text-feis-green">{competitorNumber}</span>
      <span className="flex-1 text-sm">{dancerName}</span>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={scoreMin}
          max={scoreMax}
          step="0.1"
          value={score}
          onChange={e => { setScore(e.target.value); setSaved(false) }}
          className={`w-24 text-center text-lg ${hasError ? 'border-destructive' : ''}`}
          disabled={locked}
        />
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={flagged}
            onChange={e => setFlagged(e.target.checked)}
            disabled={locked}
            className="accent-feis-orange"
          />
          <span className="text-xs text-muted-foreground">Flag</span>
        </label>
        {flagged && (
          <select
            value={flagReason}
            onChange={e => setFlagReason(e.target.value)}
            disabled={locked}
            className="text-xs border rounded px-1 py-0.5"
          >
            <option value="">Reason...</option>
            <option value="early_start">Early Start</option>
            <option value="did_not_complete">Did Not Complete</option>
            <option value="other">Other</option>
          </select>
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isValid || saving || locked}
          variant={saveError ? 'destructive' : 'default'}
        >
          {saving ? '...' : saveError ? 'Retry' : saved ? '\u2713 Saved' : 'Save'}
        </Button>
      </div>
      {saveError && (
        <p className="text-xs text-destructive mt-1 ml-16">{saveError}</p>
      )}
    </div>
  )
}
