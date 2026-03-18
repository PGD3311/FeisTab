# Tabulator Speed Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tabulator score entry keyboard-first with zero perceived latency — type score, Tab, next row, no waiting for the network.

**Architecture:** Pure reducer in `src/lib/engine/tabulator-state.ts` owns all row state (score, flags, comments, save status). The tabulator page becomes a thin shell: loads data, dispatches reducer actions, renders inline rows, and handles background saves. Focus advances from local state, saves happen asynchronously per-row.

**Tech Stack:** TypeScript, React 19 useReducer, Supabase upsert, Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-tabulator-speed-optimization.md`

---

### Task 1: Reducer Types and Core State Machine

**Files:**
- Create: `src/lib/engine/tabulator-state.ts`
- Create: `tests/engine/tabulator-state.test.ts`

This is the pure-logic foundation. No React, no Supabase. Just types, a reducer function, and derived-value selectors.

- [ ] **Step 1: Write failing tests for reducer state transitions**

```typescript
// tests/engine/tabulator-state.test.ts
import { describe, it, expect } from 'vitest'
import {
  scoreReducer,
  buildInitialRows,
  type ScoreRow,
  type ScoreAction,
} from '@/lib/engine/tabulator-state'

function makeRow(overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    dancerId: 'd1',
    dancerName: 'Sienna Walsh',
    competitorNumber: '102',
    registrationStatus: 'present',
    score: '',
    flagged: false,
    flagReason: null,
    commentData: null,
    status: 'empty',
    dbScore: null,
    saveSeq: 0,
    ...overrides,
  }
}

describe('scoreReducer', () => {
  describe('SET_SCORE', () => {
    it('empty → dirty when user types a score', () => {
      const rows = [makeRow()]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '75' })
      expect(result[0].score).toBe('75')
      expect(result[0].status).toBe('dirty')
    })

    it('saved → dirty when user edits a saved score', () => {
      const rows = [makeRow({ status: 'saved', dbScore: 75, score: '75' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '80' })
      expect(result[0].status).toBe('dirty')
    })

    it('saved stays saved when edited back to dbScore value', () => {
      const rows = [makeRow({ status: 'saved', dbScore: 75, score: '80' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '75' })
      expect(result[0].status).toBe('saved')
    })

    it('failed → dirty when user edits a failed score', () => {
      const rows = [makeRow({ status: 'failed', score: '75', saveSeq: 1 })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '80' })
      expect(result[0].status).toBe('dirty')
    })

    it('dirty → saved when score is edited back to dbScore (no-op shortcut)', () => {
      const rows = [makeRow({ status: 'dirty', dbScore: 75, score: '80' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '75' })
      expect(result[0].status).toBe('saved')
    })

    it('dirty → empty when score is cleared and no dbScore exists', () => {
      const rows = [makeRow({ status: 'dirty', dbScore: null, score: '75' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '' })
      expect(result[0].status).toBe('empty')
    })

    it('dirty detection handles float coercion: "75.0" matches dbScore 75', () => {
      const rows = [makeRow({ status: 'dirty', dbScore: 75, score: '80' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '75.0' })
      expect(result[0].status).toBe('saved')
    })
  })

  describe('MARK_SAVING', () => {
    it('dirty → saving with saveSeq', () => {
      const rows = [makeRow({ status: 'dirty', score: '75' })]
      const result = scoreReducer(rows, { type: 'MARK_SAVING', dancerId: 'd1', saveSeq: 1 })
      expect(result[0].status).toBe('saving')
      expect(result[0].saveSeq).toBe(1)
    })
  })

  describe('MARK_SAVED', () => {
    it('saving → saved when saveSeq matches', () => {
      const rows = [makeRow({ status: 'saving', score: '75', saveSeq: 1 })]
      const result = scoreReducer(rows, { type: 'MARK_SAVED', dancerId: 'd1', dbScore: 75, saveSeq: 1 })
      expect(result[0].status).toBe('saved')
      expect(result[0].dbScore).toBe(75)
    })

    it('ignores stale MARK_SAVED when saveSeq does not match', () => {
      const rows = [makeRow({ status: 'saving', score: '80', saveSeq: 2 })]
      const result = scoreReducer(rows, { type: 'MARK_SAVED', dancerId: 'd1', dbScore: 75, saveSeq: 1 })
      expect(result[0].status).toBe('saving')
      expect(result[0].dbScore).toBeNull()
    })
  })

  describe('MARK_FAILED', () => {
    it('saving → failed when saveSeq matches', () => {
      const rows = [makeRow({ status: 'saving', score: '75', saveSeq: 1 })]
      const result = scoreReducer(rows, { type: 'MARK_FAILED', dancerId: 'd1', saveSeq: 1 })
      expect(result[0].status).toBe('failed')
    })

    it('ignores stale MARK_FAILED when saveSeq does not match', () => {
      const rows = [makeRow({ status: 'saving', score: '80', saveSeq: 2 })]
      const result = scoreReducer(rows, { type: 'MARK_FAILED', dancerId: 'd1', saveSeq: 1 })
      expect(result[0].status).toBe('saving')
    })
  })

  describe('SET_FLAG', () => {
    it('sets flagged and flagReason, marks dirty', () => {
      const rows = [makeRow({ status: 'saved', dbScore: 75, score: '75' })]
      const result = scoreReducer(rows, { type: 'SET_FLAG', dancerId: 'd1', flagged: true, flagReason: 'early_start' })
      expect(result[0].flagged).toBe(true)
      expect(result[0].flagReason).toBe('early_start')
      expect(result[0].status).toBe('dirty')
    })

    it('empty → dirty when flag is set (flag without score must be saveable)', () => {
      const rows = [makeRow({ status: 'empty' })]
      const result = scoreReducer(rows, { type: 'SET_FLAG', dancerId: 'd1', flagged: true, flagReason: 'early_start' })
      expect(result[0].status).toBe('dirty')
    })
  })

  describe('SET_COMMENT', () => {
    it('sets commentData and marks dirty', () => {
      const rows = [makeRow({ status: 'saved', dbScore: 75, score: '75' })]
      const result = scoreReducer(rows, { type: 'SET_COMMENT', dancerId: 'd1', commentData: { codes: ['turnout'], note: null } })
      expect(result[0].commentData).toEqual({ codes: ['turnout'], note: null })
      expect(result[0].status).toBe('dirty')
    })
  })

  describe('LOAD_EXISTING', () => {
    it('replaces entire state', () => {
      const oldRows = [makeRow({ dancerId: 'd1' })]
      const newRows = [makeRow({ dancerId: 'd2' }), makeRow({ dancerId: 'd3' })]
      const result = scoreReducer(oldRows, { type: 'LOAD_EXISTING', rows: newRows })
      expect(result).toHaveLength(2)
      expect(result[0].dancerId).toBe('d2')
    })
  })
})

describe('buildInitialRows', () => {
  it('marks rows with existing scores as saved', () => {
    const registrations = [
      { dancerId: 'd1', dancerName: 'A', competitorNumber: '101', registrationStatus: 'present' },
      { dancerId: 'd2', dancerName: 'B', competitorNumber: '102', registrationStatus: 'present' },
    ]
    const existingScores = [
      { dancerId: 'd1', rawScore: 75, flagged: false, flagReason: null, commentData: null },
    ]
    const rows = buildInitialRows(registrations, existingScores)
    expect(rows[0].status).toBe('saved')
    expect(rows[0].dbScore).toBe(75)
    expect(rows[0].score).toBe('75')
    expect(rows[1].status).toBe('empty')
    expect(rows[1].dbScore).toBeNull()
  })

  it('includes non-active registrations with empty status', () => {
    const registrations = [
      { dancerId: 'd1', dancerName: 'A', competitorNumber: '101', registrationStatus: 'scratched' },
    ]
    const rows = buildInitialRows(registrations, [])
    expect(rows[0].registrationStatus).toBe('scratched')
    expect(rows[0].status).toBe('empty')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/tabulator-state.test.ts`
Expected: FAIL — module `@/lib/engine/tabulator-state` not found

- [ ] **Step 3: Implement the reducer, types, and buildInitialRows**

```typescript
// src/lib/engine/tabulator-state.ts
import { type CommentData } from '@/lib/comment-codes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RowStatus = 'empty' | 'dirty' | 'saving' | 'saved' | 'failed'

export interface ScoreRow {
  dancerId: string
  dancerName: string
  competitorNumber: string
  registrationStatus: string
  score: string
  flagged: boolean
  flagReason: string | null
  commentData: CommentData | null
  status: RowStatus
  dbScore: number | null
  saveSeq: number
}

export type ScoreAction =
  | { type: 'SET_SCORE'; dancerId: string; score: string }
  | { type: 'SET_FLAG'; dancerId: string; flagged: boolean; flagReason: string | null }
  | { type: 'SET_COMMENT'; dancerId: string; commentData: CommentData | null }
  | { type: 'MARK_SAVING'; dancerId: string; saveSeq: number }
  | { type: 'MARK_SAVED'; dancerId: string; dbScore: number; saveSeq: number }
  | { type: 'MARK_FAILED'; dancerId: string; saveSeq: number }
  | { type: 'LOAD_EXISTING'; rows: ScoreRow[] }

// ---------------------------------------------------------------------------
// Derived selectors (compute from rows, never store)
// ---------------------------------------------------------------------------

const NON_ACTIVE = new Set(['scratched', 'no_show', 'disqualified', 'did_not_complete', 'medical'])

export function isEditable(row: ScoreRow): boolean {
  return !NON_ACTIVE.has(row.registrationStatus)
}

export function getEditableRows(rows: ScoreRow[]): ScoreRow[] {
  return rows.filter(isEditable)
}

export function getEnteredCount(rows: ScoreRow[]): number {
  return rows.filter(r => isEditable(r) && r.score !== '').length
}

export function getActiveTotal(rows: ScoreRow[]): number {
  return rows.filter(isEditable).length
}

export function getFailedCount(rows: ScoreRow[]): number {
  return rows.filter(r => r.status === 'failed').length
}

export function getFirstEmptyEditableId(rows: ScoreRow[]): string | null {
  return rows.find(r => isEditable(r) && r.status === 'empty')?.dancerId ?? null
}

export function canSignOff(rows: ScoreRow[]): boolean {
  const editable = getEditableRows(rows)
  if (editable.length === 0) return false
  return editable.every(r => r.status === 'saved' || r.status === 'empty')
    && editable.some(r => r.status === 'saved')
}

export function allSaved(rows: ScoreRow[]): boolean {
  const editable = getEditableRows(rows)
  return editable.length > 0 && editable.every(r => r.status === 'saved' || r.status === 'empty')
}

// ---------------------------------------------------------------------------
// Dirty detection
// ---------------------------------------------------------------------------

function isDirtyScore(score: string, dbScore: number | null): boolean {
  if (dbScore === null) return score !== ''
  const parsed = parseFloat(score)
  if (isNaN(parsed)) return true
  return parsed !== dbScore
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function updateRow(rows: ScoreRow[], dancerId: string, updater: (row: ScoreRow) => ScoreRow): ScoreRow[] {
  return rows.map(r => r.dancerId === dancerId ? updater(r) : r)
}

export function scoreReducer(state: ScoreRow[], action: ScoreAction): ScoreRow[] {
  switch (action.type) {
    case 'SET_SCORE':
      return updateRow(state, action.dancerId, (row) => {
        const newScore = action.score
        const dirty = isDirtyScore(newScore, row.dbScore)
        return {
          ...row,
          score: newScore,
          status: newScore === '' && row.dbScore === null
            ? 'empty'
            : dirty
              ? 'dirty'
              : 'saved',
        }
      })

    case 'SET_FLAG':
      return updateRow(state, action.dancerId, (row) => ({
        ...row,
        flagged: action.flagged,
        flagReason: action.flagReason,
        status: 'dirty',
      }))

    case 'SET_COMMENT':
      return updateRow(state, action.dancerId, (row) => ({
        ...row,
        commentData: action.commentData,
        status: 'dirty',
      }))

    case 'MARK_SAVING':
      return updateRow(state, action.dancerId, (row) => ({
        ...row,
        status: 'saving',
        saveSeq: action.saveSeq,
      }))

    case 'MARK_SAVED':
      return updateRow(state, action.dancerId, (row) => {
        if (row.saveSeq !== action.saveSeq) return row
        return { ...row, status: 'saved', dbScore: action.dbScore }
      })

    case 'MARK_FAILED':
      return updateRow(state, action.dancerId, (row) => {
        if (row.saveSeq !== action.saveSeq) return row
        return { ...row, status: 'failed' }
      })

    case 'LOAD_EXISTING':
      return action.rows

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Initial row builder
// ---------------------------------------------------------------------------

interface RegistrationInput {
  dancerId: string
  dancerName: string
  competitorNumber: string
  registrationStatus: string
}

interface ExistingScore {
  dancerId: string
  rawScore: number
  flagged: boolean
  flagReason: string | null
  commentData: CommentData | null
}

export function buildInitialRows(
  registrations: RegistrationInput[],
  existingScores: ExistingScore[]
): ScoreRow[] {
  const scoreMap = new Map(existingScores.map(s => [s.dancerId, s]))
  return registrations.map((reg): ScoreRow => {
    const existing = scoreMap.get(reg.dancerId)
    if (existing) {
      return {
        dancerId: reg.dancerId,
        dancerName: reg.dancerName,
        competitorNumber: reg.competitorNumber,
        registrationStatus: reg.registrationStatus,
        score: String(existing.rawScore),
        flagged: existing.flagged,
        flagReason: existing.flagReason,
        commentData: existing.commentData,
        status: 'saved',
        dbScore: existing.rawScore,
        saveSeq: 0,
      }
    }
    return {
      dancerId: reg.dancerId,
      dancerName: reg.dancerName,
      competitorNumber: reg.competitorNumber,
      registrationStatus: reg.registrationStatus,
      score: '',
      flagged: false,
      flagReason: null,
      commentData: null,
      status: 'empty',
      dbScore: null,
      saveSeq: 0,
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/tabulator-state.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/tabulator-state.ts tests/engine/tabulator-state.test.ts
git commit -m "feat: add pure reducer and selectors for tabulator score state"
```

---

### Task 2: Selector Tests

**Files:**
- Modify: `tests/engine/tabulator-state.test.ts`

Test the derived-value selectors to ensure progress counting, sign-off gating, and focus logic work correctly.

- [ ] **Step 1: Write failing tests for selectors**

Add to `tests/engine/tabulator-state.test.ts`:

```typescript
import {
  // ...existing imports...
  isEditable,
  getEnteredCount,
  getActiveTotal,
  getFailedCount,
  getFirstEmptyEditableId,
  canSignOff,
  allSaved,
} from '@/lib/engine/tabulator-state'

describe('selectors', () => {
  it('isEditable returns false for non-active statuses', () => {
    expect(isEditable(makeRow({ registrationStatus: 'scratched' }))).toBe(false)
    expect(isEditable(makeRow({ registrationStatus: 'no_show' }))).toBe(false)
    expect(isEditable(makeRow({ registrationStatus: 'present' }))).toBe(true)
    expect(isEditable(makeRow({ registrationStatus: 'checked_in' }))).toBe(true)
  })

  it('getEnteredCount counts only editable rows with scores', () => {
    const rows = [
      makeRow({ dancerId: 'd1', score: '75', registrationStatus: 'present' }),
      makeRow({ dancerId: 'd2', score: '', registrationStatus: 'present' }),
      makeRow({ dancerId: 'd3', score: '80', registrationStatus: 'scratched' }),
    ]
    expect(getEnteredCount(rows)).toBe(1)
  })

  it('getActiveTotal counts only editable rows', () => {
    const rows = [
      makeRow({ registrationStatus: 'present' }),
      makeRow({ registrationStatus: 'scratched' }),
      makeRow({ registrationStatus: 'present' }),
    ]
    expect(getActiveTotal(rows)).toBe(2)
  })

  it('getFailedCount counts failed rows', () => {
    const rows = [
      makeRow({ status: 'failed' }),
      makeRow({ status: 'saved' }),
      makeRow({ status: 'failed' }),
    ]
    expect(getFailedCount(rows)).toBe(2)
  })

  it('getFirstEmptyEditableId skips non-editable and non-empty rows', () => {
    const rows = [
      makeRow({ dancerId: 'd1', status: 'saved', registrationStatus: 'present' }),
      makeRow({ dancerId: 'd2', status: 'empty', registrationStatus: 'scratched' }),
      makeRow({ dancerId: 'd3', status: 'empty', registrationStatus: 'present' }),
    ]
    expect(getFirstEmptyEditableId(rows)).toBe('d3')
  })

  it('canSignOff requires all editable rows saved or empty, with at least one saved', () => {
    expect(canSignOff([
      makeRow({ status: 'saved' }),
      makeRow({ status: 'saved' }),
    ])).toBe(true)

    expect(canSignOff([
      makeRow({ status: 'saved' }),
      makeRow({ status: 'failed' }),
    ])).toBe(false)

    expect(canSignOff([
      makeRow({ status: 'empty' }),
      makeRow({ status: 'empty' }),
    ])).toBe(false)
  })

  it('allSaved is true when all editable rows are saved or empty', () => {
    expect(allSaved([
      makeRow({ status: 'saved' }),
      makeRow({ status: 'empty' }),
      makeRow({ status: 'saved', registrationStatus: 'scratched' }),
    ])).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/engine/tabulator-state.test.ts`
Expected: ALL PASS (selectors are already implemented in Task 1)

- [ ] **Step 3: Commit**

```bash
git add tests/engine/tabulator-state.test.ts
git commit -m "test: add selector tests for tabulator state"
```

---

### Task 3: Rewrite Tabulator Page — Data Loading and Reducer Wiring

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx`

Replace the current `useState`-based score management with the reducer. Keep the existing `loadBase()` and judge selection logic. Replace `loadJudgeScores()` to dispatch `LOAD_EXISTING`. Remove the `ScoreEntryForm` import — this page will render its own inline rows in the next task.

- [ ] **Step 1: Replace state management with reducer**

Rewrite the page. Key changes:
- Replace `const [scores, setScores] = useState<ScoreEntry[]>([])` and `const [focusDancerId, setFocusDancerId]` with `useReducer(scoreReducer, [])` from `@/lib/engine/tabulator-state`
- Replace `loadJudgeScores()` to build initial rows via `buildInitialRows()` and dispatch `LOAD_EXISTING`
- `canEnterScores` check runs before dispatching `LOAD_EXISTING` — if blocked, show packet-blocked UI as before
- Replace derived values (`scoredCount`, `totalDancers`, `activeDancers`, etc.) with selector calls from `tabulator-state.ts`
- Remove `ScoreEntryForm` import
- Keep: `loadBase()`, judge selector dropdown, error/loading/canScore/round-check UI, sign-off logic (updated in Task 5)
- Temporarily render a placeholder `<div>Score entry rows go here</div>` where the score list goes — Task 4 builds the actual rows

**Critical: `saveRow()` implementation.** This replaces `handleScoreSubmit()`. Add a `saveSeqRef = useRef(0)` to generate monotonic sequence numbers.

```typescript
const saveSeqRef = useRef(0)

function saveRow(dancerId: string) {
  const row = rows.find(r => r.dancerId === dancerId)
  if (!row || (row.status !== 'dirty' && row.status !== 'failed') || !round || !selectedJudgeId) return

  const num = parseFloat(row.score)
  if (isNaN(num) || num < scoreMin || num > scoreMax) return

  const seq = ++saveSeqRef.current
  dispatch({ type: 'MARK_SAVING', dancerId, saveSeq: seq })

  // Background upsert — not awaited in the keyboard flow
  supabase.from('score_entries').upsert(
    {
      round_id: round.id,
      competition_id: compId,
      dancer_id: dancerId,
      judge_id: selectedJudgeId,
      raw_score: num,
      flagged: row.flagged,
      flag_reason: row.flagged ? row.flagReason : null,
      entry_mode: 'tabulator_transcription' as EntryMode,
      comment_data: validateCommentData(row.commentData),
    },
    { onConflict: 'round_id,dancer_id,judge_id' }
  ).then(({ error: upsertErr }) => {
    if (upsertErr) {
      dispatch({ type: 'MARK_FAILED', dancerId, saveSeq: seq })
    } else {
      dispatch({ type: 'MARK_SAVED', dancerId, dbScore: num, saveSeq: seq })
    }
  })

  // Audit is fire-and-forget — never affects row status
  void logAudit(supabase, {
    userId: null,
    entityType: 'score_entry',
    entityId: compId,
    action: 'score_transcribe',
    afterData: {
      dancer_id: dancerId,
      judge_id: selectedJudgeId,
      raw_score: num,
      flagged: row.flagged,
      entry_mode: 'tabulator_transcription',
    },
  })
}
```

Note: `saveRow()` early-returns if status is not `dirty` or `failed`. This means:
- If Tab fires on an already-saved row, no network call happens
- If a failed row is re-entered and the user presses Tab without changing the score, the save retries automatically (the `failed` status triggers a re-save with current local data)

- [ ] **Step 2: Verify the page compiles**

Run: `npm run build`
Expected: Build succeeds (page renders judge selector + placeholder)

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx
git commit -m "refactor: wire tabulator page to useReducer with background saves"
```

---

### Task 4: Inline Score Row Rendering with Keyboard Flow

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx`

Replace the placeholder with the actual inline score rows. This is the core UX: competitor number, name, score input, status indicator, and the keyboard navigation logic.

- [ ] **Step 1: Implement the inline score row and keyboard handling**

Build the rendering directly in the tabulator page (not a separate component — keeps all state co-located). Key elements per row:

- Competitor number: `font-mono text-2xl font-bold text-feis-green`
- Name: `text-sm text-muted-foreground`
- Score input: `type="number"`, `min`/`max` from rule config, `font-mono text-2xl text-center h-12`
- Status indicator: checkmark for saved, red border for failed, subtle pulse for saving
- Non-editable rows (scratched/no_show): greyed out, no input, line-through number

**Critical: Focus management and save dedup.** These refs live at the page component level:

```typescript
// One ref per editable row's <input>, keyed by dancerId
const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

// Tracks dancer IDs whose save was triggered by keydown (not blur)
const savedByKeydownRef = useRef<Set<string>>(new Set())

// Ordered list of editable dancer IDs for Tab/Shift+Tab navigation
const editableIds = useMemo(
  () => rows.filter(r => isEditable(r)).map(r => r.dancerId),
  [rows]
)

function focusDancer(dancerId: string | null) {
  if (!dancerId) return
  inputRefs.current.get(dancerId)?.focus()
}

function getNextEditableId(currentId: string): string | null {
  const idx = editableIds.indexOf(currentId)
  return idx >= 0 && idx < editableIds.length - 1 ? editableIds[idx + 1] : null
}

function getPrevEditableId(currentId: string): string | null {
  const idx = editableIds.indexOf(currentId)
  return idx > 0 ? editableIds[idx - 1] : null
}
```

**Critical: `onKeyDown` handler per score input:**

```typescript
function handleKeyDown(e: React.KeyboardEvent, dancerId: string) {
  if (e.key === 'Tab' && !e.shiftKey || e.key === 'Enter') {
    e.preventDefault()
    // Save fires on keydown; mark to prevent blur double-fire
    savedByKeydownRef.current.add(dancerId)
    saveRow(dancerId)
    focusDancer(getNextEditableId(dancerId))
  } else if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault()
    savedByKeydownRef.current.add(dancerId)
    saveRow(dancerId)
    focusDancer(getPrevEditableId(dancerId))
  } else if (e.key === 'Escape') {
    e.preventDefault()
    focusDancer(getFirstEmptyEditableId(rows))
  }
}
```

**Critical: `onBlur` handler — save dedup:**

```typescript
function handleBlur(dancerId: string) {
  if (savedByKeydownRef.current.has(dancerId)) {
    // Keydown already triggered save — don't double-fire
    savedByKeydownRef.current.delete(dancerId)
    return
  }
  // Click-away blur — save if dirty
  saveRow(dancerId)
}
```

**Heat collapse rule:** When rendering heat groups, only collapse a heat if every active row in that heat has `status === 'saved'` or `status === 'empty'`. If any row is `failed`, the heat stays expanded. Read status from the `ScoreRow` array, not from `scoredDancerIds` (which no longer exists).

```typescript
const canCollapseHeat = (heatDancerIds: Set<string>) => {
  return rows
    .filter(r => heatDancerIds.has(r.dancerId) && isEditable(r))
    .every(r => r.status === 'saved' || r.status === 'empty')
}
```

Auto-focus: after `LOAD_EXISTING` dispatch, use a `useEffect` that calls `focusDancer(getFirstEmptyEditableId(rows))`.

- [ ] **Step 2: Verify the page renders and keyboard flow works**

Run: `npm run build`
Expected: Build succeeds

Manual verification: `npm run dev`, navigate to a tabulator page, select a judge, verify:
- Score inputs render in competitor-number order
- Tab advances to next input
- Enter advances to next input
- Shift+Tab goes back
- Escape jumps to first empty row
- Non-active dancers are greyed out and skipped by Tab

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx
git commit -m "feat: implement keyboard-first inline score rows with Tab/Enter flow"
```

---

### Task 5: Sticky Bar, Sign Off with Server Revalidation, and Retry All

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx`

- [ ] **Step 1: Implement the sticky bottom bar**

Fixed at bottom of viewport. Shows:
- Judge name
- Progress: `{enteredCount}/{activeTotal} entered`
- Save state: "All saved" (green check) / "Saving..." / "{failedCount} unsaved" (warning icon + "Retry All" button)
- Sign Off button (disabled unless `canSignOff(rows)` returns true)

"Retry All" processes failed rows sequentially: iterate `rows.filter(r => r.status === 'failed')`, call `saveRow()` for each with an `await` between them.

- [ ] **Step 2: Implement server-side revalidation in handleSignOff**

Before locking, the sign-off handler:
1. Re-fetch score entries for this judge+round from DB
2. Compare: DB score count must equal `getEnteredCount(rows)` (local saved rows with scores). Also verify no active dancer is missing a DB score entry — handles the case where an organizer scratched a dancer after the tabulator entered scores.
3. Re-fetch competition status to verify it's in `in_progress` or `awaiting_scores` (still valid for sign-off)
4. If mismatch → `showCritical('Sign-off blocked: data changed since you started entering scores. Refresh and verify.')`, abort
5. If clean → proceed with the existing lock + sign-off + auto-advance logic (unchanged from current code)

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx
git commit -m "feat: add sticky progress bar, Retry All, and server-validated sign-off"
```

---

### Task 6: Flag and Comment Expand/Collapse Per Row

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx`

- [ ] **Step 1: Add expandable flag/comment panel per row**

Each row gets a small clickable area (the competitor number or a "notes" label) that toggles an expanded panel below the score input. The expanded panel contains:
- Flag checkbox + reason dropdown (same options as `ScoreEntryForm`: early_start, did_not_complete, other)
- Comment code toggle buttons (from `COMMENT_CODES` in `@/lib/comment-codes`)
- Optional note textarea

Changes dispatch `SET_FLAG` or `SET_COMMENT` to the reducer, which marks the row dirty. The background save includes flag/comment data.

The score input remains the primary Tab target — expanding the panel does NOT shift Tab order. Tab from the score input always goes to the next row's score input, never into the flag/comment fields.

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx
git commit -m "feat: add expandable flag and comment panel per score row"
```

---

### Task 7: Full Build Verification and Existing Tests

**Files:** None modified — verification only.

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing 207 + new tabulator-state tests)

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Final commit if any formatting fixes needed**

```bash
git add -A
git commit -m "fix: formatting and lint fixes"
```
