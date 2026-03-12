# Error Handling & Failure Safety — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Supabase call in the scoring/tabulation/sign-off flow check `.error`, wrap handlers in try/catch with user-visible feedback, add error boundaries, and fix the state machine enforcement gap in judge sign-off.

**Architecture:** No new modules — this is wiring work across 5 files. Add `actionError` state to pages that lack it, wrap all async handlers in try/catch, destructure `{ error }` from every Supabase response and throw on failure. Add 3 Next.js error boundary files. Fix ScoreEntryForm's stuck-saving bug. Fix judge sign-off to use `canTransition()`.

**Tech Stack:** Next.js 15 (App Router), Supabase, TypeScript, Tailwind, shadcn/ui v4

**Design decisions:**
- Error boundaries are `'use client'` components using Next.js `error.tsx` convention (receives `error` and `reset` props).
- All 3 error boundaries share the same structure — no shared component extraction (YAGNI, they're 20 lines each).
- `loadData()` error handling: if competition fetch fails, show error state. If secondary queries fail, log and continue with empty arrays (partial data is better than a white screen).
- Existing `handleAdvance` in the competition detail page already follows the right pattern (try/catch, .error checks). The other handlers (`handleTabulate`, `handlePublish`, `handleGenerateRecalls`) will be brought up to the same standard.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/app/error.tsx` | Root error boundary |
| Create | `src/app/dashboard/error.tsx` | Dashboard error boundary |
| Create | `src/app/judge/error.tsx` | Judge error boundary (phone-friendly) |
| Modify | `src/components/score-entry-form.tsx` | try/catch in handleSave to prevent stuck-saving |
| Modify | `src/app/judge/[eventId]/[compId]/page.tsx` | .error checks, try/catch, canTransition fix |
| Modify | `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | .error checks, try/catch on all handlers |

---

## Chunk 1: Error Boundaries + ScoreEntryForm Fix

### Task 1: Create error boundaries

**Files:**
- Create: `src/app/error.tsx`
- Create: `src/app/dashboard/error.tsx`
- Create: `src/app/judge/error.tsx`

- [ ] **Step 1: Create root error boundary**

Create `src/app/error.tsx`:

```tsx
'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-2xl font-bold text-feis-charcoal">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-feis-green text-white rounded-md hover:bg-feis-green/90 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create dashboard error boundary**

Create `src/app/dashboard/error.tsx`:

```tsx
'use client'

import Link from 'next/link'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold text-feis-charcoal">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="px-4 py-2 bg-feis-green text-white rounded-md hover:bg-feis-green/90 transition-colors"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="px-4 py-2 border rounded-md hover:bg-gray-50 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create judge error boundary**

Create `src/app/judge/error.tsx`:

```tsx
'use client'

export default function JudgeError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        <h2 className="text-xl font-bold text-feis-charcoal">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={reset}
          className="w-full px-4 py-3 bg-feis-green text-white rounded-md hover:bg-feis-green/90 transition-colors text-lg"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
```

Note: Judge error boundary has larger touch targets (`py-3`, `text-lg`, `w-full`) since judges are on phones.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/error.tsx src/app/dashboard/error.tsx src/app/judge/error.tsx
git commit -m "feat: add error boundaries for root, dashboard, and judge routes"
```

---

### Task 2: Fix ScoreEntryForm stuck-saving bug

**Files:**
- Modify: `src/components/score-entry-form.tsx`

The bug: `handleSave()` calls `await onSubmit(...)` without try/catch. If `onSubmit` throws, `setSaving(false)` never runs and the Save button stays stuck showing "...".

- [ ] **Step 1: Wrap onSubmit in try/catch**

In `src/components/score-entry-form.tsx`, replace the `handleSave` function (lines 38-46):

**old_string:**
```ts
  async function handleSave() {
    const num = parseFloat(score)
    if (isNaN(num) || num < scoreMin || num > scoreMax) return
    setSaving(true)
    await onSubmit(dancerId, num, flagged, flagged ? flagReason || null : null)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
```

**new_string:**
```ts
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSave() {
    const num = parseFloat(score)
    if (isNaN(num) || num < scoreMin || num > scoreMax) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSubmit(dancerId, num, flagged, flagged ? flagReason || null : null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save score')
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 2: Show error state in UI**

In the same file, add error indicator after the Save button. Replace the closing `</div>` of the button's parent flex container (the inner `<div className="flex items-center gap-2">` closing tag around line 101):

**old_string:**
```tsx
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isValid || saving || locked}
        >
          {saving ? '...' : saved ? '\u2713 Saved' : 'Save'}
        </Button>
      </div>
```

**new_string:**
```tsx
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isValid || saving || locked}
          variant={saveError ? 'destructive' : 'default'}
        >
          {saving ? '...' : saveError ? 'Retry' : saved ? '\u2713 Saved' : 'Save'}
        </Button>
      </div>
      {saveError && (
        <p className="text-xs text-destructive mt-1 ml-16">{saveError}</p>
      )}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/score-entry-form.tsx
git commit -m "fix: prevent stuck-saving state in ScoreEntryForm with try/catch"
```

---

## Chunk 2: Judge Page Error Handling

### Task 3: Add error handling to judge scoring page

**Files:**
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx`

This task fixes 3 problems:
1. `handleScoreSubmit` has no `.error` check (TODO marker at line 97)
2. `handleSignOff` has no try/catch, no `.error` checks, and uses raw status check instead of `canTransition()`
3. `loadData` has no `.error` checks

- [ ] **Step 1: Add canTransition import**

**old_string:**
```ts
import { canEnterScores, type EntryMode } from '@/lib/entry-mode'
```

**new_string:**
```ts
import { canEnterScores, type EntryMode } from '@/lib/entry-mode'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
```

- [ ] **Step 2: Add error state**

After line 35 (`const [loading, setLoading] = useState(true)`), add:

```ts
const [actionError, setActionError] = useState<string | null>(null)
```

- [ ] **Step 3: Add .error checks to loadData**

Replace `loadData` function (lines 52-92). The key changes: check `compRes.error` and bail, check `roundRes.error` gracefully, check `existingScores` error.

**old_string:**
```ts
  async function loadData(judgeId: string) {
    const [compRes, regRes, roundRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId).order('competitor_number'),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number', { ascending: false }).limit(1).single(),
    ])

    setComp(compRes.data)
    setRegistrations(regRes.data ?? [])
    setRound(roundRes.data)
    setRuleConfig(compRes.data?.rule_sets?.config)

    if (roundRes.data) {
      // Check if this judge already signed off
      if (roundRes.data.judge_sign_offs?.[judgeId]) {
        setSubmitted(true)
      }

      const { data: existingScores } = await supabase
        .from('score_entries')
        .select('*')
        .eq('round_id', roundRes.data.id)
        .eq('judge_id', judgeId)
      setScores(existingScores ?? [])

      const entries = existingScores ?? []
      const existingModes = entries.map((s: { entry_mode: string }) => s.entry_mode)
      if (existingModes.length > 0) {
        const check = canEnterScores(existingModes as EntryMode[], 'judge_self_service')
        if (!check.allowed) {
          setPacketBlocked(check.reason ?? 'Scores are being entered by the tabulator.')
        } else {
          setPacketBlocked(null)
        }
      } else {
        setPacketBlocked(null)
      }
    }

    setLoading(false)
  }
```

**new_string:**
```ts
  async function loadData(judgeId: string) {
    const [compRes, regRes, roundRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId).order('competitor_number'),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number', { ascending: false }).limit(1).single(),
    ])

    if (compRes.error) {
      console.error('Failed to load competition:', compRes.error.message)
      setLoading(false)
      return
    }
    if (regRes.error) console.error('Failed to load registrations:', regRes.error.message)

    setComp(compRes.data)
    setRegistrations(regRes.data ?? [])
    setRound(roundRes.error ? null : roundRes.data)
    setRuleConfig(compRes.data?.rule_sets?.config)

    if (!roundRes.error && roundRes.data) {
      if (roundRes.data.judge_sign_offs?.[judgeId]) {
        setSubmitted(true)
      }

      const { data: existingScores, error: scoresErr } = await supabase
        .from('score_entries')
        .select('*')
        .eq('round_id', roundRes.data.id)
        .eq('judge_id', judgeId)
      if (scoresErr) console.error('Failed to load scores:', scoresErr.message)
      setScores(existingScores ?? [])

      const entries = existingScores ?? []
      const existingModes = entries.map((s: { entry_mode: string }) => s.entry_mode)
      if (existingModes.length > 0) {
        const check = canEnterScores(existingModes as EntryMode[], 'judge_self_service')
        if (!check.allowed) {
          setPacketBlocked(check.reason ?? 'Scores are being entered by the tabulator.')
        } else {
          setPacketBlocked(null)
        }
      } else {
        setPacketBlocked(null)
      }
    }

    setLoading(false)
  }
```

- [ ] **Step 4: Fix handleScoreSubmit with .error check and try/catch**

**old_string:**
```ts
  async function handleScoreSubmit(dancerId: string, score: number, flagged: boolean, flagReason: string | null) {
    if (!session || !round) return

    // TODO: Gap 3 — add .error check on upsert response
    await supabase.from('score_entries').upsert(
      {
        round_id: round.id,
        competition_id: compId,
        dancer_id: dancerId,
        judge_id: session.judge_id,
        raw_score: score,
        flagged,
        flag_reason: flagReason,
        entry_mode: 'judge_self_service',
      },
      { onConflict: 'round_id,dancer_id,judge_id' }
    )

    loadData(session.judge_id)
  }
```

**new_string:**
```ts
  async function handleScoreSubmit(dancerId: string, score: number, flagged: boolean, flagReason: string | null) {
    if (!session || !round) return

    const { error } = await supabase.from('score_entries').upsert(
      {
        round_id: round.id,
        competition_id: compId,
        dancer_id: dancerId,
        judge_id: session.judge_id,
        raw_score: score,
        flagged,
        flag_reason: flagReason,
        entry_mode: 'judge_self_service',
      },
      { onConflict: 'round_id,dancer_id,judge_id' }
    )
    if (error) throw new Error(`Failed to save score: ${error.message}`)

    loadData(session.judge_id)
  }
```

Note: `handleScoreSubmit` throws on error — this is caught by ScoreEntryForm's try/catch (fixed in Task 2).

- [ ] **Step 5: Fix handleSignOff with try/catch, .error checks, and canTransition**

**old_string:**
```ts
  async function handleSignOff() {
    if (!session || !round) return

    // Lock all scores for this judge/round
    await supabase
      .from('score_entries')
      .update({ locked_at: new Date().toISOString() })
      .eq('round_id', round.id)
      .eq('judge_id', session.judge_id)

    // Record sign-off in round's judge_sign_offs jsonb
    const currentSignOffs = round.judge_sign_offs || {}
    const updatedSignOffs = {
      ...currentSignOffs,
      [session.judge_id]: new Date().toISOString(),
    }
    await supabase
      .from('rounds')
      .update({ judge_sign_offs: updatedSignOffs })
      .eq('id', round.id)

    // Check if all judges have now signed off
    const { data: allJudges } = await supabase
      .from('judges')
      .select('id')
      .eq('event_id', eventId)
    const allJudgeIds = allJudges?.map(j => j.id) ?? []
    const allDone = allJudgeIds.length > 0 && allJudgeIds.every(id => updatedSignOffs[id])

    // TODO: Gap 3 — use canTransition() instead of raw status check, add .error checks
    if (allDone) {
      const { data: currentComp } = await supabase
        .from('competitions')
        .select('status')
        .eq('id', compId)
        .single()
      if (currentComp?.status === 'awaiting_scores') {
        await supabase
          .from('competitions')
          .update({ status: 'ready_to_tabulate' })
          .eq('id', compId)
      }
    }

    setSubmitted(true)
  }
```

**new_string:**
```ts
  async function handleSignOff() {
    if (!session || !round) return
    setActionError(null)

    try {
      // Lock all scores for this judge/round
      const { error: lockErr } = await supabase
        .from('score_entries')
        .update({ locked_at: new Date().toISOString() })
        .eq('round_id', round.id)
        .eq('judge_id', session.judge_id)
      if (lockErr) throw new Error(`Failed to lock scores: ${lockErr.message}`)

      // Record sign-off in round's judge_sign_offs jsonb
      const currentSignOffs = round.judge_sign_offs || {}
      const updatedSignOffs = {
        ...currentSignOffs,
        [session.judge_id]: new Date().toISOString(),
      }
      const { error: signOffErr } = await supabase
        .from('rounds')
        .update({ judge_sign_offs: updatedSignOffs })
        .eq('id', round.id)
      if (signOffErr) throw new Error(`Failed to record sign-off: ${signOffErr.message}`)

      // Check if all judges have now signed off
      const { data: allJudges, error: judgesErr } = await supabase
        .from('judges')
        .select('id')
        .eq('event_id', eventId)
      if (judgesErr) throw new Error(`Failed to check judges: ${judgesErr.message}`)

      const allJudgeIds = allJudges?.map(j => j.id) ?? []
      const allDone = allJudgeIds.length > 0 && allJudgeIds.every(id => updatedSignOffs[id])

      if (allDone) {
        const { data: currentComp, error: compErr } = await supabase
          .from('competitions')
          .select('status')
          .eq('id', compId)
          .single()
        if (compErr) throw new Error(`Failed to check competition status: ${compErr.message}`)

        const currentStatus = currentComp?.status as CompetitionStatus
        if (canTransition(currentStatus, 'ready_to_tabulate')) {
          const { error: statusErr } = await supabase
            .from('competitions')
            .update({ status: 'ready_to_tabulate' })
            .eq('id', compId)
          if (statusErr) throw new Error(`Failed to update competition status: ${statusErr.message}`)
        }
      }

      setSubmitted(true)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sign-off failed')
    }
  }
```

- [ ] **Step 6: Add error display in judge page JSX**

After the sign-off button (the `</Button>` around line 250), add error display. Find the sign-off button block and add after it:

Between the sign-off `</Button>` and the closing `</>` of the `{!packetBlocked && (...)}` block, add:

**old_string:**
```tsx
              <Button
                onClick={handleSignOff}
                disabled={scoredCount < totalDancers}
                className="w-full text-lg font-semibold"
                size="lg"
              >
                {scoredCount < totalDancers
                  ? `Score all dancers to sign off (${scoredCount}/${totalDancers})`
                  : 'Sign Off Round'}
              </Button>
            </>
```

**new_string:**
```tsx
              <Button
                onClick={handleSignOff}
                disabled={scoredCount < totalDancers}
                className="w-full text-lg font-semibold"
                size="lg"
              >
                {scoredCount < totalDancers
                  ? `Score all dancers to sign off (${scoredCount}/${totalDancers})`
                  : 'Sign Off Round'}
              </Button>
              {actionError && (
                <div className="mt-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
                  {actionError}
                </div>
              )}
            </>
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: All 113 tests pass (no test changes in this task — these are UI-layer fixes).

- [ ] **Step 9: Commit**

```bash
git add src/app/judge/[eventId]/[compId]/page.tsx
git commit -m "fix: add error handling and canTransition enforcement to judge scoring page"
```

---

## Chunk 3: Competition Detail Page Error Handling

### Task 4: Add error handling to competition detail page handlers

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

This task fixes 4 problems:
1. `loadData` — no `.error` checks on any of the 6 queries
2. `handleTabulate` — no try/catch, no `.error` checks
3. `handlePublish` — no try/catch, no `.error` checks
4. `handleGenerateRecalls` — no try/catch, no `.error` checks
5. Inline `onClick` for Release Numbers — no `.error` check

- [ ] **Step 1: Add actionError state**

After line 42 (`const [advancing, setAdvancing] = useState(false)`), add:

```ts
const [actionError, setActionError] = useState<string | null>(null)
```

- [ ] **Step 2: Add .error checks to loadData**

Replace `loadData` function body. Critical query (competition) bails on error. Secondary queries log and continue.

**old_string:**
```ts
  async function loadData() {
    const [compRes, regRes, roundRes, scoreRes, resultRes, judgesRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number'),
      supabase.from('score_entries').select('*').eq('competition_id', compId),
      supabase.from('results').select('*, dancers(*)').eq('competition_id', compId).order('final_rank'),
      supabase.from('judges').select('id, first_name, last_name').eq('event_id', eventId),
    ])

    setComp(compRes.data)
    setRegistrations(regRes.data ?? [])
    setRounds(roundRes.data ?? [])
    setScores(scoreRes.data ?? [])
    setResults(resultRes.data ?? [])
    setRuleset(compRes.data?.rule_sets?.config as RuleSetConfig | null ?? null)
    setJudges(judgesRes.data ?? [])
```

**new_string:**
```ts
  async function loadData() {
    const [compRes, regRes, roundRes, scoreRes, resultRes, judgesRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('registrations').select('*, dancers(*)').eq('competition_id', compId),
      supabase.from('rounds').select('*').eq('competition_id', compId).order('round_number'),
      supabase.from('score_entries').select('*').eq('competition_id', compId),
      supabase.from('results').select('*, dancers(*)').eq('competition_id', compId).order('final_rank'),
      supabase.from('judges').select('id, first_name, last_name').eq('event_id', eventId),
    ])

    if (compRes.error) {
      console.error('Failed to load competition:', compRes.error.message)
      setLoading(false)
      return
    }
    if (regRes.error) console.error('Failed to load registrations:', regRes.error.message)
    if (roundRes.error) console.error('Failed to load rounds:', roundRes.error.message)
    if (scoreRes.error) console.error('Failed to load scores:', scoreRes.error.message)
    if (resultRes.error) console.error('Failed to load results:', resultRes.error.message)
    if (judgesRes.error) console.error('Failed to load judges:', judgesRes.error.message)

    setComp(compRes.data)
    setRegistrations(regRes.data ?? [])
    setRounds(roundRes.data ?? [])
    setScores(scoreRes.data ?? [])
    setResults(resultRes.data ?? [])
    setRuleset(compRes.data?.rule_sets?.config as RuleSetConfig | null ?? null)
    setJudges(judgesRes.data ?? [])
```

- [ ] **Step 3: Wrap handleTabulate in try/catch with .error checks**

**old_string:**
```ts
  async function handleTabulate() {
    if (!ruleset || !comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'complete_unpublished')) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    const roundScores: ScoreInput[] = scores
      .filter(s => s.round_id === latestRound.id)
      .map(s => ({
        dancer_id: s.dancer_id,
        judge_id: s.judge_id,
        raw_score: Number(s.raw_score),
        flagged: s.flagged ?? false,
      }))

    const tabulationResults = tabulate(roundScores, ruleset)

    for (const r of tabulationResults) {
      await supabase.from('results').upsert(
        {
          competition_id: compId,
          dancer_id: r.dancer_id,
          final_rank: r.final_rank,
          display_place: String(r.final_rank),
          calculated_payload: {
            total_points: r.total_points,
            individual_ranks: r.individual_ranks,
            rules_snapshot: ruleset,
          },
        },
        { onConflict: 'competition_id,dancer_id' }
      )
    }

    await supabase
      .from('competitions')
      .update({ status: 'complete_unpublished' })
      .eq('id', compId)

    loadData()
  }
```

**new_string:**
```ts
  async function handleTabulate() {
    if (!ruleset || !comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'complete_unpublished')) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    setActionError(null)

    try {
      const roundScores: ScoreInput[] = scores
        .filter(s => s.round_id === latestRound.id)
        .map(s => ({
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          raw_score: Number(s.raw_score),
          flagged: s.flagged ?? false,
        }))

      const tabulationResults = tabulate(roundScores, ruleset)

      for (const r of tabulationResults) {
        const { error } = await supabase.from('results').upsert(
          {
            competition_id: compId,
            dancer_id: r.dancer_id,
            final_rank: r.final_rank,
            display_place: String(r.final_rank),
            calculated_payload: {
              total_points: r.total_points,
              individual_ranks: r.individual_ranks,
              rules_snapshot: ruleset,
            },
          },
          { onConflict: 'competition_id,dancer_id' }
        )
        if (error) throw new Error(`Failed to save result for dancer: ${error.message}`)
      }

      const { error: statusErr } = await supabase
        .from('competitions')
        .update({ status: 'complete_unpublished' })
        .eq('id', compId)
      if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)

      await loadData()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Tabulation failed')
    }
  }
```

- [ ] **Step 4: Wrap handlePublish in try/catch with .error checks**

**old_string:**
```ts
  async function handlePublish() {
    if (!comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'published')) return

    const now = new Date().toISOString()
    await supabase
      .from('results')
      .update({ published_at: now })
      .eq('competition_id', compId)

    await supabase
      .from('competitions')
      .update({ status: 'published' })
      .eq('id', compId)

    loadData()
  }
```

**new_string:**
```ts
  async function handlePublish() {
    if (!comp) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'published')) return

    setActionError(null)

    try {
      const now = new Date().toISOString()
      const { error: pubErr } = await supabase
        .from('results')
        .update({ published_at: now })
        .eq('competition_id', compId)
      if (pubErr) throw new Error(`Failed to publish results: ${pubErr.message}`)

      const { error: statusErr } = await supabase
        .from('competitions')
        .update({ status: 'published' })
        .eq('id', compId)
      if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)

      await loadData()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Publish failed')
    }
  }
```

- [ ] **Step 5: Wrap handleGenerateRecalls in try/catch with .error checks**

**old_string:**
```ts
  async function handleGenerateRecalls() {
    if (!ruleset || !comp) return
    if (!ruleset.recall_top_percent) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'recalled_round_pending')) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    const roundScores: ScoreInput[] = scores
      .filter(s => s.round_id === latestRound.id)
      .map(s => ({
        dancer_id: s.dancer_id,
        judge_id: s.judge_id,
        raw_score: Number(s.raw_score),
        flagged: s.flagged ?? false,
      }))

    const tabulationResults = tabulate(roundScores, ruleset)
    const recalled = generateRecalls(tabulationResults, ruleset.recall_top_percent)

    for (const r of recalled) {
      await supabase.from('recalls').upsert(
        {
          competition_id: compId,
          source_round_id: latestRound.id,
          dancer_id: r.dancer_id,
          recall_status: 'recalled',
        },
        { onConflict: 'competition_id,source_round_id,dancer_id' }
      )
    }

    const nextNum = (rounds[rounds.length - 1]?.round_number ?? 0) + 1
    await supabase.from('rounds').insert({
      competition_id: compId,
      round_number: nextNum,
      round_type: 'recall',
    })

    await supabase
      .from('competitions')
      .update({ status: 'recalled_round_pending' })
      .eq('id', compId)

    loadData()
  }
```

**new_string:**
```ts
  async function handleGenerateRecalls() {
    if (!ruleset || !comp) return
    if (!ruleset.recall_top_percent) return

    const currentStatus = comp.status as CompetitionStatus
    if (!canTransition(currentStatus, 'recalled_round_pending')) return

    const latestRound = rounds[rounds.length - 1]
    if (!latestRound) return

    setActionError(null)

    try {
      const roundScores: ScoreInput[] = scores
        .filter(s => s.round_id === latestRound.id)
        .map(s => ({
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          raw_score: Number(s.raw_score),
          flagged: s.flagged ?? false,
        }))

      const tabulationResults = tabulate(roundScores, ruleset)
      const recalled = generateRecalls(tabulationResults, ruleset.recall_top_percent)

      for (const r of recalled) {
        const { error } = await supabase.from('recalls').upsert(
          {
            competition_id: compId,
            source_round_id: latestRound.id,
            dancer_id: r.dancer_id,
            recall_status: 'recalled',
          },
          { onConflict: 'competition_id,source_round_id,dancer_id' }
        )
        if (error) throw new Error(`Failed to save recall: ${error.message}`)
      }

      const nextNum = (rounds[rounds.length - 1]?.round_number ?? 0) + 1
      const { error: roundErr } = await supabase.from('rounds').insert({
        competition_id: compId,
        round_number: nextNum,
        round_type: 'recall',
      })
      if (roundErr) throw new Error(`Failed to create recall round: ${roundErr.message}`)

      const { error: statusErr } = await supabase
        .from('competitions')
        .update({ status: 'recalled_round_pending' })
        .eq('id', compId)
      if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)

      await loadData()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Recall generation failed')
    }
  }
```

- [ ] **Step 6: Fix Release Numbers inline onClick with .error check**

**old_string:**
```tsx
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const newValue = !comp.numbers_released
              await supabase
                .from('competitions')
                .update({ numbers_released: newValue })
                .eq('id', compId)
              loadData()
            }}
          >
            {comp.numbers_released ? '✓ Numbers Released' : 'Release Numbers'}
          </Button>
```

**new_string:**
```tsx
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const newValue = !comp.numbers_released
              const { error } = await supabase
                .from('competitions')
                .update({ numbers_released: newValue })
                .eq('id', compId)
              if (error) {
                setActionError(`Failed to update numbers: ${error.message}`)
                return
              }
              loadData()
            }}
          >
            {comp.numbers_released ? '✓ Numbers Released' : 'Release Numbers'}
          </Button>
```

- [ ] **Step 7: Add actionError display in the Actions card**

In the Actions card, add error display before the buttons:

**old_string:**
```tsx
        <CardContent className="flex gap-2 flex-wrap">
          {(comp.status === 'awaiting_scores' || comp.status === 'in_progress') && (
```

**new_string:**
```tsx
        <CardContent className="space-y-3">
          {actionError && (
            <div className="p-2 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
              {actionError}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
          {(comp.status === 'awaiting_scores' || comp.status === 'in_progress') && (
```

Also close the new inner div before the CardContent closes:

**old_string:**
```tsx
          {results.length > 0 && comp.status !== 'published' && (
            <Button onClick={handlePublish} variant="outline">
              Publish Results
            </Button>
          )}
        </CardContent>
```

**new_string:**
```tsx
          {results.length > 0 && comp.status !== 'published' && (
            <Button onClick={handlePublish} variant="outline">
              Publish Results
            </Button>
          )}
          </div>
        </CardContent>
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 9: Run full test suite**

Run: `npm test`
Expected: All 113 tests pass.

- [ ] **Step 10: Commit**

```bash
git add "src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx"
git commit -m "fix: add error handling to competition detail page handlers"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Lint check**

Run: `npm run lint`
Expected: No new errors in modified files.

- [ ] **Step 4: Compliance checks**

Verify all Supabase calls in scoring/tabulation paths check `.error`:
Run: `grep -n '\.error' src/app/dashboard/events/\[eventId\]/competitions/\[compId\]/page.tsx src/app/judge/\[eventId\]/\[compId\]/page.tsx src/components/score-entry-form.tsx`
Expected: Multiple `.error` checks in each file.

Verify `canTransition` is used in judge sign-off (no raw status checks):
Run: `grep -n 'canTransition\|=== .awaiting' src/app/judge/\[eventId\]/\[compId\]/page.tsx`
Expected: `canTransition` present, no raw `=== 'awaiting_scores'` check.

Verify error boundaries exist:
Run: `ls src/app/error.tsx src/app/dashboard/error.tsx src/app/judge/error.tsx`
Expected: All 3 files exist.

Verify no Supabase imports in engine/lib:
Run: `grep -rn 'supabase\|@supabase' src/lib/engine/ src/lib/csv/`
Expected: No matches.
