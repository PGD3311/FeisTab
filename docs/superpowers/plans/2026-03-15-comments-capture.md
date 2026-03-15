# Comments / Marks Capture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured judge comments (checkbox codes + optional note) to the score entry form on both judge and tabulator pages.

**Architecture:** New `comment_data jsonb` column on `score_entries`. Comment codes and validation in pure `src/lib/comment-codes.ts`. Expandable comment row in the shared `ScoreEntryForm` component. Judge and tabulator pages pass `commentData` through their existing upsert paths.

**Tech Stack:** Supabase (Postgres migration), TypeScript, Next.js 15 (App Router), Vitest, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-15-comments-capture.md`

---

### Task 1: Create `comment_data` migration

**Files:**
- Create: `supabase/migrations/013_comment_data.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add structured comment data to score entries
-- New code writes to comment_data (jsonb). Legacy comments column stays for backward compatibility.
alter table score_entries add column comment_data jsonb;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/013_comment_data.sql
git commit -m "feat: add comment_data jsonb column to score_entries"
```

---

### Task 2: Create comment codes module + tests (TDD)

**Files:**
- Create: `src/lib/comment-codes.ts`
- Create: `tests/comment-codes.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/comment-codes.test.ts
import { describe, it, expect, vi } from 'vitest'
import {
  COMMENT_CODES,
  validateCommentData,
  hasCommentContent,
  type CommentData,
} from '@/lib/comment-codes'

describe('COMMENT_CODES', () => {
  it('contains the default code set', () => {
    const codes = COMMENT_CODES.map(c => c.code)
    expect(codes).toContain('turnout')
    expect(codes).toContain('timing')
    expect(codes).toContain('rhythm')
    expect(codes).toContain('posture')
    expect(codes).toContain('presentation')
    expect(codes).toContain('carriage')
    expect(codes).toHaveLength(6)
  })
})

describe('validateCommentData', () => {
  it('returns null when input is null', () => {
    expect(validateCommentData(null)).toBeNull()
  })

  it('returns null when codes empty and note blank', () => {
    expect(validateCommentData({ codes: [], note: '' })).toBeNull()
  })

  it('returns null when codes empty and note is whitespace', () => {
    expect(validateCommentData({ codes: [], note: '   ' })).toBeNull()
  })

  it('strips unknown codes, keeps valid ones', () => {
    const result = validateCommentData({
      codes: ['turnout', 'fake_code', 'timing'],
      note: null,
    })
    expect(result).toEqual({ codes: ['turnout', 'timing'], note: null })
  })

  it('returns null when all codes are unknown and note is blank', () => {
    expect(validateCommentData({ codes: ['bogus', 'nope'], note: null })).toBeNull()
  })

  it('trims note whitespace', () => {
    const result = validateCommentData({
      codes: ['posture'],
      note: '  Great improvement  ',
    })
    expect(result).toEqual({ codes: ['posture'], note: 'Great improvement' })
  })

  it('keeps note when codes are empty', () => {
    const result = validateCommentData({
      codes: [],
      note: 'Needs work on crossover',
    })
    expect(result).toEqual({ codes: [], note: 'Needs work on crossover' })
  })

  it('warns in dev when unknown codes are stripped', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    validateCommentData({ codes: ['turnout', 'bogus'], note: null })
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('bogus')
    )
    spy.mockRestore()
  })
})

describe('hasCommentContent', () => {
  it('returns false when both null', () => {
    expect(hasCommentContent(null, null)).toBe(false)
  })

  it('returns true when comment_data has codes', () => {
    expect(hasCommentContent({ codes: ['turnout'], note: null }, null)).toBe(true)
  })

  it('returns true when comment_data has only a note', () => {
    expect(hasCommentContent({ codes: [], note: 'Good' }, null)).toBe(true)
  })

  it('returns true when legacy comments text exists', () => {
    expect(hasCommentContent(null, 'Old comment')).toBe(true)
  })

  it('returns false when legacy comments is empty string', () => {
    expect(hasCommentContent(null, '')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/comment-codes.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/comment-codes.ts

/**
 * Comment codes and validation for judge feedback.
 * Pure functions — no Supabase, no React.
 */

export interface CommentData {
  codes: string[]
  note: string | null
}

export const COMMENT_CODES = [
  { code: 'turnout', label: 'Turnout' },
  { code: 'timing', label: 'Timing' },
  { code: 'rhythm', label: 'Rhythm' },
  { code: 'posture', label: 'Posture' },
  { code: 'presentation', label: 'Presentation' },
  { code: 'carriage', label: 'Carriage' },
] as const

const VALID_CODES = new Set(COMMENT_CODES.map(c => c.code))

/**
 * Validates and normalizes comment data before save.
 * Strips unknown codes, trims note, returns null if empty.
 */
export function validateCommentData(data: CommentData | null): CommentData | null {
  if (!data) return null

  const codes = data.codes.filter(c => {
    if (VALID_CODES.has(c)) return true
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`Unknown comment code stripped: "${c}"`)
    }
    return false
  })

  const note = data.note?.trim() || null

  if (codes.length === 0 && !note) return null

  return { codes, note }
}

/**
 * Checks whether any comment content exists (structured or legacy).
 * Used to show/hide the comment indicator in collapsed state.
 */
export function hasCommentContent(
  commentData: CommentData | null,
  legacyComments: string | null
): boolean {
  if (commentData && (commentData.codes.length > 0 || commentData.note)) return true
  if (legacyComments && legacyComments.trim().length > 0) return true
  return false
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/comment-codes.test.ts`

Expected: 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comment-codes.ts tests/comment-codes.test.ts
git commit -m "feat: add comment codes, validation, and display helpers with tests"
```

---

### Task 3: Add expandable comments to ScoreEntryForm

**Files:**
- Modify: `src/components/score-entry-form.tsx`

- [ ] **Step 1: Rewrite the score entry form**

Replace the entire content of `src/components/score-entry-form.tsx`. Key changes from the current version:

- Import `CommentData`, `COMMENT_CODES`, `hasCommentContent` from `@/lib/comment-codes`
- Add `existingCommentData?: CommentData | null` and `existingLegacyComments?: string | null` to props
- Update `onSubmit` signature to include `commentData: CommentData | null` as 5th parameter
- Add state: `commentsOpen` (boolean), `selectedCodes` (string[]), `commentNote` (string)
- Initialize from `existingCommentData` when provided
- **Collapsed state:** "Comments" text link after Save button. Dot indicator via `hasCommentContent`.
- **Expanded state:** Row of toggleable code chips (compact, squared) + 2-row textarea + "Saves with score" hint
- `handleSave` builds `CommentData | null` from `selectedCodes` + `commentNote`, passes to `onSubmit`
- All comment UI elements respect `locked` prop (disabled when true)

```tsx
'use client'

import { useState } from 'react'
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
      className={`flex flex-col p-3 rounded-md border transition-colors ${
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
            type="number"
            min={scoreMin}
            max={scoreMax}
            step="0.1"
            value={score}
            onChange={e => {
              setScore(e.target.value)
              setSaved(false)
            }}
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
                      : 'bg-gray-100 text-gray-600 border-gray-200 hover:border-gray-300'
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
          <p className="text-[10px] text-muted-foreground mt-1">Saves with score</p>
        </div>
      )}

      {saveError && <p className="text-xs text-destructive mt-1">{saveError}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`

Expected: Build will fail because judge page and tabulator page call `onSubmit` with 4 args, but the new signature expects 5. That's expected — we fix those in Tasks 4 and 5.

Actually, since `ScoreEntryForm` is the one calling `onSubmit` internally (not the pages calling it), the build should pass because the form now always passes 5 args to the callback. The pages define the callback with 4 params — TypeScript will warn but the extra arg is just ignored at runtime.

Run: `npm run build`

If build fails due to type mismatch on the `onSubmit` prop, proceed to Tasks 4 and 5 first, then circle back.

- [ ] **Step 3: Commit**

```bash
git add src/components/score-entry-form.tsx
git commit -m "feat: add expandable comments UI to score entry form"
```

---

### Task 4: Wire comments through judge page

**Files:**
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx`

- [ ] **Step 1: Import CommentData and validateCommentData**

Add after existing imports:

```ts
import { validateCommentData, type CommentData } from '@/lib/comment-codes'
```

- [ ] **Step 2: Update handleScoreSubmit signature (line 117)**

Change:
```ts
async function handleScoreSubmit(dancerId: string, score: number, flagged: boolean, flagReason: string | null) {
```

To:
```ts
async function handleScoreSubmit(dancerId: string, score: number, flagged: boolean, flagReason: string | null, commentData: CommentData | null) {
```

- [ ] **Step 3: Add comment_data to the upsert (approximately line 120-129)**

In the `.upsert()` call, add `comment_data` to the object:

After `entry_mode: 'judge_self_service',` add:
```ts
        comment_data: validateCommentData(commentData),
```

- [ ] **Step 4: Pass existing comment data to ScoreEntryForm (approximately line 310-320)**

Find where `ScoreEntryForm` is rendered. The `existing` variable is found via `scores.find(...)`. Add these props:

After `existingFlagReason={existing?.flag_reason}`:
```tsx
        existingCommentData={existing?.comment_data as CommentData | null | undefined}
        existingLegacyComments={existing?.comments as string | null | undefined}
```

- [ ] **Step 5: Verify build passes**

Run: `npm run build`

Expected: May still have type issues if tabulator page isn't updated yet. If clean, great.

- [ ] **Step 6: Commit**

```bash
git add "src/app/judge/[eventId]/[compId]/page.tsx"
git commit -m "feat: wire comment_data through judge score entry"
```

---

### Task 5: Wire comments through tabulator page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx`

- [ ] **Step 1: Import CommentData and validateCommentData**

Add after existing imports:

```ts
import { validateCommentData, type CommentData } from '@/lib/comment-codes'
```

- [ ] **Step 2: Update ScoreEntry interface (lines 40-46)**

Add two new fields to the `ScoreEntry` interface:

```ts
interface ScoreEntry {
  id: string
  dancer_id: string
  raw_score: number
  flagged: boolean
  flag_reason: string | null
  entry_mode: EntryMode
  comment_data: Record<string, unknown> | null
  comments: string | null
}
```

- [ ] **Step 3: Update the select query (line 133)**

Change:
```ts
      .select('id, dancer_id, raw_score, flagged, flag_reason, entry_mode')
```

To:
```ts
      .select('id, dancer_id, raw_score, flagged, flag_reason, entry_mode, comment_data, comments')
```

- [ ] **Step 4: Update handleScoreSubmit signature (line 171)**

Change:
```ts
  async function handleScoreSubmit(
    dancerId: string,
    score: number,
    flagged: boolean,
    flagReason: string | null
  ) {
```

To:
```ts
  async function handleScoreSubmit(
    dancerId: string,
    score: number,
    flagged: boolean,
    flagReason: string | null,
    commentData: CommentData | null
  ) {
```

- [ ] **Step 5: Add comment_data to the upsert (approximately line 180-189)**

In the `.upsert()` call, after `entry_mode: 'tabulator_transcription' as EntryMode,` add:
```ts
        comment_data: validateCommentData(commentData),
```

- [ ] **Step 6: Pass existing comment data to ScoreEntryForm (approximately line 327-339)**

In the `renderScoreEntry` function, add props after `existingFlagReason`:

```tsx
        existingCommentData={existing?.comment_data as CommentData | null | undefined}
        existingLegacyComments={existing?.comments as string | null | undefined}
```

- [ ] **Step 7: Verify build passes**

Run: `npm run build`

Expected: Clean build.

- [ ] **Step 8: Run full test suite**

Run: `npm test`

Expected: All tests pass (existing + 13 new comment-codes tests).

- [ ] **Step 9: Commit**

```bash
git add "src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx"
git commit -m "feat: wire comment_data through tabulator score entry"
```

---

### Task 6: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: Clean build.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: No new lint errors in changed files.

- [ ] **Step 4: Manual test — judge page**

1. Start dev server: `npm run dev`
2. Go to a judge page for any competition
3. Enter a score for a dancer
4. Click "Comments" → should expand chips + textarea
5. Select a few codes, write a note
6. Hit Save → should save successfully
7. Reload page → comments should persist (chips pre-selected, note populated)

- [ ] **Step 5: Manual test — tabulator page**

1. Go to a competition's tabulator page
2. Same flow: enter score, expand comments, select codes, save
3. Reload → verify persistence

- [ ] **Step 6: Manual test — locked state**

1. Sign off a round as a judge
2. Verify: score input disabled, save disabled, AND comment chips + textarea disabled

- [ ] **Step 7: Commit if any fixes needed**

```bash
git status
# Stage specific files
git commit -m "test: verify comments capture — all tests passing, build clean"
```
