'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface ScoreEntryFormProps {
  dancerId: string
  dancerName: string
  competitorNumber: string
  existingScore?: number | null
  scoreMin: number
  scoreMax: number
  onSubmit: (dancerId: string, score: number) => Promise<void>
  locked?: boolean
}

export function ScoreEntryForm({
  dancerId,
  dancerName,
  competitorNumber,
  existingScore,
  scoreMin,
  scoreMax,
  onSubmit,
  locked,
}: ScoreEntryFormProps) {
  const [score, setScore] = useState(existingScore?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    const num = parseFloat(score)
    if (isNaN(num) || num < scoreMin || num > scoreMax) return
    setSaving(true)
    await onSubmit(dancerId, num)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const numScore = parseFloat(score)
  const isValid = !isNaN(numScore) && numScore >= scoreMin && numScore <= scoreMax
  const hasError = score !== '' && !isValid

  return (
    <div className="flex items-center gap-3 p-3 rounded-md border hover:bg-feis-green-light/50 transition-colors">
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
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isValid || saving || locked}
        >
          {saving ? '...' : saved ? '\u2713 Saved' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
