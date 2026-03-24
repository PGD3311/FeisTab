'use client'

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  COMMENT_CODES,
  hasCommentContent,
  type CommentData,
} from '@/lib/comment-codes'
import { FLAG_REASONS, type FlagReason } from '@/lib/engine/flag-reasons'

interface ScoreEntryFormProps {
  dancerId: string
  dancerName: string
  competitorNumber: string
  existingScore?: number | null
  existingFlagged?: boolean
  existingFlagReason?: FlagReason | null
  existingCommentData?: CommentData | null
  existingLegacyComments?: string | null
  scoreMin: number
  scoreMax: number
  onSubmit: (
    dancerId: string,
    score: number,
    flagged: boolean,
    flagReason: FlagReason | null,
    commentData: CommentData | null
  ) => Promise<void>
  locked?: boolean
  isCurrentDancer?: boolean
  isExpanded?: boolean
  onToggleExpand?: (dancerId: string) => void
  onSaved?: () => void
}

export function ScoreEntryForm({
  dancerId,
  dancerName,
  competitorNumber,
  existingScore,
  existingFlagged,
  existingFlagReason,
  existingCommentData,
  existingLegacyComments,
  scoreMin,
  scoreMax,
  onSubmit,
  locked,
  isCurrentDancer,
  isExpanded,
  onToggleExpand,
  onSaved,
}: ScoreEntryFormProps) {
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const [score, setScore] = useState(existingScore?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [flagged, setFlagged] = useState(existingFlagged ?? false)
  const [flagReason, setFlagReason] = useState(existingFlagReason ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [selectedCodes, setSelectedCodes] = useState<string[]>(
    existingCommentData?.codes ?? []
  )
  const [commentNote, setCommentNote] = useState(
    existingCommentData?.note ?? ''
  )

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      handleSave()
    }
  }

  const hasContent = hasCommentContent(
    existingCommentData ?? (selectedCodes.length > 0 || commentNote.trim()
      ? { codes: selectedCodes, note: commentNote.trim() || null }
      : null),
    existingLegacyComments ?? null
  )

  function toggleCode(code: string) {
    setSelectedCodes(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
    setSaved(false)
  }

  async function handleSave() {
    const num = parseFloat(score)
    if (isNaN(num) || num < scoreMin || num > scoreMax) return
    setSaving(true)
    setSaveError(null)

    const note = commentNote.trim() || null
    const commentData: CommentData | null =
      selectedCodes.length > 0 || note
        ? { codes: selectedCodes, note }
        : null

    try {
      await onSubmit(dancerId, num, flagged, flagged ? (flagReason as FlagReason) || null : null, commentData)
      setSaved(true)
      if (onSaved) {
        savedTimerRef.current = setTimeout(() => {
          setSaved(false)
          onSaved()
        }, 800)
      } else {
        savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save score')
    } finally {
      setSaving(false)
    }
  }

  const numScore = parseFloat(score)
  const isValid = !isNaN(numScore) && numScore >= scoreMin && numScore <= scoreMax
  const hasError = score !== '' && !isValid
  const isScored = existingScore != null

  return (
    <div
      className={`flex flex-col rounded-md border transition-colors ${
        flagged
          ? 'border-feis-orange/60 bg-feis-orange/5'
          : isCurrentDancer
            ? 'border-l-4 border-l-feis-green border-y border-r bg-feis-green-light/40'
            : saved
              ? 'opacity-50'
              : isScored
                ? 'opacity-60 bg-muted/20'
                : 'hover:bg-feis-green-light/30'
      }`}
    >
      {/* Collapsed row: number + score + save */}
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={() => onToggleExpand?.(dancerId)}
          className="flex flex-col items-center justify-center min-w-[64px] min-h-[56px] cursor-pointer select-none px-2 py-1 rounded-md hover:bg-feis-green-light/30 transition-colors"
          aria-label={`Expand details for competitor ${competitorNumber}`}
        >
          <span className="font-mono text-[28px] font-bold text-feis-green text-right leading-none tabular-nums">
            {competitorNumber}
          </span>
          <span className="text-xs text-muted-foreground mt-1">
            {isExpanded ? 'close' : hasContent ? '\u2713 notes' : 'notes'}
          </span>
        </button>

        <Input
          type="number"
          min={scoreMin}
          max={scoreMax}
          step="0.1"
          value={score}
          onChange={e => {
            setScore(e.target.value)
            setSaved(false)
            setSaveError(null)
          }}
          onKeyDown={handleKeyDown}
          className={`flex-1 text-center font-mono text-2xl h-12 ${
            hasError
              ? 'border-destructive'
              : saveError
                ? 'border-destructive'
                : isCurrentDancer
                  ? 'border-feis-green'
                  : ''
          }`}
          disabled={locked}
          onClick={e => e.stopPropagation()}
        />

        <Button
          onClick={handleSave}
          disabled={!isValid || saving || locked}
          variant={saveError ? 'destructive' : 'default'}
          className="h-12 min-w-[72px] text-base"
        >
          {saving ? '...' : saveError ? 'Retry' : saved ? '\u2713' : isScored ? '\u2713 Saved' : 'Save'}
        </Button>
      </div>

      {/* Expanded details: name, comments, flag */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/40 space-y-2">
          <p className="text-sm text-muted-foreground">{dancerName}</p>

          <label className="flex items-center gap-1.5 cursor-pointer">
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
              className="text-xs border rounded px-2 py-2 w-full"
            >
              <option value="">Reason...</option>
              {FLAG_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          )}

          {existingLegacyComments && !existingCommentData && (
            <p className="text-xs text-muted-foreground italic">
              Legacy note: {existingLegacyComments}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {COMMENT_CODES.map(cc => {
              const isSelected = selectedCodes.includes(cc.code)
              return (
                <button
                  key={cc.code}
                  type="button"
                  onClick={() => toggleCode(cc.code)}
                  disabled={locked}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    isSelected
                      ? 'bg-feis-green-light text-feis-green border-feis-green/40 font-medium'
                      : 'bg-feis-cream-dark text-muted-foreground border hover:border-feis-charcoal/30'
                  } ${locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {isSelected && '\u2713 '}{cc.label}
                </button>
              )
            })}
          </div>
          <textarea
            value={commentNote}
            onChange={e => {
              setCommentNote(e.target.value)
              setSaved(false)
            }}
            placeholder="Optional note..."
            disabled={locked}
            rows={2}
            className="w-full text-xs border rounded-md px-2 py-1.5 resize-none placeholder:text-muted-foreground disabled:opacity-50"
          />
        </div>
      )}

      {saveError && <p className="text-xs text-destructive px-3 pb-2">{saveError}</p>}
    </div>
  )
}
