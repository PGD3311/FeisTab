'use client'

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  COMMENT_CODES,
  hasCommentContent,
  type CommentData,
} from '@/lib/comment-codes'

interface ScoreEntryFormProps {
  dancerId: string
  dancerName: string
  competitorNumber: string
  existingScore?: number | null
  existingFlagged?: boolean
  existingFlagReason?: string | null
  existingCommentData?: CommentData | null
  existingLegacyComments?: string | null
  scoreMin: number
  scoreMax: number
  onSubmit: (
    dancerId: string,
    score: number,
    flagged: boolean,
    flagReason: string | null,
    commentData: CommentData | null
  ) => Promise<void>
  locked?: boolean
  variant?: 'judge' | 'tabulator'
  isCurrentDancer?: boolean
  isExpanded?: boolean
  onToggleExpand?: (dancerId: string) => void
  onSaved?: () => void
  autoFocus?: boolean
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
  variant = 'tabulator',
  isCurrentDancer,
  isExpanded,
  onToggleExpand,
  onSaved,
  autoFocus,
}: ScoreEntryFormProps) {
  const [score, setScore] = useState(existingScore?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [flagged, setFlagged] = useState(existingFlagged ?? false)
  const [flagReason, setFlagReason] = useState(existingFlagReason ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [selectedCodes, setSelectedCodes] = useState<string[]>(
    existingCommentData?.codes ?? []
  )
  const [commentNote, setCommentNote] = useState(
    existingCommentData?.note ?? ''
  )

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
      await onSubmit(dancerId, num, flagged, flagged ? flagReason || null : null, commentData)
      setSaved(true)
      if (variant === 'judge' && onSaved) {
        setTimeout(() => {
          setSaved(false)
          onSaved()
        }, 800)
      } else if (variant === 'tabulator' && onSaved) {
        onSaved()
        setTimeout(() => setSaved(false), 2000)
      } else {
        setTimeout(() => setSaved(false), 2000)
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

  // --- Judge variant ---
  if (variant === 'judge') {
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
            className="flex items-center justify-end min-w-[56px] cursor-pointer select-none"
            aria-label={`Expand details for competitor ${competitorNumber}`}
          >
            <span className="font-mono text-[28px] font-bold text-feis-green text-right leading-none tabular-nums">
              {competitorNumber}
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
                <option value="early_start">Early Start</option>
                <option value="did_not_complete">Did Not Complete</option>
                <option value="other">Other</option>
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

  // --- Tabulator variant (default — unchanged layout) ---
  return (
    <div
      className={`flex flex-col p-3 rounded-md border transition-colors ${
        autoFocus ? 'border-l-2 border-l-feis-green' : ''
      } ${
        flagged ? 'border-feis-orange/60 bg-feis-orange/5' : 'hover:bg-feis-green-light/50'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
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
            {saving ? '...' : saveError ? 'Retry' : saved ? '\u2713 Saved' : 'Save'}
          </Button>
          <button
            type="button"
            onClick={() => setCommentsOpen(!commentsOpen)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors h-11 px-1"
          >
            {hasContent && (
              <span className="w-1.5 h-1.5 rounded-full bg-feis-green inline-block" />
            )}
            Comments{commentsOpen ? ' \u25B4' : ' \u25BE'}
          </button>
        </div>
      </div>

      {commentsOpen && (
        <div className="mt-2 pt-2 border-t border-border/50 pl-0 sm:pl-[68px]">
          {existingLegacyComments && !existingCommentData && (
            <p className="text-xs text-muted-foreground italic mb-2">
              Legacy note: {existingLegacyComments}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 mb-2">
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

      {saveError && <p className="text-xs text-destructive mt-1">{saveError}</p>}
    </div>
  )
}
