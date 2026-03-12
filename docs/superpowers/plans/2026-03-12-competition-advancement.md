# Competition Advancement Flow — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer advance a competition from `imported` to `awaiting_scores` via UI buttons — no DB hacking, no developer intervention.

**Architecture:** Add pure transition label + prerequisite helpers to `competition-states.ts` (tested), then add an advancement card to the competition detail page that shows the next valid action with contextual blocking messages. The `in_progress → awaiting_scores` transition auto-creates Round 1 if no rounds exist. Existing action buttons (Tabulate, Recalls, Publish) already handle later transitions — this plan only adds the missing early-flow buttons.

**Tech Stack:** Next.js 15 (App Router), Supabase, TypeScript, Tailwind, shadcn/ui v4, Vitest

**Design decisions:**
- Transition labels and block-reason logic are **pure functions** in `competition-states.ts` — no Supabase imports, fully testable.
- Block reasons take a simple context object (`{ registrationCount, judgeCount, roundCount }`) so the page just passes numbers.
- `awaiting_scores → ready_to_tabulate` is NOT a button — it triggers automatically when all judges sign off. No operator button needed.
- Later transitions (`ready_to_tabulate → complete_unpublished`, etc.) are already handled by existing Tabulate/Recalls/Publish buttons. This plan does not touch those.

---

## Transition Design

### Operator-driven transitions (what this plan adds)

| From | To | Button Label | Prerequisite | Block Message |
|------|-----|-------------|--------------|---------------|
| `imported` | `ready_for_day_of` | Mark Ready for Day-Of | Has registrations | Import dancers before advancing |
| `ready_for_day_of` | `in_progress` | Start Competition | Has judges assigned | Assign judges before starting |
| `in_progress` | `awaiting_scores` | Open for Scoring | None (creates Round 1 if needed) | — |

### Automatic / existing transitions (NOT touched by this plan)

| From | To | Trigger |
|------|-----|---------|
| `awaiting_scores` | `ready_to_tabulate` | All judges sign off (automatic) |
| `ready_to_tabulate` | `complete_unpublished` | "Run Tabulation" button (existing) |
| `ready_to_tabulate` | `recalled_round_pending` | "Generate Recalls" button (existing) |
| `complete_unpublished` | `published` | "Publish Results" button (existing) |

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/competition-states.ts` | Add `getTransitionLabel()`, `getTransitionBlockReason()` |
| Modify | `tests/competition-states.test.ts` | Tests for new helpers |
| Modify | `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Add advancement card with buttons |

---

## Chunk 1: Pure Logic (TDD)

### Task 1: Add transition labels and block-reason helper (TDD)

**Files:**
- Modify: `src/lib/competition-states.ts`
- Modify: `tests/competition-states.test.ts`

- [ ] **Step 1: Write failing tests**

Add the following tests to `tests/competition-states.test.ts`:

```ts
import {
  canTransition,
  getNextStates,
  getTransitionLabel,
  getTransitionBlockReason,
  type CompetitionStatus,
  type TransitionContext,
} from '@/lib/competition-states'

// ... existing tests ...

describe('getTransitionLabel', () => {
  it('returns label for imported -> ready_for_day_of', () => {
    expect(getTransitionLabel('imported', 'ready_for_day_of')).toBe('Mark Ready for Day-Of')
  })

  it('returns label for ready_for_day_of -> in_progress', () => {
    expect(getTransitionLabel('ready_for_day_of', 'in_progress')).toBe('Start Competition')
  })

  it('returns label for in_progress -> awaiting_scores', () => {
    expect(getTransitionLabel('in_progress', 'awaiting_scores')).toBe('Open for Scoring')
  })

  it('returns label for complete_unpublished -> published', () => {
    expect(getTransitionLabel('complete_unpublished', 'published')).toBe('Publish Results')
  })

  it('returns generic label for unmapped transitions', () => {
    expect(getTransitionLabel('published', 'locked')).toBe('Advance to Locked')
  })
})

describe('getTransitionBlockReason', () => {
  const fullContext: TransitionContext = {
    registrationCount: 10,
    judgeCount: 3,
    roundCount: 1,
  }

  it('returns null when all prerequisites met', () => {
    expect(getTransitionBlockReason('imported', 'ready_for_day_of', fullContext)).toBeNull()
  })

  it('blocks imported -> ready_for_day_of without registrations', () => {
    const ctx = { ...fullContext, registrationCount: 0 }
    expect(getTransitionBlockReason('imported', 'ready_for_day_of', ctx)).toBe(
      'Import dancers before advancing'
    )
  })

  it('blocks ready_for_day_of -> in_progress without judges', () => {
    const ctx = { ...fullContext, judgeCount: 0 }
    expect(getTransitionBlockReason('ready_for_day_of', 'in_progress', ctx)).toBe(
      'Assign judges before starting'
    )
  })

  it('allows in_progress -> awaiting_scores with no rounds', () => {
    const ctx = { ...fullContext, roundCount: 0 }
    expect(getTransitionBlockReason('in_progress', 'awaiting_scores', ctx)).toBeNull()
  })

  it('returns null for transitions with no prerequisites', () => {
    expect(getTransitionBlockReason('complete_unpublished', 'published', fullContext)).toBeNull()
  })

  it('returns null for invalid transitions (canTransition handles that)', () => {
    expect(getTransitionBlockReason('draft', 'published', fullContext)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/competition-states.test.ts`
Expected: FAIL — `getTransitionLabel` and `getTransitionBlockReason` are not exported

- [ ] **Step 3: Implement the helpers**

Add the following to `src/lib/competition-states.ts` after the existing code:

```ts
/** Human-readable labels for operator-facing transition buttons */
const transitionLabels: Partial<Record<string, string>> = {
  'imported→ready_for_day_of': 'Mark Ready for Day-Of',
  'ready_for_day_of→in_progress': 'Start Competition',
  'in_progress→awaiting_scores': 'Open for Scoring',
  'ready_to_tabulate→complete_unpublished': 'Run Tabulation',
  'ready_to_tabulate→recalled_round_pending': 'Generate Recalls',
  'complete_unpublished→published': 'Publish Results',
  'published→complete_unpublished': 'Unpublish',
  'published→locked': 'Lock Results',
}

export function getTransitionLabel(from: CompetitionStatus, to: CompetitionStatus): string {
  const key = `${from}→${to}`
  return transitionLabels[key] ?? `Advance to ${to.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`
}

export interface TransitionContext {
  registrationCount: number
  judgeCount: number
  roundCount: number
}

/**
 * Returns a human-readable reason why a transition is blocked, or null if allowed.
 * This checks prerequisites beyond the state machine — things like "has dancers been imported?"
 * The state machine validity (canTransition) should be checked separately.
 */
export function getTransitionBlockReason(
  from: CompetitionStatus,
  to: CompetitionStatus,
  context: TransitionContext
): string | null {
  if (from === 'imported' && to === 'ready_for_day_of') {
    if (context.registrationCount === 0) return 'Import dancers before advancing'
  }

  if (from === 'ready_for_day_of' && to === 'in_progress') {
    if (context.judgeCount === 0) return 'Assign judges before starting'
  }

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/competition-states.test.ts`
Expected: All tests PASS (6 existing + 11 new = 17 total)

- [ ] **Step 5: Commit**

```bash
git add src/lib/competition-states.ts tests/competition-states.test.ts
git commit -m "feat: add transition labels and prerequisite block reasons"
```

---

## Chunk 2: Advancement UI

### Task 2: Add advancement card to competition detail page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

This task adds a "Next Step" card between the header and the roster card. It shows the next valid transition(s) as buttons, with blocking messages when prerequisites aren't met. When the organizer clicks a button, it performs the transition through `canTransition()` and reloads data.

The `in_progress → awaiting_scores` transition auto-creates Round 1 if no rounds exist.

- [ ] **Step 1: Add imports**

In `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`, update the import from `competition-states.ts`:

**old_string:**
```ts
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
```

**new_string:**
```ts
import {
  canTransition,
  getNextStates,
  getTransitionLabel,
  getTransitionBlockReason,
  type CompetitionStatus,
  type TransitionContext,
} from '@/lib/competition-states'
```

- [ ] **Step 2: Add state for advancement UI**

Add error and advancing state variables after the existing state declarations (around line 33):

```ts
const [advanceError, setAdvanceError] = useState<string | null>(null)
const [advancing, setAdvancing] = useState(false)
```

- [ ] **Step 3: Add the handleAdvance function**

Add this function after `handleGenerateRecalls` (around line 207), before the `latestRound` computed variable:

```ts
async function handleAdvance(targetStatus: CompetitionStatus) {
  if (!comp) return

  const currentStatus = comp.status as CompetitionStatus
  if (!canTransition(currentStatus, targetStatus)) {
    setAdvanceError(`Cannot transition from ${currentStatus} to ${targetStatus}`)
    return
  }

  setAdvancing(true)
  setAdvanceError(null)

  try {
    // Side effect: create Round 1 when opening for scoring
    if (currentStatus === 'in_progress' && targetStatus === 'awaiting_scores' && rounds.length === 0) {
      const { error: roundErr } = await supabase.from('rounds').insert({
        competition_id: compId,
        round_number: 1,
        round_type: 'standard',
      })
      if (roundErr) throw new Error(`Failed to create round: ${roundErr.message}`)
    }

    const { error: statusErr } = await supabase
      .from('competitions')
      .update({ status: targetStatus })
      .eq('id', compId)

    if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)

    await loadData()
  } catch (err) {
    setAdvanceError(err instanceof Error ? err.message : 'Failed to advance competition')
  } finally {
    setAdvancing(false)
  }
}
```

- [ ] **Step 4: Add the advancement card UI**

In the JSX, insert the following **between** the header `</div>` (around line 261) and the `{/* Roster */}` comment (around line 263):

```tsx
{/* Next Step */}
{(() => {
  const currentStatus = comp.status as CompetitionStatus
  const nextStates = getNextStates(currentStatus)
  // Only show operator-driven transitions (not tabulate/recalls/publish — those have their own buttons)
  const operatorTransitions = nextStates.filter(s =>
    ['ready_for_day_of', 'in_progress', 'awaiting_scores'].includes(s)
  )

  if (operatorTransitions.length === 0) return null

  const context: TransitionContext = {
    registrationCount: registrations.length,
    judgeCount: judges.length,
    roundCount: rounds.length,
  }

  return (
    <Card className="feis-card border-feis-green/30 bg-feis-green-light/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Next Step</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {advanceError && (
          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
            {advanceError}
          </div>
        )}
        {operatorTransitions.map(target => {
          const blockReason = getTransitionBlockReason(currentStatus, target, context)
          const label = getTransitionLabel(currentStatus, target)

          return (
            <div key={target}>
              <Button
                onClick={() => handleAdvance(target)}
                disabled={!!blockReason || advancing}
                className="w-full justify-start text-left"
                size="lg"
              >
                {advancing ? 'Advancing...' : label}
              </Button>
              {blockReason && (
                <p className="text-sm text-muted-foreground mt-1 ml-1">{blockReason}</p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
})()}
```

- [ ] **Step 5: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass (102 existing + 11 new = 113 total, approximately).

- [ ] **Step 7: Commit**

```bash
git add "src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx"
git commit -m "feat: add competition advancement buttons with prerequisite checks"
```

---

### Task 3: Final verification

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Lint check**

Run: `npm run lint`
Expected: No new errors in modified files. Pre-existing warnings are acceptable.

- [ ] **Step 4: Compliance checks**

Verify `canTransition()` guards all status updates in the advancement handler:
Run: `grep -n 'canTransition\|update.*status' "src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx" | head -20`
Expected: `canTransition` check appears before every `.update({ status: ... })` call.

Verify no new `any` types introduced:
Run: `grep -c ': any' "src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx"`
Expected: Same count as before (pre-existing legacy `any` types only).

Verify competition-states module is still pure:
Run: `grep -n 'supabase\|@supabase\|import.*react' src/lib/competition-states.ts`
Expected: No matches.
