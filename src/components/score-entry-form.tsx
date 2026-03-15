'use client'

import { useState, useRef, useEffect } from 'react'
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
  autoFocus?: boolean
  onSaved?: () => void
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
  autoFocus,
  onSaved,
}: ScoreEntryFormProps) {
  const [score, setScore] = useState(existingScore?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [flagged, setFlagged] = useState(existingFlagged ?? false)
  const [flagReason, setFlagReason] = useState(existingFlagReason ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)

  const scoreInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus && scoreInputRef.current) {
      scoreInputRef.current.focus()
    }
  }, [autoFocus])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      handleSave()
    }
  }

  async function handleSave() {
    const num = parseFloat(score)
    if (isNaN(num) || num < scoreMin || num > scoreMax) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSubmit(dancerId, num, flagged, flagged ? flagReason || null : null)
      setSaved(true)
      onSaved?.()
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
    <div
      className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-md border transition-colors ${
        autoFocus ? 'border-l-2 border-l-feis-green' : ''
      } ${
        flagged ? 'border-feis-orange/60 bg-feis-orange/5' : 'hover:bg-feis-green-light/50'
      }`}
    >
      <div className="flex items-center gap-2 sm:gap-0">
        <span className="feis-number font-mono text-2xl font-bold w-16 text-center text-feis-green">
          {competitorNumber}
        </span>
        <span className="flex-1 text-sm sm:ml-1">{dancerName}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          ref={scoreInputRef}
          type="number"
          min={scoreMin}
          max={scoreMax}
          step="0.1"
          value={score}
          onChange={e => {
            setScore(e.target.value)
            setSaved(false)
          }}
          onKeyDown={handleKeyDown}
          className={`w-full sm:w-24 text-center text-lg h-11 ${hasError ? 'border-destructive' : ''}`}
          disabled={locked}
        />
        <label className="flex items-center gap-1.5 cursor-pointer h-11">
          <input
            type="checkbox"
            checked={flagged}
            onChange={e => setFlagged(e.target.checked)}
            disabled={locked}
            className="accent-feis-orange w-5 h-5"
          />
          <span className="text-xs text-muted-foreground">Flag</span>
        </label>
        {flagged && (
          <select
            value={flagReason}
            onChange={e => setFlagReason(e.target.value)}
            disabled={locked}
            className="text-xs border rounded px-2 py-2 h-11"
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
          className="h-11 min-w-[4rem]"
        >
          {saving ? '...' : saveError ? 'Retry' : saved ? '✓ Saved' : 'Save'}
        </Button>
      </div>
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
    </div>
  )
}
