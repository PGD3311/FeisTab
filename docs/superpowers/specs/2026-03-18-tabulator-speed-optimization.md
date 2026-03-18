# Tabulator Speed Optimization

**Date:** 2026-03-18
**Status:** Draft
**Goal:** Make tabulator score entry fast enough for real feis-day pressure — keyboard-first, linear, zero perceived latency between scores.

---

## Problem

The current tabulator page (`/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx`) does a synchronous DB round-trip on every score save:

1. Tabulator types score, presses Enter/Tab
2. `handleScoreSubmit()` → upsert to Supabase → `logAudit()`
3. `loadJudgeScores()` → re-fetches ALL scores for that judge
4. React re-renders entire list → `focusDancerId` updates → next input focuses

Focus does not advance until step 4 completes. On hotel/venue wifi, each score takes 0.5–2 seconds of dead time. For 30 dancers × 3 judges × 20 competitions, that's potentially hours of cumulative waiting across a feis day.

## Real-World Workflow

The tabulator sits with a stack of envelopes. Each envelope contains one judge's paper score sheet for one competition. They:

1. Open envelope, identify the judge
2. Read the sheet top-to-bottom (competitor-number order)
3. Type each score linearly: `75 Tab 82 Tab 68 Tab 91 Tab...`
4. Occasionally jump back to correct a row (illegible number, wrong competitor, etc.)
5. Sign off the judge's packet
6. Grab next envelope

**Primary mode:** Linear, keyboard-only, top-to-bottom.
**Fallback:** Click any row to correct, then resume linear flow.

## Design

### UI Layout

A vertical column of rows, one per active dancer, in competitor-number order:

```
[ 102 ]  Sienna Walsh       [ _____ ]
[ 105 ]  Maeve O'Brien      [ 75    ] ✓
[ 108 ]  Aoife Kelly         [ _____ ]  ← cursor here
[ 112 ]  Ciara Murphy        [ _____ ]
```

- **Competitor number:** large, monospace, primary visual anchor
- **Name:** smaller but always visible — sanity check against paper sheet
- **Score input:** single number field, no per-row Save button
- **Row status indicator:** subtle visual for save state (see Per-Row Status Model below)
- **No-show/scratched dancers:** shown as greyed-out rows (not editable, no input)

**Sticky bottom bar:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Judge: M. Brennan  ·  18/22 entered · All saved ✓
                                [ Sign Off ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Keyboard Flow

1. Page loads → first empty score input is auto-focused
2. Type score → press Tab or Enter
3. Focus advances immediately to the next empty input (from local state, no network wait)
4. Background save fires for the score just entered
5. Repeat until all dancers scored

**Correction flow:** Click any score input to jump to it. Edit the value, press Tab — focus advances from that point. Press Escape to return cursor to the next unscored row (where you left off).

### Per-Row Status Model

Each row has a `status` field that drives its visual state:

| Status | Meaning | Visual |
|--------|---------|--------|
| `empty` | No score entered yet | Default input styling |
| `dirty` | Score entered locally, not yet sent to DB | No special indicator (invisible to user — this is the "typing" state) |
| `saving` | DB upsert in flight | Subtle spinner or pulse on the row |
| `saved` | DB confirmed | Brief checkmark, then fades to muted row |
| `failed` | DB upsert failed | Red border on the input, row stays prominent |

Transitions:
- `empty` → `dirty` (user types a score)
- `dirty` → `saving` (Tab/Enter/blur triggers background save)
- `saving` → `saved` (DB confirms)
- `saving` → `failed` (DB error)
- `failed` → `dirty` (user edits the score to retry)
- `saved` → `dirty` (user clicks back to edit a previously saved score)

### Persistence Model

**Optimistic local state + background per-row saves.**

- All scores live in a single `useReducer` state array: `Array<{ dancerId, score, status, flagged, flagReason, commentData }>`
- On Tab/Enter/blur, the score is written to local state immediately (focus advances) AND a background save is dispatched
- Each save is an independent Supabase upsert (same `onConflict: 'round_id,dancer_id,judge_id'` as today)
- Audit logging fires alongside each save (non-blocking, same as today)
- Failed saves are retried on the next user interaction with that row, or via a "Retry failed" action in the sticky bar
- **Sign Off is disabled until all rows are `saved` or `empty`** — no unsaved or failed scores allowed

### Sign Off

Sign Off does exactly what it does today:
1. Lock all score entries (`locked_at` timestamp)
2. Record sign-off in round's `judge_sign_offs` JSONB
3. Check if all assigned judges have signed off → auto-advance competition status
4. Log audit entry

The only difference: by the time Sign Off runs, all scores are already persisted. It's a lock/validate/complete action, not a save action.

### What Changes vs. Current Code

| Current | New |
|---------|-----|
| `ScoreEntryForm` component per row, each with own state + Save button | Single parent component owns all score state via `useReducer` |
| Per-row Save button required | No per-row button — Tab/Enter/blur triggers save |
| `handleScoreSubmit` → DB upsert → `loadJudgeScores()` (full reload) → re-render | `handleScoreSubmit` → update local state (instant) → background upsert (no reload) |
| Focus advances after DB round-trip | Focus advances immediately from local state |
| `focusDancerId` computed from DB-fetched scores | `focusDancerId` computed from local state array |
| Full list re-render on every save | Only the changed row re-renders (status change) |

### What Does NOT Change

- The tabulator page URL and routing
- Judge selection dropdown
- Heat grouping display (if heats exist)
- Entry mode enforcement (`canEnterScores` check)
- Audit logging (same action types, same payloads)
- Sign-off logic and competition state machine transitions
- The `ScoreEntryForm` component's judge variant (untouched — this only changes the tabulator variant)
- Score validation rules (min/max from rule_sets)

### State Shape

```typescript
type RowStatus = 'empty' | 'dirty' | 'saving' | 'saved' | 'failed'

interface ScoreRow {
  dancerId: string
  dancerName: string
  competitorNumber: string
  registrationStatus: string  // present, no_show, scratched
  score: string               // string for input binding
  flagged: boolean
  flagReason: string | null
  commentData: CommentData | null
  status: RowStatus
  dbScore: number | null      // last confirmed DB value, for dirty detection
}

type ScoreAction =
  | { type: 'SET_SCORE'; dancerId: string; score: string }
  | { type: 'SET_FLAG'; dancerId: string; flagged: boolean; flagReason: string | null }
  | { type: 'SET_COMMENT'; dancerId: string; commentData: CommentData | null }
  | { type: 'MARK_SAVING'; dancerId: string }
  | { type: 'MARK_SAVED'; dancerId: string; dbScore: number }
  | { type: 'MARK_FAILED'; dancerId: string }
  | { type: 'LOAD_EXISTING'; rows: ScoreRow[] }
```

### Flag and Comment Handling

Flags and comments are secondary actions — the tabulator is mostly just blasting through scores. The design:

- Each row has a small toggle to expand flag/comment fields (same as current judge variant pattern)
- Expanding does NOT interrupt the Tab flow — the score input stays the primary tab target
- Flag/comment data is included in the background save for that row
- If the tabulator needs to flag a score, they click the row to expand, set the flag, then Tab to continue

### Error Handling

- **Single row save fails:** Row shows `failed` status (red border). Tabulator can keep entering other scores. Failed count shows in sticky bar.
- **Multiple rows fail (network down):** Sticky bar shows "5 unsaved ⚠" with a "Retry All" button. Sign Off remains disabled.
- **Browser crash/refresh:** Scores that were already `saved` are in the DB. Scores that were `dirty` or `saving` are lost — but the page reloads existing scores from DB on mount, so the tabulator sees what was persisted and can fill in the gaps. This is acceptable because saves fire on every Tab, so at most 1 score is lost.
- **Sign Off with failed rows:** Disabled. Sticky bar explains: "Fix or retry 3 failed scores before signing off."

### Testing Strategy

- **Unit tests (engine-level):** The reducer is a pure function — test all state transitions (empty→dirty→saving→saved, saving→failed, saved→dirty, etc.)
- **Unit tests (save logic):** Test that the background save function constructs the correct upsert payload
- **No new integration tests needed** — the Supabase upsert and sign-off logic are unchanged

### Files to Modify

1. **`src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx`** — Replace the current per-row ScoreEntryForm rendering with the new reducer-based batch entry UI
2. **`src/components/score-entry-form.tsx`** — No changes (judge variant is untouched; tabulator page will use its own inline row rendering instead of this component)

### Files to Create

1. **`src/lib/tabulator-state.ts`** — Pure reducer function + types for the score row state machine. No React, no Supabase — testable in isolation.
2. **`tests/engine/tabulator-state.test.ts`** — Unit tests for the reducer.

### Out of Scope

- Changes to the judge scoring variant
- Changes to the `ScoreEntryForm` component
- localStorage draft persistence (future enhancement — acceptable risk since saves fire per-row)
- Batch upsert (single rows are fine; Supabase handles individual upserts well)
- Offline support
