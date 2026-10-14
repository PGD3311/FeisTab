'use client'

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  COMMENT_CODES,
  hasCommentContent,
  type CommentData,
} from '@/lib/comment-codes'
import { PRECISION } from '@/lib/engine/constants'
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
  /** Must throw if the score was not saved, so the form never shows "Saved" falsely */
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
  /** Called right after a successful save so the parent can focus the next dancer's box */
  onAdvance?: (dancerId: string) => void
  inputRef?: (el: HTMLInputElement | null) => void
}

function toInt(value: number): number {
  return Math.round(value * PRECISION)
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
  onAdvance,
  inputRef,
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
  // True from the first edit until a save succeeds: an edited box is never "Saved"
  const [dirty, setDirty] = useState(false)
  // Bumped on every edit, so a save that finishes after further typing isn't shown as saved
  const editVersionRef = useRef(0)
  const [selectedCodes, setSelectedCodes] = useState<string[]>(
    existingCommentData?.codes ?? []
  )
  const [commentNote, setCommentNote] = useState(
    existingCommentData?.note ?? ''
  )

  // Enter or Tab saves, then the parent moves focus to the next dancer's box.
  // Tab on an empty box (or Shift+Tab) just moves focus as normal.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const isEnter = e.key === 'Enter'
    const isTab = e.key === 'Tab' && !e.shiftKey
    if (!isEnter && !isTab) return
    if (isTab && score.trim() === '') return
    e.preventDefault()
    void handleSave()
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
    markEdited()
  }

  function markEdited() {
    editVersionRef.current += 1
    setSaved(false)
    setDirty(true)
    setSaveError(null)
  }

  function isInRange(value: number): boolean {
    return toInt(value) >= toInt(scoreMin) && toInt(value) <= toInt(scoreMax)
  }

  async function handleSave() {
    if (saving || locked) return
    const num = parseFloat(score)
    // Out-of-range values are shown as an inline error below; never save them
    if (isNaN(num) || !isInRange(num)) return
    setSaving(true)
    setSaveError(null)
    const versionAtSave = editVersionRef.current

    const note = commentNote.trim() || null
    const commentData: CommentData | null =
      selectedCodes.length > 0 || note
        ? { codes: selectedCodes, note }
        : null

    try {
      await onSubmit(dancerId, num, flagged, flagged ? (flagReason as FlagReason) || null : null, commentData)
      // Edited again while saving: the box no longer matches what was saved
      if (editVersionRef.current !== versionAtSave) return
      setSaved(true)
      setDirty(false)
      onAdvance?.(dancerId)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      if (onSaved) {
        savedTimerRef.current = setTimeout(() => {
          setSaved(false)
          onSaved()
        }, 800)
      } else {
        savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
      }
    } catch (err) {
      setSaved(false)
      setSaveError(err instanceof Error ? err.message : 'Failed to save score')
    } finally {
      setSaving(false)
    }
  }

  const numScore = parseFloat(score)
  const isValid = !isNaN(numScore) && isInRange(numScore)
  const hasError = score !== '' && !isValid
  // "Saved" only when the box holds exactly the value the database has, unedited
  const showSaved =
    !saveError &&
    !dirty &&
    isValid &&
    (saved || (existingScore != null && toInt(numScore) === toInt(existingScore)))

  return (
    <div
      className={`flex flex-col rounded-md border transition-colors ${
        flagged
          ? 'border-feis-orange/60 bg-feis-orange/5'
          : isCurrentDancer
            ? 'border-l-4 border-l-feis-green border-y border-r bg-feis-green-light/40'
            : saved
              ? 'opacity-50'
              : showSaved
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
            markEdited()
          }}
          onKeyDown={handleKeyDown}
          ref={inputRef}
          aria-label={`Score for competitor ${competitorNumber}`}
          aria-invalid={hasError || undefined}
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
          {saving ? '...' : saveError ? 'Retry' : showSaved ? '\u2713 Saved' : 'Save'}
        </Button>
      </div>

      {hasError && (
        <p className="text-sm font-medium text-destructive px-3 pb-2" role="alert">
          Score must be between {scoreMin} and {scoreMax}
        </p>
      )}

      {/* Expanded details: name, comments, flag */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/40 space-y-2">
          <p className="text-sm text-muted-foreground">{dancerName}</p>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={flagged}
              onChange={e => {
                setFlagged(e.target.checked)
                markEdited()
              }}
              disabled={locked}
              className="accent-feis-orange w-5 h-5"
            />
            <span className="text-xs text-muted-foreground">Flag</span>
          </label>
          {flagged && (
            <select
              value={flagReason}
              onChange={e => {
                setFlagReason(e.target.value)
                markEdited()
              }}
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
              markEdited()
            }}
            placeholder="Optional note..."
            disabled={locked}
            rows={2}
            className="w-full text-xs border rounded-md px-2 py-1.5 resize-none placeholder:text-muted-foreground disabled:opacity-50"
          />
        </div>
      )}

      {saveError && (
        <p className="text-sm text-destructive px-3 pb-2" role="alert">
          Not saved: {saveError}
        </p>
      )}
    </div>
  )
}
