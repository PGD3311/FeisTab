# Comments / Marks Capture

**Date:** 2026-03-15
**Goal:** Add structured judge comments (checkbox codes + optional note) to score entry. Layer A of the comments system — capture only, output (comment sheets) comes later.
**Truth test questions addressed:** Part of #18 (result explainability — comments are part of what parents receive)

---

## Problem

Judges give feedback on every dancer — checkbox codes for common topics (turnout, timing, posture) plus written notes. This is a core part of the feis workflow: parents pay for feedback, not just placements. The `score_entries` table has a `comments` text column that has never been wired to any UI. Scores are captured, comments are not.

---

## Design

### Data Model

**New column:** `comment_data jsonb` on `score_entries` (nullable). Migration `013_comment_data.sql`.

**Shape:**
```ts
type CommentData = {
  codes: string[]    // e.g. ["turnout", "timing"]
  note: string | null // e.g. "Great improvement on crossover"
}
```

**Write rules:**
- Only write `comment_data` when at least one code or a note exists. Otherwise store `null`.
- Validate before save: strip unknown codes (warn in dev console), trim note, return `null` if empty after normalization.
- New code writes to `comment_data` only. Never write to the legacy `comments` column.

**Read rules:**
- Read `comment_data` if present.
- Fall back to legacy `comments` text for old rows — display as read-only note (no code chips, since legacy data has no structure).
- Legacy text is not migrated on edit. If user adds structured comments, `comment_data` becomes the source. Legacy `comments` stays untouched.

**Existing `comments` column stays** — backward compatibility.

### Comment Codes

Defined in `src/lib/comment-codes.ts`. Pure module, no DB dependency.

```ts
export const COMMENT_CODES = [
  { code: 'turnout', label: 'Turnout' },
  { code: 'timing', label: 'Timing' },
  { code: 'rhythm', label: 'Rhythm' },
  { code: 'posture', label: 'Posture' },
  { code: 'presentation', label: 'Presentation' },
  { code: 'carriage', label: 'Carriage' },
] as const
```

These are **neutral topic labels** — the checkbox means "I have feedback about this topic." Good or bad is conveyed by the optional note or the parent's conversation with their teacher.

**Validation:** Only codes from `COMMENT_CODES` are allowed. Unknown codes are stripped on write (with `console.warn` in development). This prevents typo sludge.

**Future:** The code set can be made configurable per event later. The `comment_data` JSONB shape supports this without migration — just change what codes the UI offers.

### Score Entry Form Changes

**Component:** `src/components/score-entry-form.tsx`

**Pattern:** Expandable row. Score entry stays compact by default. Comments expand below.

**Collapsed state:**
- Small "Comments" text link after the save button
- If comments exist (any codes or note): show a subtle dot indicator next to "Comments"
- No raw count — just presence/absence

**Expanded state:**
- Row of toggleable code chips. Compact, squared/lightly-rounded (utility style, not pill-shaped). Tap to select/deselect.
- Selected: `bg-feis-green-light text-feis-green border-feis-green/40`
- Unselected: `bg-gray-100 text-gray-600 border-gray-200`
- Below chips: small 2-row `textarea` for optional note, placeholder "Optional note..."
- Hint text: "Saves with score" in muted small text — so users know toggling chips doesn't auto-save

**Comments are saved as part of the existing Save action.** No separate save button for comments.

**`onSubmit` signature change:**
```ts
// Current:
onSubmit: (dancerId: string, score: number, flagged: boolean, flagReason: string | null) => Promise<void>

// New:
onSubmit: (dancerId: string, score: number, flagged: boolean, flagReason: string | null, commentData: CommentData | null) => Promise<void>
```

**New prop:** `existingCommentData?: CommentData | null` — pre-populates chips and note when editing an existing score.

### Data Flow

**Write path (judge page + tabulator page):**
1. Judge enters score, optionally expands comments, selects codes, writes note
2. Hits Save → `onSubmit(dancerId, score, flagged, flagReason, commentData)`
3. `commentData` passes through `validateCommentData()` before upsert
4. Page handler upserts `score_entries` with existing fields + `comment_data`

**Read path:**
1. Page loads `score_entries` selecting both `comment_data` and `comments`
2. Passes `existingCommentData` to `ScoreEntryForm`
3. Form pre-populates chips and note from existing structured data
4. If `comment_data` is null but `comments` text exists, display legacy text as read-only note

**Both entry modes** (judge self-service + tabulator transcription) get comments via the shared `ScoreEntryForm` component.

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/013_comment_data.sql` | Add `comment_data jsonb` column |
| Create | `src/lib/comment-codes.ts` | Code definitions, types, validation helper |
| Modify | `src/components/score-entry-form.tsx` | Add expandable comments UI |
| Modify | `src/app/judge/[eventId]/[compId]/page.tsx` | Pass `commentData` through score upsert, select `comment_data` on load |
| Modify | `src/app/dashboard/.../tabulator/page.tsx` | Same — pass `commentData` through upsert, select on load |

---

## Testing

**`validateCommentData`:**
- Returns `null` when input is `null`
- Returns `null` when codes empty and note blank after trim
- Strips unknown codes, keeps valid ones
- Trims note whitespace
- Returns `null` when all codes were unknown and note is blank

**`getCommentIndicator` (display state helper):**
- Returns `false` when no `comment_data` and no legacy `comments`
- Returns `true` when `comment_data` has codes
- Returns `true` when `comment_data` has only a note
- Returns `true` when legacy `comments` text exists

**No UI tests** — manual testing per project convention.

---

## What This Does NOT Include

- Comment sheet output (Layer B — printable per-dancer summary)
- Per-event configurable comment codes
- Comment-level audit trail
- Comments in tabulation results or result explainability view
- Comments in the anomaly detection engine

---

## Acceptance Criteria

1. Judge and tabulator score entry forms show expandable "Comments" toggle
2. Expanded area shows code chips + textarea for note
3. Selected codes persist when score is saved
4. Re-opening comments on an existing score shows previously saved codes and note
5. Empty comments (no codes, no note) store `null` in `comment_data`
6. Unknown codes are stripped before save
7. Legacy `comments` text displays as read-only note when no `comment_data` exists
8. `comment_data` column exists as `jsonb` on `score_entries`
9. Both judge self-service and tabulator transcription modes support comments
