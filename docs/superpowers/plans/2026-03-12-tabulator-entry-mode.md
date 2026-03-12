# Tabulator Score Entry Mode — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second score entry path — tabulator transcription from paper — so organizers can digitize scores without requiring judges to use devices.

**Architecture:** New dashboard page at `/dashboard/events/{eventId}/competitions/{compId}/tabulator` where an operator selects a judge and enters their scores from a paper sheet. Scores flow into the same `score_entries` table with `entry_mode = 'tabulator_transcription'`. Packet ownership enforced at application layer: one judge+round = one entry path. Pure helper for ownership logic, tested. No auth changes (prototype uses hardcoded context — `entered_by_user_id` will be `null` until auth is wired).

**Design decisions:**
- **`entered_at` column omitted** — the spec mentions it, but `submitted_at DEFAULT now()` already captures insert time and `updated_at` (trigger-maintained) tracks edits. Adding `entered_at` would be redundant.
- **Audit trail wiring deferred** — the spec's acceptance criterion "Audit trail distinguishes self-service from transcription" requires `logAudit()` calls. This plan lays the groundwork (adds `AuditAction` types, stores `entry_mode` on scores) but actual wiring is covered by the Gap 4 (Audit Trail) plan. The data is there; the logging comes next.
- **Pre-existing CLAUDE.md violations on judge page** (`handleSignOff` bypasses `canTransition()`, no `.error` checks) — these are Gap 3 (Error Handling) scope. This plan does not fix them, but the new tabulator page does follow all rules correctly.

**Tech Stack:** Next.js 15 (App Router), Supabase (Postgres), TypeScript, Tailwind, shadcn/ui v4, Vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/007_tabulator_entry.sql` | Add `entry_mode` and `entered_by_user_id` to `score_entries` |
| Create | `src/lib/entry-mode.ts` | `EntryMode` type, `canEnterScores()` pure helper |
| Create | `tests/entry-mode.test.ts` | Tests for packet ownership logic |
| Modify | `src/lib/audit.ts` | Add `'sign_off'`, `'tabulate'`, `'score_transcribe'` to `AuditAction` |
| Create | `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx` | Tabulator entry page |
| Modify | `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Add "Enter Scores (Tabulator)" link |
| Modify | `src/app/judge/[eventId]/[compId]/page.tsx` | Tag scores with `entry_mode: 'judge_self_service'` |

---

## Chunk 1: Schema + Pure Logic

### Task 1: Migration — add tabulator columns to score_entries

**Files:**
- Create: `supabase/migrations/007_tabulator_entry.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Tabulator entry mode support
-- Allows scores to be entered by a tabulator on behalf of a judge

ALTER TABLE score_entries
  ADD COLUMN IF NOT EXISTS entry_mode text NOT NULL DEFAULT 'judge_self_service';

ALTER TABLE score_entries
  ADD CONSTRAINT score_entries_entry_mode_check
  CHECK (entry_mode IN ('judge_self_service', 'tabulator_transcription'));

ALTER TABLE score_entries
  ADD COLUMN IF NOT EXISTS entered_by_user_id uuid REFERENCES auth.users(id);

COMMENT ON COLUMN score_entries.entry_mode IS 'How the score was entered: judge on their device, or tabulator transcribing paper';
COMMENT ON COLUMN score_entries.entered_by_user_id IS 'User who physically typed the score. NULL = judge self-entry (prototype has no auth)';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/007_tabulator_entry.sql
git commit -m "feat: add entry_mode and entered_by_user_id to score_entries"
```

---

### Task 2: Entry mode types and packet ownership helper (TDD)

**Files:**
- Create: `src/lib/entry-mode.ts`
- Create: `tests/entry-mode.test.ts`

- [ ] **Step 1: Write failing tests for packet ownership logic**

```ts
// tests/entry-mode.test.ts
import { describe, it, expect } from 'vitest'
import { canEnterScores, type EntryMode } from '@/lib/entry-mode'

describe('canEnterScores', () => {
  it('allows entry when no existing scores', () => {
    const result = canEnterScores([], 'tabulator_transcription')
    expect(result.allowed).toBe(true)
  })

  it('allows entry when existing scores use the same mode', () => {
    const result = canEnterScores(
      ['tabulator_transcription', 'tabulator_transcription'],
      'tabulator_transcription'
    )
    expect(result.allowed).toBe(true)
  })

  it('blocks entry when existing scores use a different mode', () => {
    const result = canEnterScores(
      ['judge_self_service'],
      'tabulator_transcription'
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('blocks judge self-service when tabulator already entered', () => {
    const result = canEnterScores(
      ['tabulator_transcription'],
      'judge_self_service'
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('includes the conflicting mode in the reason', () => {
    const result = canEnterScores(
      ['judge_self_service'],
      'tabulator_transcription'
    )
    expect(result.reason).toContain('judge_self_service')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/entry-mode.test.ts`
Expected: FAIL — `Cannot find module '@/lib/entry-mode'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/entry-mode.ts

export type EntryMode = 'judge_self_service' | 'tabulator_transcription'

/**
 * Check whether a given entry mode can be used for a judge+round combination.
 * Rule: one judge's scores for one round must have one active entry path.
 */
export function canEnterScores(
  existingEntryModes: EntryMode[],
  requestedMode: EntryMode
): { allowed: boolean; reason?: string } {
  if (existingEntryModes.length === 0) return { allowed: true }

  const conflicting = existingEntryModes.find(mode => mode !== requestedMode)
  if (conflicting) {
    return {
      allowed: false,
      reason: `Scores already being entered via ${conflicting}. One entry path per judge per round.`,
    }
  }

  return { allowed: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/entry-mode.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/entry-mode.ts tests/entry-mode.test.ts
git commit -m "feat: add entry mode types and packet ownership helper"
```

---

### Task 3: Update AuditAction types

**Files:**
- Modify: `src/lib/audit.ts`

- [ ] **Step 1: Add new audit action types**

In `src/lib/audit.ts` (lines 3-13), replace the existing `AuditAction` type.

**old_string (exact match):**
```ts
export type AuditAction =
  | 'import'
  | 'score_submit'
  | 'score_edit'
  | 'status_change'
  | 'result_publish'
  | 'result_unpublish'
  | 'competition_update'
  | 'recall_generate'
  | 'scratch'
  | 'disqualify'
```

**new_string:**
```ts
export type AuditAction =
  | 'import'
  | 'score_submit'
  | 'score_edit'
  | 'score_transcribe'
  | 'sign_off'
  | 'tabulate'
  | 'status_change'
  | 'result_publish'
  | 'result_unpublish'
  | 'competition_update'
  | 'recall_generate'
  | 'scratch'
  | 'disqualify'
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds (no consumers of the new types yet, so no breakage)

- [ ] **Step 3: Commit**

```bash
git add src/lib/audit.ts
git commit -m "feat: add sign_off, tabulate, score_transcribe to AuditAction"
```

---

## Chunk 2: Tabulator Page

### Task 4: Build the tabulator score entry page

This is the main deliverable. The page lets an operator:
1. Select a judge from a dropdown
2. See the roster with score entry forms (reuses `ScoreEntryForm`)
3. Enter scores on the judge's behalf
4. Sign off the completed packet

**Files:**
- Create: `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx`

**Key patterns to follow (from CLAUDE.md §5.4):**
- `'use client'` directive
- `useSupabase()` hook for data access
- `use(params)` to unwrap route params
- Check `.error` on Supabase responses (CLAUDE.md §1.5)
- All status changes through `canTransition()` (CLAUDE.md §1.2)

- [ ] **Step 1: Create the tabulator page**

```tsx
// src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx
'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
import { ScoreEntryForm } from '@/components/score-entry-form'
import { canEnterScores, type EntryMode } from '@/lib/entry-mode'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface Judge {
  id: string
  first_name: string
  last_name: string
}

interface Registration {
  id: string
  dancer_id: string
  competitor_number: string
  dancers: { first_name: string; last_name: string } | null
}

interface Round {
  id: string
  round_number: number
  round_type: string
  judge_sign_offs: Record<string, string> | null
}

interface ScoreEntry {
  id: string
  dancer_id: string
  raw_score: number
  flagged: boolean
  flag_reason: string | null
  entry_mode: EntryMode
}

export default function TabulatorEntryPage({
  params,
}: {
  params: Promise<{ eventId: string; compId: string }>
}) {
  const { eventId, compId } = use(params)
  const supabase = useSupabase()

  const [judges, setJudges] = useState<Judge[]>([])
  const [selectedJudgeId, setSelectedJudgeId] = useState<string>('')
  const [compName, setCompName] = useState('')
  const [compCode, setCompCode] = useState('')
  const [compStatus, setCompStatus] = useState<CompetitionStatus>('draft')
  const [ruleConfig, setRuleConfig] = useState<{ score_min: number; score_max: number } | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [round, setRound] = useState<Round | null>(null)
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [packetBlocked, setPacketBlocked] = useState<string | null>(null)
  const [signedOff, setSignedOff] = useState(false)

  // Load competition, judges, registrations, latest round
  async function loadBase() {
    const [compRes, judgesRes, regRes, roundRes] = await Promise.all([
      supabase.from('competitions').select('*, rule_sets(*)').eq('id', compId).single(),
      supabase.from('judges').select('id, first_name, last_name').eq('event_id', eventId),
      supabase
        .from('registrations')
        .select('id, dancer_id, competitor_number, dancers(first_name, last_name)')
        .eq('competition_id', compId)
        .order('competitor_number'),
      supabase
        .from('rounds')
        .select('*')
        .eq('competition_id', compId)
        .order('round_number', { ascending: false })
        .limit(1)
        .single(),
    ])

    if (compRes.error) {
      setError(`Failed to load competition: ${compRes.error.message}`)
      setLoading(false)
      return
    }
    if (judgesRes.error) {
      setError(`Failed to load judges: ${judgesRes.error.message}`)
      setLoading(false)
      return
    }
    if (regRes.error) {
      setError(`Failed to load registrations: ${regRes.error.message}`)
      setLoading(false)
      return
    }
    if (roundRes.error) {
      // No round yet is not fatal — just means competition hasn't started scoring
      if (roundRes.error.code !== 'PGRST116') {
        setError(`Failed to load round: ${roundRes.error.message}`)
        setLoading(false)
        return
      }
    }

    const status = (compRes.data?.status as CompetitionStatus) ?? 'draft'
    setCompName(compRes.data?.name ?? '')
    setCompCode(compRes.data?.code ?? '')
    setCompStatus(status)
    setRuleConfig(compRes.data?.rule_sets?.config ?? null)
    setJudges(judgesRes.data ?? [])
    setRegistrations((regRes.data as Registration[]) ?? [])
    setRound(roundRes.data as Round | null)
    setLoading(false)
  }

  // Load scores for the selected judge + check packet ownership
  async function loadJudgeScores(judgeId: string) {
    if (!round) return

    setPacketBlocked(null)
    setSignedOff(false)

    // Check if this judge already signed off
    if (round.judge_sign_offs?.[judgeId]) {
      setSignedOff(true)
    }

    const { data: existingScores, error: scoresErr } = await supabase
      .from('score_entries')
      .select('id, dancer_id, raw_score, flagged, flag_reason, entry_mode')
      .eq('round_id', round.id)
      .eq('judge_id', judgeId)

    if (scoresErr) {
      setError(`Failed to load scores: ${scoresErr.message}`)
      return
    }

    const entries = (existingScores ?? []) as ScoreEntry[]

    // Packet ownership check
    const existingModes = entries.map(s => s.entry_mode)
    const check = canEnterScores(existingModes, 'tabulator_transcription')
    if (!check.allowed) {
      setPacketBlocked(check.reason ?? 'Packet locked to another entry mode.')
      setScores([])
      return
    }

    setScores(entries)
  }

  useEffect(() => {
    loadBase()
  }, [])

  useEffect(() => {
    if (selectedJudgeId && round) {
      loadJudgeScores(selectedJudgeId)
    } else {
      setScores([])
      setPacketBlocked(null)
      setSignedOff(false)
    }
  }, [selectedJudgeId, round])

  async function handleScoreSubmit(
    dancerId: string,
    score: number,
    flagged: boolean,
    flagReason: string | null
  ) {
    if (!selectedJudgeId || !round) return

    const { error: upsertErr } = await supabase.from('score_entries').upsert(
      {
        round_id: round.id,
        competition_id: compId,
        dancer_id: dancerId,
        judge_id: selectedJudgeId,
        raw_score: score,
        flagged,
        flag_reason: flagReason,
        entry_mode: 'tabulator_transcription' as EntryMode,
        entered_by_user_id: null, // No auth in prototype
      },
      { onConflict: 'round_id,dancer_id,judge_id' }
    )

    if (upsertErr) {
      setError(`Failed to save score: ${upsertErr.message}`)
      return
    }

    await loadJudgeScores(selectedJudgeId)
  }

  async function handleSignOff() {
    if (!selectedJudgeId || !round) return

    try {
      // Lock all scores for this judge/round
      const { error: lockErr } = await supabase
        .from('score_entries')
        .update({ locked_at: new Date().toISOString() })
        .eq('round_id', round.id)
        .eq('judge_id', selectedJudgeId)

      if (lockErr) throw new Error(`Failed to lock scores: ${lockErr.message}`)

      // Record sign-off in round's judge_sign_offs
      const currentSignOffs = round.judge_sign_offs || {}
      const updatedSignOffs = {
        ...currentSignOffs,
        [selectedJudgeId]: new Date().toISOString(),
      }

      const { error: signOffErr } = await supabase
        .from('rounds')
        .update({ judge_sign_offs: updatedSignOffs })
        .eq('id', round.id)

      if (signOffErr) throw new Error(`Failed to record sign-off: ${signOffErr.message}`)

      // Check if all judges have now signed off
      const allDone =
        judges.length > 0 && judges.every(j => updatedSignOffs[j.id])

      if (allDone && canTransition(compStatus, 'ready_to_tabulate')) {
        const { error: statusErr } = await supabase
          .from('competitions')
          .update({ status: 'ready_to_tabulate' })
          .eq('id', compId)

        if (statusErr) throw new Error(`Failed to update status: ${statusErr.message}`)
      }

      setSignedOff(true)
      // Update local round state with new sign-offs
      setRound({ ...round, judge_sign_offs: updatedSignOffs })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-off failed')
    }
  }

  const scoreMin = ruleConfig?.score_min ?? 0
  const scoreMax = ruleConfig?.score_max ?? 100
  const scoredCount = scores.length
  const totalDancers = registrations.length
  const selectedJudge = judges.find(j => j.id === selectedJudgeId)

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  const canScore = compStatus === 'awaiting_scores' || compStatus === 'in_progress'

  if (!canScore) {
    return (
      <div className="space-y-6">
        <Link
          href={`/dashboard/events/${eventId}/competitions/${compId}`}
          className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Competition
        </Link>
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              Score entry is not available. Competition status: {compStatus}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!round) {
    return (
      <div className="space-y-6">
        <Link
          href={`/dashboard/events/${eventId}/competitions/${compId}`}
          className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Competition
        </Link>
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              No round available for scoring yet.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/events/${eventId}/competitions/${compId}`}
        className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" /> Back to Competition
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">
          {compCode && `${compCode} — `}Tabulator Entry
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter scores from paper score sheets on behalf of a judge
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline text-red-600"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Judge Selector */}
      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Select Judge</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={selectedJudgeId}
            onChange={e => setSelectedJudgeId(e.target.value)}
            className="w-full max-w-md border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Choose a judge...</option>
            {judges.map(j => {
              const judgeSignedOff = round?.judge_sign_offs?.[j.id]
              return (
                <option key={j.id} value={j.id}>
                  {j.first_name} {j.last_name}
                  {judgeSignedOff ? ' (signed off)' : ''}
                </option>
              )
            })}
          </select>
          {selectedJudge && (
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="outline">
                Entering for: {selectedJudge.first_name} {selectedJudge.last_name}
              </Badge>
              <Badge variant="outline">
                Round {round?.round_number ?? '—'}
              </Badge>
              <Badge variant="outline">
                {scoredCount}/{totalDancers} scored
              </Badge>
              <Badge variant="secondary">Tabulator Mode</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Packet blocked warning */}
      {packetBlocked && selectedJudgeId && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-6 text-center">
            <p className="text-sm font-medium text-red-800">{packetBlocked}</p>
            <p className="text-xs text-red-600 mt-1">
              This judge has already started entering scores via their own device.
              One entry path per judge per round.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Signed off state */}
      {signedOff && selectedJudgeId && !packetBlocked && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-feis-green">
              Scores signed off for {selectedJudge?.first_name} {selectedJudge?.last_name}.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Select another judge to continue, or go back to the competition.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Score entry forms */}
      {selectedJudgeId && !packetBlocked && !signedOff && (
        <>
          <div className="space-y-2">
            {registrations.map(reg => {
              const existing = scores.find(s => s.dancer_id === reg.dancer_id)
              return (
                <ScoreEntryForm
                  key={reg.id}
                  dancerId={reg.dancer_id}
                  dancerName={`${reg.dancers?.first_name ?? ''} ${reg.dancers?.last_name ?? ''}`}
                  competitorNumber={reg.competitor_number}
                  existingScore={existing ? Number(existing.raw_score) : undefined}
                  existingFlagged={existing?.flagged ?? false}
                  existingFlagReason={existing?.flag_reason}
                  scoreMin={scoreMin}
                  scoreMax={scoreMax}
                  onSubmit={handleScoreSubmit}
                  locked={signedOff}
                />
              )
            })}
          </div>

          <Button
            onClick={handleSignOff}
            disabled={scoredCount < totalDancers}
            className="w-full text-lg font-semibold"
            size="lg"
          >
            {scoredCount < totalDancers
              ? `Score all dancers to sign off (${scoredCount}/${totalDancers})`
              : `Sign Off for ${selectedJudge?.first_name ?? 'Judge'}`}
          </Button>
        </>
      )}

      {/* No judge selected prompt */}
      {!selectedJudgeId && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>Select a judge above to begin entering scores from their paper sheet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the page builds**

Run: `npm run build`
Expected: Build succeeds. The new route is available at `/dashboard/events/{eventId}/competitions/{compId}/tabulator`.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/competitions/\[compId\]/tabulator/page.tsx
git commit -m "feat: add tabulator score entry page for paper-to-digital workflow"
```

---

## Chunk 3: Wiring

### Task 5: Add tabulator link from competition detail page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

The competition detail page needs a visible link to the tabulator page. Add it to the Actions card, next to the existing tabulation/publish buttons. Only show when the competition is in a state where scores can be entered (`awaiting_scores`).

- [ ] **Step 1: Add the tabulator link**

In `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`, add a Link import at the top (already imported) and add a button in the Actions card (around line 373, inside `<CardContent className="flex gap-2 flex-wrap">`):

```tsx
{/* Add before the existing Tabulate button, inside the Actions CardContent */}
{(comp.status === 'awaiting_scores' || comp.status === 'in_progress') && (
  <Link href={`/dashboard/events/${eventId}/competitions/${compId}/tabulator`}>
    <Button variant="outline">
      Enter Scores (Tabulator)
    </Button>
  </Link>
)}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/competitions/\[compId\]/page.tsx
git commit -m "feat: add tabulator entry link on competition detail page"
```

---

### Task 6: Tag judge self-service scores with entry_mode

**Files:**
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx`

The judge scoring page must tag its scores with `entry_mode: 'judge_self_service'` so the packet ownership rule can distinguish between the two entry paths. This is the other side of the packet lock.

- [ ] **Step 1: Update handleScoreSubmit to include entry_mode**

In `src/app/judge/[eventId]/[compId]/page.tsx`, find the `handleScoreSubmit` function (around line 79). Update the upsert payload to include `entry_mode`:

Change the upsert object from:
```tsx
{
  round_id: round.id,
  competition_id: compId,
  dancer_id: dancerId,
  judge_id: session.judge_id,
  raw_score: score,
  flagged,
  flag_reason: flagReason,
}
```

To:
```tsx
{
  round_id: round.id,
  competition_id: compId,
  dancer_id: dancerId,
  judge_id: session.judge_id,
  raw_score: score,
  flagged,
  flag_reason: flagReason,
  entry_mode: 'judge_self_service',
}
```

- [ ] **Step 2: Add packet ownership check on load**

After loading existing scores for the judge (around line 68-73), add a packet ownership check. If scores exist with `entry_mode: 'tabulator_transcription'`, the judge should see a message that their scores are being entered by the tabulator.

Add a state variable at the top:
```tsx
const [packetBlocked, setPacketBlocked] = useState<string | null>(null)
```

Add the import:
```tsx
import { canEnterScores } from '@/lib/entry-mode'
```

After loading scores (after `setScores(existingScores ?? [])` around line 73), add:
```tsx
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
```

Add the import for `EntryMode`:
```tsx
import { canEnterScores, type EntryMode } from '@/lib/entry-mode'
```

Then in the render, before the score entry forms (around line 186), add a blocked message:
```tsx
{packetBlocked && (
  <Card className="border-orange-200 bg-orange-50">
    <CardContent className="py-6 text-center">
      <p className="text-sm font-medium text-orange-800">
        Your scores are being entered by the tabulator.
      </p>
      <p className="text-xs text-orange-600 mt-1">
        Contact the tabulator if you need to make changes.
      </p>
    </CardContent>
  </Card>
)}
```

And wrap the score entry forms and sign-off button in `{!packetBlocked && ( ... )}`.

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All existing tests pass + the 5 new entry-mode tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/judge/\[eventId\]/\[compId\]/page.tsx
git commit -m "feat: tag judge scores with entry_mode, enforce packet ownership"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass (existing 97 + 5 new entry-mode tests = 102 total, approximately).

- [ ] **Step 3: Lint check**

Run: `npm run lint`
Expected: No lint errors in new or modified files.

- [ ] **Step 4: Grep for violations**

Verify no `any` types in new code:
Run: `grep -n ': any' src/lib/entry-mode.ts src/app/dashboard/events/\[eventId\]/competitions/\[compId\]/tabulator/page.tsx`
Expected: No matches (all new code is properly typed).

Verify entry-mode module is pure (no Supabase imports):
Run: `grep -n 'supabase\|@supabase' src/lib/entry-mode.ts`
Expected: No matches.

Verify `canTransition()` is used for all status updates in new code (CLAUDE.md §1.2):
Run: `grep -n 'update.*status' src/app/dashboard/events/\[eventId\]/competitions/\[compId\]/tabulator/page.tsx`
Expected: One match — the `ready_to_tabulate` transition in `handleSignOff`, preceded by a `canTransition()` check.

Note: The judge page (`src/app/judge/[eventId]/[compId]/page.tsx`) has a pre-existing `canTransition()` violation in `handleSignOff` (uses raw status check instead). This is Gap 3 scope — not fixed in this plan.
