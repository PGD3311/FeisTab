# Side-Stage ↔ Judge Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect side-stage and judge with a real-time handoff signal so competitions flow from roster confirmation to scoring without shouting across a ballroom.

**Architecture:** Add `released_to_judge` status to state machine. Upgrade `roster_confirmed` boolean to auditable timestamp fields. Replace 5-second polling with Supabase Realtime (polling kept as fallback). Update side-stage and judge UIs with new groups and handoff buttons.

**Tech Stack:** Next.js 15, Supabase Realtime, TypeScript, Tailwind CSS, shadcn/ui, Vitest

**Spec:** `docs/superpowers/specs/2026-03-13-side-stage-judge-sync.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/competition-states.ts` | Add `released_to_judge` status, transitions, labels, block reasons |
| Modify | `tests/competition-states.test.ts` | Test new status, transitions, block reasons |
| Create | `supabase/migrations/009_roster_confirmed_upgrade.sql` | Add `roster_confirmed_at`/`roster_confirmed_by`, migrate data, drop boolean |
| Modify | `src/app/checkin/[eventId]/page.tsx` | New groups, "Send to Judge" button, Realtime subscription |
| Modify | `src/app/judge/[eventId]/page.tsx` | "Incoming" group, "Start Scoring" from released_to_judge, Realtime subscription |
| Modify | `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Update roster_confirmed references to use timestamp fields |

---

## Chunk 1: State Machine + Tests

### Task 1: Add `released_to_judge` to State Machine

**Files:**
- Modify: `src/lib/competition-states.ts`
- Modify: `tests/competition-states.test.ts`

- [ ] **Step 1: Write failing tests for new status and transitions**

Add to `tests/competition-states.test.ts`:

```ts
// In 'competition state machine' describe block:

it('allows ready_for_day_of -> released_to_judge', () => {
  expect(canTransition('ready_for_day_of', 'released_to_judge')).toBe(true)
})

it('allows released_to_judge -> in_progress', () => {
  expect(canTransition('released_to_judge', 'in_progress')).toBe(true)
})

it('allows released_to_judge -> ready_for_day_of (recall)', () => {
  expect(canTransition('released_to_judge', 'ready_for_day_of')).toBe(true)
})

it('blocks released_to_judge -> awaiting_scores (no skip)', () => {
  expect(canTransition('released_to_judge', 'awaiting_scores')).toBe(false)
})

it('blocks imported -> released_to_judge (must go through ready_for_day_of)', () => {
  expect(canTransition('imported', 'released_to_judge')).toBe(false)
})

it('blocks in_progress -> released_to_judge (no reverse from scoring)', () => {
  expect(canTransition('in_progress', 'released_to_judge')).toBe(false)
})

it('allows full happy path with released_to_judge', () => {
  const path: CompetitionStatus[] = [
    'draft', 'imported', 'ready_for_day_of', 'released_to_judge', 'in_progress',
    'awaiting_scores', 'ready_to_tabulate', 'complete_unpublished', 'published', 'locked'
  ]
  for (let i = 0; i < path.length - 1; i++) {
    expect(canTransition(path[i], path[i + 1])).toBe(true)
  }
})

// Keep existing happy path test (fallback path without released_to_judge still works)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/competition-states.test.ts`
Expected: FAIL — `released_to_judge` not in `CompetitionStatus` type

- [ ] **Step 3: Add `released_to_judge` to CompetitionStatus type and transitions**

In `src/lib/competition-states.ts`:

Add `'released_to_judge'` to `CompetitionStatus` union type (after `'ready_for_day_of'`).

Update `transitions` map:
- `ready_for_day_of`: change from `['in_progress']` to `['released_to_judge', 'in_progress']`
- Add `released_to_judge: ['in_progress', 'ready_for_day_of']`

Do NOT add `released_to_judge` to `ACTIVE_STATUSES` — that array is for competitions actively being scored/tabulated. `released_to_judge` is a handoff state, not an active scoring state.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/competition-states.test.ts`
Expected: All PASS

- [ ] **Step 5: Write failing tests for transition labels**

Add to `tests/competition-states.test.ts` in the `getTransitionLabel` describe block:

```ts
it('returns label for ready_for_day_of -> released_to_judge', () => {
  expect(getTransitionLabel('ready_for_day_of', 'released_to_judge')).toBe('Send to Judge')
})

it('returns label for released_to_judge -> in_progress', () => {
  expect(getTransitionLabel('released_to_judge', 'in_progress')).toBe('Start Scoring')
})

it('returns label for released_to_judge -> ready_for_day_of', () => {
  expect(getTransitionLabel('released_to_judge', 'ready_for_day_of')).toBe('Recall to Side-Stage')
})
```

- [ ] **Step 6: Run tests to verify label tests fail**

Run: `npx vitest run tests/competition-states.test.ts`
Expected: FAIL — labels not mapped

- [ ] **Step 7: Add transition labels and update existing label**

In `src/lib/competition-states.ts`, add to `transitionLabels`:

```ts
'ready_for_day_of→released_to_judge': 'Send to Judge',
'released_to_judge→in_progress': 'Start Scoring',
'released_to_judge→ready_for_day_of': 'Recall to Side-Stage',
```

Also update the existing `'ready_for_day_of→in_progress'` label from `'Start Competition'` to `'Start Scoring'` (aligns with spec — this is the fallback path for small feiseanna without side-stage).

- [ ] **Step 8: Update existing test for renamed label**

In `tests/competition-states.test.ts`, update the existing test:

```ts
it('returns label for ready_for_day_of -> in_progress', () => {
  expect(getTransitionLabel('ready_for_day_of', 'in_progress')).toBe('Start Scoring')
})
```

(Was `'Start Competition'`, now `'Start Scoring'`.)

- [ ] **Step 9: Run tests to verify all label tests pass**

Run: `npx vitest run tests/competition-states.test.ts`
Expected: All PASS

- [ ] **Step 10: Write failing tests for block reasons**

Add to `tests/competition-states.test.ts` in the `getTransitionBlockReason` describe block:

```ts
it('blocks ready_for_day_of -> released_to_judge without roster confirmation', () => {
  const ctx = { ...fullContext, rosterConfirmedAt: null }
  expect(getTransitionBlockReason('ready_for_day_of', 'released_to_judge', ctx)).toBe(
    'Roster must be confirmed before sending to judge'
  )
})

it('blocks ready_for_day_of -> released_to_judge without judges', () => {
  const ctx = { ...fullContext, rosterConfirmedAt: '2026-03-13T00:00:00Z', judgeCount: 0 }
  expect(getTransitionBlockReason('ready_for_day_of', 'released_to_judge', ctx)).toBe(
    'No judges assigned'
  )
})

it('allows ready_for_day_of -> released_to_judge with roster confirmed and judges', () => {
  const ctx = { ...fullContext, rosterConfirmedAt: '2026-03-13T00:00:00Z' }
  expect(getTransitionBlockReason('ready_for_day_of', 'released_to_judge', ctx)).toBeNull()
})

it('blocks ready_for_day_of -> in_progress without roster confirmation', () => {
  const ctx = { ...fullContext, rosterConfirmedAt: null }
  expect(getTransitionBlockReason('ready_for_day_of', 'in_progress', ctx)).toBe(
    'Roster must be confirmed before starting'
  )
})

it('allows released_to_judge -> in_progress with no preconditions', () => {
  expect(getTransitionBlockReason('released_to_judge', 'in_progress', fullContext)).toBeNull()
})

it('allows released_to_judge -> ready_for_day_of (recall) with no preconditions', () => {
  expect(getTransitionBlockReason('released_to_judge', 'ready_for_day_of', fullContext)).toBeNull()
})
```

- [ ] **Step 11: Run tests to verify block reason tests fail**

Run: `npx vitest run tests/competition-states.test.ts`
Expected: FAIL — `rosterConfirmedAt` not in `TransitionContext`

- [ ] **Step 12: Update TransitionContext, getTransitionBlockReason, AND existing test context (all together)**

These must all be done in one step to avoid a state where tests break for the wrong reason.

In `src/lib/competition-states.ts`:

1. Add `rosterConfirmedAt: string | null` to `TransitionContext` interface.

2. Update `getTransitionBlockReason`:

```ts
export function getTransitionBlockReason(
  from: CompetitionStatus,
  to: CompetitionStatus,
  context: TransitionContext
): string | null {
  if (from === 'imported' && to === 'ready_for_day_of') {
    if (context.registrationCount === 0) return 'Import dancers before advancing'
  }

  if (from === 'ready_for_day_of' && to === 'released_to_judge') {
    if (!context.rosterConfirmedAt) return 'Roster must be confirmed before sending to judge'
    if (context.judgeCount === 0) return 'No judges assigned'
  }

  if (from === 'ready_for_day_of' && to === 'in_progress') {
    if (!context.rosterConfirmedAt) return 'Roster must be confirmed before starting'
    if (context.judgeCount === 0) return 'Assign judges before starting'
  }

  return null
}
```

In `tests/competition-states.test.ts`:

3. Update existing `fullContext` to include `rosterConfirmedAt`:

```ts
const fullContext: TransitionContext = {
  registrationCount: 10,
  judgeCount: 3,
  roundCount: 1,
  rosterConfirmedAt: '2026-03-13T00:00:00Z',
}
```

The existing test `'blocks ready_for_day_of -> in_progress without judges'` still passes because `fullContext` has `rosterConfirmedAt` set, so the roster check passes and the judge check fires.

- [ ] **Step 13: Run all tests to verify everything passes**

Run: `npx vitest run tests/competition-states.test.ts`
Expected: All PASS

- [ ] **Step 14: Run full test suite + build**

Run: `npm test -- --run && npm run build`
Expected: All tests pass, build succeeds

Note: Build may fail if other files reference `TransitionContext` or `roster_confirmed` without the new field. Fix any callers — specifically `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` where `TransitionContext` is constructed. Add `rosterConfirmedAt: comp.roster_confirmed_at ?? null` (this will be null until the migration runs, which is fine — the field check handles null correctly).

**Temporary compatibility:** Until the migration runs, `comp.roster_confirmed_at` won't exist on the DB row. The competition detail page currently reads `comp.roster_confirmed` (boolean). For this task, update the `TransitionContext` construction to use the boolean as a fallback: `rosterConfirmedAt: comp.roster_confirmed_at ?? (comp.roster_confirmed ? new Date().toISOString() : null)`. This bridge gets removed in Task 2 when the migration lands.

- [ ] **Step 15: Commit**

```bash
git add src/lib/competition-states.ts tests/competition-states.test.ts src/app/dashboard/events/\[eventId\]/competitions/\[compId\]/page.tsx
git commit -m "feat: add released_to_judge status to state machine

Adds new competition status for side-stage → judge handoff.
New transitions, labels, and block reasons with roster confirmation gate.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Migration — Roster Confirmation Upgrade

### Task 2: Create Migration for Roster Confirmation Fields

**Files:**
- Create: `supabase/migrations/009_roster_confirmed_upgrade.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/009_roster_confirmed_upgrade.sql`:

```sql
-- Upgrade roster_confirmed boolean to auditable timestamp fields
-- Also supports the new released_to_judge status

-- Add new columns
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS roster_confirmed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS roster_confirmed_by text DEFAULT NULL;

-- Migrate existing data: set timestamp for already-confirmed competitions
UPDATE competitions
  SET roster_confirmed_at = now()
  WHERE roster_confirmed = true
    AND roster_confirmed_at IS NULL;

-- Drop the old boolean column
ALTER TABLE competitions
  DROP COLUMN IF EXISTS roster_confirmed;
```

- [ ] **Step 2: Apply migration to Supabase**

Run the migration against the Supabase project using the MCP tool `mcp__claude_ai_Supabase__apply_migration`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/009_roster_confirmed_upgrade.sql
git commit -m "feat: upgrade roster_confirmed to auditable timestamp fields

Replaces boolean roster_confirmed with roster_confirmed_at (timestamp)
and roster_confirmed_by (text) for auditability.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: Update All `roster_confirmed` References

### Task 3: Update Competition Detail Page (Organizer Dashboard)

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

- [ ] **Step 1: Update roster status UI**

Replace all `roster_confirmed` boolean references with `roster_confirmed_at` timestamp checks:

- `comp.roster_confirmed` → `comp.roster_confirmed_at`
- Roster confirm action: update to set `roster_confirmed_at: new Date().toISOString(), roster_confirmed_by: 'Organizer'` instead of `roster_confirmed: true`
- Roster un-confirm action: update to set `roster_confirmed_at: null, roster_confirmed_by: null` instead of `roster_confirmed: false`
- Remove the temporary `rosterConfirmedAt` fallback bridge from Task 1 — use `comp.roster_confirmed_at` directly

- [ ] **Step 2: Update TransitionContext construction**

Remove the boolean fallback bridge. Now use:

```ts
const context: TransitionContext = {
  registrationCount: registrations.length,
  judgeCount: judges.length,
  roundCount: rounds.length,
  rosterConfirmedAt: comp.roster_confirmed_at ?? null,
}
```

- [ ] **Step 3: Update Next Step card to show `released_to_judge` as operator transition**

In the `operatorTransitions` filter, add `'released_to_judge'` to the allowed list:

```ts
const operatorTransitions = nextStates.filter(s => {
  if (s === 'awaiting_scores' && currentStatus !== 'in_progress') return false
  return ['ready_for_day_of', 'in_progress', 'awaiting_scores', 'released_to_judge'].includes(s)
})
```

- [ ] **Step 4: Run build to check for type errors**

Run: `npm run build`
Expected: Build succeeds. Fix any remaining `roster_confirmed` boolean references.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/competitions/\[compId\]/page.tsx
git commit -m "refactor: update competition detail to use roster_confirmed_at timestamps

Replaces boolean roster_confirmed checks with timestamp-based fields.
Adds released_to_judge to operator transitions.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Task 4: Update Side-Stage Page — New Groups + Send to Judge

**Files:**
- Modify: `src/app/checkin/[eventId]/page.tsx`

- [ ] **Step 1: Update Competition interface**

Replace `roster_confirmed: boolean` with:

```ts
roster_confirmed_at: string | null
roster_confirmed_by: string | null
```

- [ ] **Step 2: Update all `roster_confirmed` references**

Replace throughout the file:
- `comp.roster_confirmed` → `!!comp.roster_confirmed_at`
- `roster_confirmed: true` → `roster_confirmed_at: new Date().toISOString(), roster_confirmed_by: 'Side-Stage'`
- `roster_confirmed: false` → `roster_confirmed_at: null, roster_confirmed_by: null`

Update the Supabase select to fetch `roster_confirmed_at, roster_confirmed_by` instead of `roster_confirmed`.

Update the poll query to fetch `roster_confirmed_at` instead of `roster_confirmed`.

- [ ] **Step 3: Rename groups per spec**

Replace status grouping constants:

```ts
const SCORING_STATUSES: CompetitionStatus[] = ['in_progress', 'awaiting_scores']
const SENT_STATUSES: CompetitionStatus[] = ['released_to_judge']
const READY_STATUSES: CompetitionStatus[] = ['ready_for_day_of'] // only shown if roster_confirmed_at
const UPCOMING_STATUSES: CompetitionStatus[] = ['imported', 'draft']
const COMPLETE_STATUSES: CompetitionStatus[] = [
  'ready_to_tabulate',
  'complete_unpublished',
  'published',
  'locked',
  'recalled_round_pending',
]
```

Update grouping logic:
```ts
const scoringComps = filteredCompetitions.filter(c => SCORING_STATUSES.includes(c.status))
const sentComps = filteredCompetitions.filter(c => SENT_STATUSES.includes(c.status))
const readyComps = filteredCompetitions.filter(c =>
  c.status === 'ready_for_day_of' && !!c.roster_confirmed_at
)
const upcomingComps = filteredCompetitions.filter(c =>
  UPCOMING_STATUSES.includes(c.status) ||
  (c.status === 'ready_for_day_of' && !c.roster_confirmed_at)
)
const completeComps = filteredCompetitions.filter(c => COMPLETE_STATUSES.includes(c.status))
```

- [ ] **Step 4: Add imports, "Send to Judge" handler, and "Recall" handler**

First, add missing imports at the top of the file:

```ts
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { logAudit } from '@/lib/audit'
```

(`canTransition` is required per CLAUDE.md rule 1.2 — all status changes go through it.)

Add the Send to Judge handler:

```tsx
async function handleSendToJudge(compId: string) {
  const comp = competitions.find(c => c.id === compId)
  if (!comp) return

  if (!canTransition(comp.status, 'released_to_judge')) {
    showError('Cannot send to judge from current status')
    return
  }

  // Atomic conditional update: only transitions if still in expected state
  const { error } = await supabase
    .from('competitions')
    .update({ status: 'released_to_judge' })
    .eq('id', compId)
    .eq('status', 'ready_for_day_of')

  if (error) {
    showError('Failed to send to judge', { description: error.message })
    return
  }

  void logAudit(supabase, {
    userId: null,
    entityType: 'competition',
    entityId: compId,
    action: 'status_change',
    beforeData: { status: 'ready_for_day_of' },
    afterData: { status: 'released_to_judge', released_to_judge_at: new Date().toISOString() },
  })

  setCompetitions(prev =>
    prev.map(c => c.id === compId ? { ...c, status: 'released_to_judge' as CompetitionStatus } : c)
  )
  showSuccess('Sent to judge')
}
```

Add Recall handler:

```tsx
async function handleRecall(compId: string) {
  const comp = competitions.find(c => c.id === compId)
  if (!comp) return

  if (!canTransition(comp.status, 'ready_for_day_of')) {
    showError('Cannot recall — judge may have already started')
    return
  }

  // Atomic: only if judge hasn't started (still released_to_judge)
  const { error } = await supabase
    .from('competitions')
    .update({ status: 'ready_for_day_of' })
    .eq('id', compId)
    .eq('status', 'released_to_judge')

  if (error) {
    showError('Failed to recall', { description: error.message })
    return
  }

  void logAudit(supabase, {
    userId: null,
    entityType: 'competition',
    entityId: compId,
    action: 'status_change',
    beforeData: { status: 'released_to_judge' },
    afterData: { status: 'ready_for_day_of', trigger: 'side_stage_recall' },
  })

  setCompetitions(prev =>
    prev.map(c => c.id === compId ? { ...c, status: 'ready_for_day_of' as CompetitionStatus } : c)
  )
  showSuccess('Recalled to side-stage')
}
```

- [ ] **Step 5: Render the new groups**

Rename section headers: "Scoring", "Sent", "Ready", "Upcoming", "Complete"

Add "Sent" group between Scoring and Ready (green pulsing dot per spec):
```tsx
{sentComps.length > 0 && (
  <Card className="feis-card">
    <CardHeader className="pb-2">
      <CardTitle className="text-lg text-feis-green flex items-center gap-2">
        <span className="inline-block w-3 h-3 rounded-full bg-feis-green animate-pulse" />
        Sent ({sentComps.length})
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      {sentComps.map(comp => (
        <div key={comp.id} className="rounded-lg border border-feis-green/30 bg-feis-green-light/30 p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-lg font-medium">
                {comp.code && <span className="font-mono">{comp.code}</span>}
                {comp.code && ' — '}
                {comp.name}
              </span>
              <p className="text-sm text-feis-green mt-1">Waiting for judge to start scoring...</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRecall(comp.id)}
            >
              Recall
            </Button>
          </div>
        </div>
      ))}
    </CardContent>
  </Card>
)}
```

**Note on dancer count:** The spec calls for "N dancers ready" on Sent and Incoming cards. The side-stage page loads registrations only for the expanded competition, not for all competitions. Adding dancer counts per-competition would require either: (a) a bulk count query per competition, or (b) a registration count column on the competitions table. **Defer this to a follow-up — the dancer count is a polish item, not a blocker.** The core handoff signal works without it.

In Ready group, add "Send to Judge →" button on each confirmed competition card:
```tsx
<Button
  className="w-full bg-feis-green hover:bg-feis-green/90 text-white min-h-[48px] text-lg mt-3"
  onClick={() => handleSendToJudge(comp.id)}
>
  Send to Judge →
</Button>
```

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/app/checkin/\[eventId\]/page.tsx
git commit -m "feat: add Send to Judge handoff and new side-stage groups

Side-stage page now shows Scoring/Sent/Ready/Upcoming/Complete groups.
Send to Judge transitions to released_to_judge with atomic conditional update.
Recall button returns competition to ready_for_day_of.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Task 5: Update Judge Page — Incoming Group + Start from Handoff

**Files:**
- Modify: `src/app/judge/[eventId]/page.tsx`

- [ ] **Step 1: Update Competition interface**

Replace `roster_confirmed: boolean` with:

```ts
roster_confirmed_at: string | null
roster_confirmed_by: string | null
```

- [ ] **Step 2: Update all `roster_confirmed` references in judge page**

Replace throughout:
- `comp.roster_confirmed` → `!!comp.roster_confirmed_at`
- Update Supabase select to fetch `roster_confirmed_at` instead of `roster_confirmed`
- Update poll select to fetch `roster_confirmed_at` instead of `roster_confirmed`

- [ ] **Step 3: Add "Incoming" group**

Update competition grouping:

```ts
const scoringComps = competitions.filter(c => SCORING_STATUSES.includes(c.status))
const incomingComps = competitions.filter(c => c.status === 'released_to_judge')
const readyToStartComps = competitions.filter(
  c => c.status === 'ready_for_day_of' && !!c.roster_confirmed_at
)
const waitingComps = competitions.filter(
  c =>
    (c.status === 'ready_for_day_of' && !c.roster_confirmed_at) ||
    c.status === 'imported'
)
const doneComps = competitions.filter(c => DONE_STATUSES.includes(c.status))
```

- [ ] **Step 4: Render "Incoming" group between Scoring and Ready to Start**

```tsx
{incomingComps.length > 0 && (
  <Card className="feis-card border-feis-orange">
    <CardHeader>
      <CardTitle className="text-lg text-feis-orange flex items-center gap-2">
        <span className="inline-block w-3 h-3 rounded-full bg-feis-orange animate-pulse" />
        Incoming
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-2">
      {incomingComps.map((comp) => (
        <div
          key={comp.id}
          className="flex items-center justify-between p-4 rounded-md border border-feis-orange/30 bg-feis-orange/5"
        >
          <div>
            <span className="font-medium">
              {comp.code && `${comp.code} — `}
              {comp.name}
            </span>
            <span className="ml-2 text-sm text-muted-foreground">
              {comp.age_group} · {comp.level}
            </span>
            <p className="text-sm text-feis-orange mt-1">Sent by side-stage</p>
          </div>
          <Button
            size="sm"
            onClick={() => handleStart(comp)}
            disabled={starting === comp.id}
          >
            {starting === comp.id ? 'Starting...' : 'Start Scoring'}
          </Button>
        </div>
      ))}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 5: Update `handleStart` to handle `released_to_judge`**

The existing `handleStart` already uses `canTransition(comp.status, 'in_progress')`. Since we added `released_to_judge → in_progress` to the state machine in Task 1, this already works. No code change needed — just verify.

- [ ] **Step 6: Rename "Done" to "Complete"**

Change the Done card header from `"Done"` to `"Complete"`.

- [ ] **Step 7: Update empty state and `hasNoComps` check**

```ts
const hasNoComps =
  scoringComps.length === 0 &&
  incomingComps.length === 0 &&
  readyToStartComps.length === 0 &&
  waitingComps.length === 0 &&
  doneComps.length === 0
```

- [ ] **Step 8: Run build + tests**

Run: `npm test -- --run && npm run build`
Expected: All tests pass, build succeeds

- [ ] **Step 9: Commit**

```bash
git add src/app/judge/\[eventId\]/page.tsx
git commit -m "feat: add Incoming group to judge page for side-stage handoff

Judge sees competitions released by side-stage in new Incoming group.
Start Scoring transitions from released_to_judge to in_progress.
Done renamed to Complete.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Supabase Realtime

### Task 6: Add Realtime Subscriptions to Side-Stage and Judge Pages

**Files:**
- Modify: `src/app/checkin/[eventId]/page.tsx`
- Modify: `src/app/judge/[eventId]/page.tsx`

- [ ] **Step 1: Add Realtime subscription to side-stage page**

In `src/app/checkin/[eventId]/page.tsx`, add a Supabase Realtime subscription alongside the existing polling. The subscription listens for `UPDATE` events on the `competitions` table and updates local state when competition status changes.

```tsx
// Inside the component, after initial data loads:
useEffect(() => {
  if (loading || competitions.length === 0) return

  const compIds = competitions.map(c => c.id)

  const channel = supabase
    .channel('side-stage-competitions')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'competitions',
      },
      (payload) => {
        const updated = payload.new as {
          id: string
          status: CompetitionStatus
          roster_confirmed_at: string | null
          roster_confirmed_by: string | null
        }
        if (!compIds.includes(updated.id)) return

        setCompetitions(prev =>
          prev.map(c =>
            c.id === updated.id
              ? {
                  ...c,
                  status: updated.status,
                  roster_confirmed_at: updated.roster_confirmed_at,
                  roster_confirmed_by: updated.roster_confirmed_by,
                }
              : c
          )
        )
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [loading, competitions.length, supabase])
```

Keep existing 5-second polling as fallback — it handles the case where Realtime connection drops.

- [ ] **Step 2: Add Realtime subscription to judge page**

Same pattern in `src/app/judge/[eventId]/page.tsx`:

```tsx
useEffect(() => {
  if (loading || competitions.length === 0) return

  const compIds = competitions.map(c => c.id)

  const channel = supabase
    .channel('judge-competitions')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'competitions',
      },
      (payload) => {
        const updated = payload.new as {
          id: string
          status: CompetitionStatus
          roster_confirmed_at: string | null
          roster_confirmed_by: string | null
        }
        if (!compIds.includes(updated.id)) return

        setCompetitions(prev =>
          prev.map(c =>
            c.id === updated.id
              ? {
                  ...c,
                  status: updated.status,
                  roster_confirmed_at: updated.roster_confirmed_at,
                  roster_confirmed_by: updated.roster_confirmed_by,
                }
              : c
          )
        )
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [loading, competitions.length, supabase])
```

- [ ] **Step 3: Enable Supabase Realtime on competitions table**

Realtime must be enabled on the `competitions` table in the Supabase dashboard. Run via MCP:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE competitions;
```

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/app/checkin/\[eventId\]/page.tsx src/app/judge/\[eventId\]/page.tsx
git commit -m "feat: add Supabase Realtime for side-stage ↔ judge sync

Both pages subscribe to competitions table changes.
Side-stage sees when judge starts scoring in real-time.
Judge sees incoming competitions from side-stage in real-time.
5-second polling kept as fallback.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: Seed Data + Final Verification

### Task 7: Update Seed Script + Final Build/Test

**Files:**
- Modify: `supabase/seed.sql` (if it references `roster_confirmed`)

- [ ] **Step 1: Update seed script**

Check if `supabase/seed.sql` references `roster_confirmed`. If so, replace with `roster_confirmed_at` / `roster_confirmed_by`.

- [ ] **Step 2: Run full test suite**

Run: `npm test -- --run`
Expected: All tests pass (142+ tests)

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Grep for remaining `roster_confirmed` boolean references**

Search for any remaining references to the old boolean field:

```bash
grep -r "roster_confirmed" src/ --include="*.ts" --include="*.tsx" | grep -v "roster_confirmed_at" | grep -v "roster_confirmed_by"
```

Expected: Zero matches (all references should now use the timestamp fields)

- [ ] **Step 5: Commit seed changes if any**

```bash
git add supabase/seed.sql
git commit -m "fix: update seed script for roster_confirmed_at timestamp fields

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | What | Files | Tests |
|------|------|-------|-------|
| 1 | State machine: `released_to_judge` status + transitions + labels + block reasons | `competition-states.ts`, tests | ~10 new |
| 2 | Migration: `roster_confirmed` boolean → `roster_confirmed_at` timestamp | migration SQL | 0 |
| 3 | Competition detail page: timestamp fields + `released_to_judge` in operator transitions | competition detail page | 0 |
| 4 | Side-stage page: new groups, Send to Judge, Recall, timestamp fields | checkin page | 0 |
| 5 | Judge page: Incoming group, timestamp fields, Start from handoff | judge page | 0 |
| 6 | Supabase Realtime subscriptions on both pages | checkin + judge pages | 0 |
| 7 | Seed script update + final verification | seed.sql | 0 |
