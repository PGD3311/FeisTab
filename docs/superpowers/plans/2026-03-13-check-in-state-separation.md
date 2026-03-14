# Check-In State Separation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate competitor-number assignment from event-day physical arrival by creating `event_check_ins` as the source of truth, with a compatibility sync to `registrations.competitor_number`.

**Architecture:** New `event_check_ins` table owns competitor number + arrival state per dancer per event. Registration desk and CSV import write to `event_check_ins`, then sync competitor number outward to `registrations` for backward compatibility. Existing screens (judge, side-stage, tabulator, etc.) continue reading from `registrations.competitor_number` via the sync — no changes to those screens.

**Tech Stack:** Supabase (Postgres migration), TypeScript, Next.js 15 (App Router), Vitest

**Spec:** `docs/superpowers/specs/2026-03-13-check-in-state-separation.md`

---

## Chunk 1: Foundation (Migration + Helpers + Tests)

### Task 1: Create `event_check_ins` migration

**Files:**
- Create: `supabase/migrations/012_event_check_ins.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Event Check-Ins: source of truth for competitor number + event-day arrival
create table event_check_ins (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  competitor_number text not null,
  checked_in_at timestamptz,
  checked_in_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, dancer_id),
  unique(event_id, competitor_number)
);

create trigger event_check_ins_updated_at before update on event_check_ins
  for each row execute function update_updated_at();

-- Backfill from existing registration data
-- Only creates rows where exactly one distinct competitor_number exists per dancer/event
insert into event_check_ins (event_id, dancer_id, competitor_number, checked_in_by)
select
  r.event_id,
  r.dancer_id,
  min(r.competitor_number) as competitor_number,
  'backfill'
from registrations r
where r.competitor_number is not null
group by r.event_id, r.dancer_id
having count(distinct r.competitor_number) = 1;

-- Log conflicts (dancers with multiple different competitor numbers in same event)
do $$
declare
  conflict_count int;
begin
  select count(*) into conflict_count
  from (
    select r.event_id, r.dancer_id
    from registrations r
    where r.competitor_number is not null
    group by r.event_id, r.dancer_id
    having count(distinct r.competitor_number) > 1
  ) conflicts;

  if conflict_count > 0 then
    raise notice 'MIGRATION WARNING: % dancer(s) have conflicting competitor numbers across registrations. These were NOT backfilled into event_check_ins and require manual cleanup.', conflict_count;
  end if;
end $$;
```

- [ ] **Step 2: Verify migration runs cleanly**

Run: `npx supabase db reset` (or apply migration to local Supabase)

Expected: Table created, backfill runs. With current seed data, conflicts will be logged because dancers like Aoife Kelly (dddd1111) have different numbers across competitions (101 in B101, 301 in O301). This is expected — seed data gets fixed in Task 3.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/012_event_check_ins.sql
git commit -m "feat: add event_check_ins migration with backfill"
```

---

### Task 2: Write state derivation helper + tests (TDD)

**Files:**
- Create: `src/lib/check-in.ts`
- Create: `tests/check-in.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/check-in.test.ts
import { describe, it, expect } from 'vitest'
import {
  getCheckInState,
  deriveCheckInStats,
  type CheckInRow,
  type CheckInState,
} from '@/lib/check-in'

describe('getCheckInState', () => {
  it('returns needs_number when row is null', () => {
    expect(getCheckInState(null)).toBe('needs_number')
  })

  it('returns needs_number when row is undefined', () => {
    expect(getCheckInState(undefined)).toBe('needs_number')
  })

  it('returns awaiting_arrival when row exists with no checked_in_at', () => {
    const row: CheckInRow = {
      competitor_number: '101',
      checked_in_at: null,
    }
    expect(getCheckInState(row)).toBe('awaiting_arrival')
  })

  it('returns checked_in when row has checked_in_at', () => {
    const row: CheckInRow = {
      competitor_number: '101',
      checked_in_at: '2026-03-15T10:00:00Z',
    }
    expect(getCheckInState(row)).toBe('checked_in')
  })
})

describe('deriveCheckInStats', () => {
  it('counts all three states correctly', () => {
    const dancerIds = ['d1', 'd2', 'd3', 'd4', 'd5']
    const checkInMap = new Map<string, CheckInRow>([
      ['d1', { competitor_number: '101', checked_in_at: '2026-03-15T10:00:00Z' }],
      ['d2', { competitor_number: '102', checked_in_at: '2026-03-15T10:05:00Z' }],
      ['d3', { competitor_number: '103', checked_in_at: null }],
      // d4 and d5 have no entries — needs_number
    ])

    const stats = deriveCheckInStats(dancerIds, checkInMap)
    expect(stats.checkedIn).toBe(2)
    expect(stats.awaitingArrival).toBe(1)
    expect(stats.needsNumber).toBe(2)
  })

  it('handles empty inputs', () => {
    const stats = deriveCheckInStats([], new Map())
    expect(stats.checkedIn).toBe(0)
    expect(stats.awaitingArrival).toBe(0)
    expect(stats.needsNumber).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/check-in.test.ts`

Expected: FAIL — module `@/lib/check-in` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/check-in.ts

/**
 * Check-in state derivation helpers.
 * Pure functions — no Supabase, no React.
 */

export type CheckInState = 'needs_number' | 'awaiting_arrival' | 'checked_in'

export interface CheckInRow {
  competitor_number: string
  checked_in_at: string | null
}

export interface CheckInStats {
  checkedIn: number
  awaitingArrival: number
  needsNumber: number
}

export function getCheckInState(row: CheckInRow | null | undefined): CheckInState {
  if (!row) return 'needs_number'
  if (row.checked_in_at) return 'checked_in'
  return 'awaiting_arrival'
}

export function deriveCheckInStats(
  dancerIds: string[],
  checkInMap: Map<string, CheckInRow>
): CheckInStats {
  let checkedIn = 0
  let awaitingArrival = 0
  let needsNumber = 0

  for (const id of dancerIds) {
    const state = getCheckInState(checkInMap.get(id) ?? null)
    if (state === 'checked_in') checkedIn++
    else if (state === 'awaiting_arrival') awaitingArrival++
    else needsNumber++
  }

  return { checkedIn, awaitingArrival, needsNumber }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/check-in.test.ts`

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/check-in.ts tests/check-in.test.ts
git commit -m "feat: add check-in state derivation helpers with tests"
```

---

### Task 3: Write computeNextNumber + sync helper (TDD)

**Files:**
- Modify: `src/lib/check-in.ts` (add `computeNextNumber` — pure)
- Create: `src/lib/check-in-sync.ts` (DB write helper — separated per CLAUDE.md rule 1.4)
- Modify: `tests/check-in.test.ts`

Note: `syncCompetitorNumberToRegistrations` is a DB write helper that lives in its own file (`check-in-sync.ts`) to keep `check-in.ts` pure per CLAUDE.md rule 1.4. The sync function cannot be unit-tested with Vitest (requires Supabase client) — its correctness is verified through integration/manual testing.

- [ ] **Step 1: Write the failing test for computeNextNumber**

Add to `tests/check-in.test.ts`:

```ts
import {
  getCheckInState,
  deriveCheckInStats,
  computeNextNumber,
  type CheckInRow,
} from '@/lib/check-in'

describe('computeNextNumber', () => {
  it('returns 100 when no existing numbers', () => {
    expect(computeNextNumber([])).toBe(100)
  })

  it('returns max + 1 from existing numeric numbers', () => {
    expect(computeNextNumber(['101', '102', '105'])).toBe(106)
  })

  it('ignores non-numeric values', () => {
    expect(computeNextNumber(['101', 'VIP-1', '103'])).toBe(104)
  })

  it('starts from 100 even if all values are non-numeric', () => {
    expect(computeNextNumber(['VIP-1', 'VIP-2'])).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/check-in.test.ts`

Expected: FAIL — `computeNextNumber` is not exported.

- [ ] **Step 3: Add computeNextNumber to check-in.ts**

Add to `src/lib/check-in.ts`:

```ts
// Auto-suggest starts at 100. If an event has numbers 1-50 from CSV,
// next assigned number will still be 100 (not 51). This is intentional.
export function computeNextNumber(existingNumbers: string[]): number {
  let max = 99
  for (const n of existingNumbers) {
    const parsed = parseInt(n, 10)
    if (!isNaN(parsed) && parsed > max) max = parsed
  }
  return max + 1
}
```

- [ ] **Step 4: Create the sync helper in its own file**

Create `src/lib/check-in-sync.ts`:

```ts
// src/lib/check-in-sync.ts
//
// DB write helper — temporary compatibility bridge.
// Separated from check-in.ts to keep that file pure (CLAUDE.md rule 1.4).
//
// This is the ONLY path that writes registrations.competitor_number
// in new code. Must be called as part of the primary action, not
// fire-and-forget.

import { type SupabaseClient } from '@supabase/supabase-js'

export async function syncCompetitorNumberToRegistrations(
  supabase: SupabaseClient,
  eventId: string,
  dancerId: string,
  competitorNumber: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('registrations')
    .update({ competitor_number: competitorNumber })
    .eq('event_id', eventId)
    .eq('dancer_id', dancerId)

  if (error) {
    return { error: new Error(error.message) }
  }
  return { error: null }
}
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run tests/check-in.test.ts`

Expected: 10 tests PASS (6 from Task 2 + 4 new). `check-in-sync.ts` has no unit tests (DB helper).

- [ ] **Step 6: Commit**

```bash
git add src/lib/check-in.ts src/lib/check-in-sync.ts tests/check-in.test.ts
git commit -m "feat: add computeNextNumber helper and syncCompetitorNumberToRegistrations"
```

---

### Task 4: Fix seed data

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Fix competitor numbers — one per dancer across all competitions**

The current seed gives different numbers per competition for the same dancer. Fix this so each dancer has one consistent number:

| Dancer | ID | Number |
|--------|-----|--------|
| Aoife Kelly | dddd1111 | 101 |
| Ciara Walsh | dddd2222 | 102 |
| Niamh O'Sullivan | dddd3333 | 103 |
| Saoirse Byrne | dddd4444 | 104 |
| Roisin Doyle | dddd5555 | 105 |
| Maeve Fitzgerald | dddd6666 | 106 |
| Orla McCarthy | dddd7777 | 107 |
| Caoimhe Ryan | dddd8888 | 108 |
| Aisling Brennan | dddd9999 | 109 |
| Fionnuala Gallagher | ddddaaaa | 110 |

Replace the registrations INSERT block (lines 30-44 of `seed.sql`) with:

```sql
INSERT INTO registrations (event_id, dancer_id, competition_id, competitor_number, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', 'cccc1111-1111-1111-1111-cccc11111111', '101', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd2222-2222-2222-2222-222222222222', 'cccc1111-1111-1111-1111-cccc11111111', '102', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd3333-3333-3333-3333-333333333333', 'cccc1111-1111-1111-1111-cccc11111111', '103', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd4444-4444-4444-4444-444444444444', 'cccc1111-1111-1111-1111-cccc11111111', '104', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd5555-5555-5555-5555-555555555555', 'cccc1111-1111-1111-1111-cccc11111111', '105', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd3333-3333-3333-3333-333333333333', 'cccc2222-2222-2222-2222-cccc22222222', '103', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd6666-6666-6666-6666-666666666666', 'cccc2222-2222-2222-2222-cccc22222222', '106', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd7777-7777-7777-7777-777777777777', 'cccc2222-2222-2222-2222-cccc22222222', '107', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd8888-8888-8888-8888-888888888888', 'cccc2222-2222-2222-2222-cccc22222222', '108', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd9999-9999-9999-9999-999999999999', 'cccc2222-2222-2222-2222-cccc22222222', '109', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', 'cccc3333-3333-3333-3333-cccc33333333', '101', 'registered'),
  ('11111111-1111-1111-1111-111111111111', 'dddd6666-6666-6666-6666-666666666666', 'cccc3333-3333-3333-3333-cccc33333333', '106', 'registered'),
  ('11111111-1111-1111-1111-111111111111', 'ddddaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccc3333-3333-3333-3333-cccc33333333', '110', 'registered'),
  ('11111111-1111-1111-1111-111111111111', 'dddd9999-9999-9999-9999-999999999999', 'cccc3333-3333-3333-3333-cccc33333333', '109', 'registered');
```

- [ ] **Step 2: Add event_check_ins seed data**

Add after the registrations INSERT and before the score_entries INSERT:

```sql
-- Event check-ins (source of truth for competitor numbers + arrival state)
INSERT INTO event_check_ins (event_id, dancer_id, competitor_number, checked_in_by) VALUES
  ('11111111-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', '101', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd2222-2222-2222-2222-222222222222', '102', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd3333-3333-3333-3333-333333333333', '103', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd4444-4444-4444-4444-444444444444', '104', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd5555-5555-5555-5555-555555555555', '105', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd6666-6666-6666-6666-666666666666', '106', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd7777-7777-7777-7777-777777777777', '107', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd8888-8888-8888-8888-888888888888', '108', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd9999-9999-9999-9999-999999999999', '109', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'ddddaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '110', 'seed');
```

Note: `checked_in_at` is left as NULL (default) — all seed dancers are in **Awaiting Arrival** state.

- [ ] **Step 3: Verify seed runs cleanly**

Run: `npx supabase db reset`

Expected: No errors. All 10 dancers have consistent numbers. Backfill in migration produces the same `event_check_ins` rows as the seed (idempotent — seed runs after migration, so backfill finds no registrations yet).

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: All existing tests pass. No tests depend on the old inconsistent seed numbers.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql
git commit -m "fix: use one competitor number per dancer across all competitions in seed data"
```

---

## Chunk 2: CSV Import + Registration Desk

### Task 5: Update CSV import to create `event_check_ins` rows

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/import/page.tsx`

- [ ] **Step 1: Add import for sync helper and conflicts state**

At the top of the import page (after existing imports), add:

```ts
import { syncCompetitorNumberToRegistrations } from '@/lib/check-in-sync'
```

Add state variable alongside existing state (after line 16 `const [error, setError] = useState('')`):

```ts
const [conflicts, setConflicts] = useState<string[]>([])
```

- [ ] **Step 2: Remove direct competitor_number write from registration upserts**

In the `handleImport` function, find the registration upsert block (approximately line 140-144). Change the `regInserts` mapping to stop writing `competitor_number` directly to registrations — the sync helper now owns that:

Change this line (approximately line 144):
```ts
              competitor_number: row.competitor_number ?? null,
```

To:
```ts
              competitor_number: null, // Written by syncCompetitorNumberToRegistrations via event_check_ins
```

This ensures `registrations.competitor_number` is only written via the sync helper, per the spec's invariant.

- [ ] **Step 3: Add event_check_ins creation after registration upserts**

Insert the following code between the closing `}` of the `for (const [code, rows] of compMap)` loop (line 156) and `setDone(true)` (line 158):

```ts
      // --- Step 4: Create event_check_ins for dancers with competitor numbers ---
      const dancerNumbers = new Map<string, Set<string>>()
      for (const row of preview.valid) {
        if (!row.competitor_number) continue
        const dancerKey = `${row.first_name}|${row.last_name}|${row.school_name ?? ''}`.toLowerCase()
        const dancerId = dancerLookup.get(dancerKey)
        if (!dancerId) continue

        if (!dancerNumbers.has(dancerId)) dancerNumbers.set(dancerId, new Set())
        dancerNumbers.get(dancerId)!.add(row.competitor_number)
      }

      const checkInConflicts: string[] = []
      for (const [dancerId, numbers] of dancerNumbers) {
        if (numbers.size > 1) {
          checkInConflicts.push(dancerId)
          continue
        }

        const competitorNumber = [...numbers][0]

        const { data: existing } = await supabase
          .from('event_check_ins')
          .select('id, competitor_number')
          .eq('event_id', eventId)
          .eq('dancer_id', dancerId)
          .maybeSingle()

        if (existing) {
          if (existing.competitor_number !== competitorNumber) {
            checkInConflicts.push(dancerId)
          }
          continue
        }

        const { error: checkInErr } = await supabase
          .from('event_check_ins')
          .insert({
            event_id: eventId,
            dancer_id: dancerId,
            competitor_number: competitorNumber,
            checked_in_by: 'import',
          })

        if (checkInErr) {
          checkInConflicts.push(dancerId)
          continue
        }

        const syncResult = await syncCompetitorNumberToRegistrations(
          supabase, eventId, dancerId, competitorNumber
        )
        if (syncResult.error) {
          console.error('Sync failed for dancer:', dancerId, syncResult.error.message)
        }
      }

      setConflicts(checkInConflicts)
```

Then `setDone(true)` follows on the next line (existing code).

- [ ] **Step 4: Add conflict warning in the JSX success block**

In the success block (approximately line 209-220), add after the "Import complete" paragraph:

```tsx
{conflicts.length > 0 && (
  <p className="text-sm text-orange-600 mt-2">
    {conflicts.length} dancer(s) had competitor number conflicts and were not assigned numbers.
    Review and assign numbers at the registration desk.
  </p>
)}
```

- [ ] **Step 5: Verify build passes**

Run: `npm run build`

Expected: Clean build.

- [ ] **Step 6: Manual test**

1. Reset DB: `npx supabase db reset`
2. Start dev: `npm run dev`
3. Go to an event → Import page
4. Import a CSV with competitor numbers → verify `event_check_ins` rows created (check via Supabase dashboard)
5. Import a CSV without numbers → verify no `event_check_ins` rows created
6. Re-import same CSV → verify no duplicates
7. Verify `registrations.competitor_number` was set via sync (not direct write)

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/events/[eventId]/import/page.tsx
git commit -m "feat: CSV import creates event_check_ins rows for pre-assigned competitor numbers"
```

---

### Task 6: Rewrite registration desk page

**Files:**
- Modify: `src/app/registration/[eventId]/page.tsx` (full rewrite)

This is the largest single task. The registration desk changes from a binary "assign number" flow to a three-state model reading from `event_check_ins`.

- [ ] **Step 1: Rewrite the registration desk page**

Replace the entire content of `src/app/registration/[eventId]/page.tsx` with:

```tsx
'use client'

import { useEffect, useState, useMemo, use } from 'react'
import { logAudit } from '@/lib/audit'
import {
  getCheckInState,
  deriveCheckInStats,
  computeNextNumber,
  type CheckInRow,
} from '@/lib/check-in'
import { syncCompetitorNumberToRegistrations } from '@/lib/check-in-sync'
import { showSuccess, showCritical } from '@/lib/feedback'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2 } from 'lucide-react'

interface DancerWithRegistrations {
  dancer_id: string
  first_name: string
  last_name: string
  school_name: string | null
  registrations: {
    id: string
    competition_code: string | null
    competition_name: string
  }[]
}

export default function RegistrationDeskPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const [event, setEvent] = useState<{ id: string; name: string } | null>(null)
  const [dancers, setDancers] = useState<DancerWithRegistrations[]>([])
  const [checkInMap, setCheckInMap] = useState<Map<string, CheckInRow>>(new Map())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  async function loadData() {
    const [eventRes, regRes, checkInRes] = await Promise.all([
      supabase.from('events').select('id, name').eq('id', eventId).single(),
      supabase
        .from('registrations')
        .select('id, dancer_id, competition_id, dancers(id, first_name, last_name, school_name), competitions(id, code, name)')
        .eq('event_id', eventId)
        .order('dancer_id'),
      supabase
        .from('event_check_ins')
        .select('dancer_id, competitor_number, checked_in_at')
        .eq('event_id', eventId),
    ])

    if (eventRes.error) {
      console.error('Failed to load event:', eventRes.error.message)
      setLoading(false)
      return
    }
    if (regRes.error) {
      console.error('Failed to load registrations:', regRes.error.message)
      setLoading(false)
      return
    }

    setEvent(eventRes.data)

    // Build check-in map from event_check_ins (source of truth)
    const ciMap = new Map<string, CheckInRow>()
    for (const row of checkInRes.data ?? []) {
      ciMap.set(row.dancer_id, {
        competitor_number: row.competitor_number,
        checked_in_at: row.checked_in_at,
      })
    }
    setCheckInMap(ciMap)

    // Group registrations by dancer
    const dancerMap = new Map<string, DancerWithRegistrations>()
    for (const reg of regRes.data ?? []) {
      const dancer = reg.dancers as unknown as { id: string; first_name: string; last_name: string; school_name: string | null } | null
      const comp = reg.competitions as unknown as { id: string; code: string | null; name: string } | null
      if (!dancer || !comp) continue

      if (!dancerMap.has(dancer.id)) {
        dancerMap.set(dancer.id, {
          dancer_id: dancer.id,
          first_name: dancer.first_name,
          last_name: dancer.last_name,
          school_name: dancer.school_name,
          registrations: [],
        })
      }

      dancerMap.get(dancer.id)!.registrations.push({
        id: reg.id,
        competition_code: comp.code,
        competition_name: comp.name,
      })
    }

    const sorted = [...dancerMap.values()].sort((a, b) => {
      const lastCmp = a.last_name.localeCompare(b.last_name)
      if (lastCmp !== 0) return lastCmp
      return a.first_name.localeCompare(b.first_name)
    })

    setDancers(sorted)
    setLoading(false)
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const nextNumber = useMemo(() => {
    const existing = [...checkInMap.values()].map((r) => r.competitor_number)
    return computeNextNumber(existing)
  }, [checkInMap])

  const allDancerIds = useMemo(() => dancers.map((d) => d.dancer_id), [dancers])
  const stats = useMemo(() => deriveCheckInStats(allDancerIds, checkInMap), [allDancerIds, checkInMap])

  const filtered = useMemo(() => {
    if (!search.trim()) return dancers
    const q = search.toLowerCase()
    return dancers.filter(
      (d) =>
        d.first_name.toLowerCase().includes(q) ||
        d.last_name.toLowerCase().includes(q) ||
        (d.school_name && d.school_name.toLowerCase().includes(q))
    )
  }, [dancers, search])

  async function handleAssignAndCheckIn(dancer: DancerWithRegistrations) {
    setActing(dancer.dancer_id)
    const numberStr = String(nextNumber)

    try {
      const { error: insertErr } = await supabase
        .from('event_check_ins')
        .insert({
          event_id: eventId,
          dancer_id: dancer.dancer_id,
          competitor_number: numberStr,
          checked_in_at: new Date().toISOString(),
          checked_in_by: 'registration_desk',
        })

      if (insertErr) {
        showCritical('Failed to assign number', { description: insertErr.message })
        return
      }

      const syncResult = await syncCompetitorNumberToRegistrations(
        supabase, eventId, dancer.dancer_id, numberStr
      )
      if (syncResult.error) {
        showCritical('Number assigned but sync failed — retry', { description: syncResult.error.message })
        return
      }

      void logAudit(supabase, {
        userId: null,
        entityType: 'dancer',
        entityId: dancer.dancer_id,
        action: 'check_in',
        afterData: {
          competitor_number: numberStr,
          event_id: eventId,
          source: 'desk_assigned',
        },
      })

      setCheckInMap((prev) => {
        const next = new Map(prev)
        next.set(dancer.dancer_id, {
          competitor_number: numberStr,
          checked_in_at: new Date().toISOString(),
        })
        return next
      })

      showSuccess(`#${numberStr} assigned to ${dancer.first_name} ${dancer.last_name}`)
    } catch (err) {
      showCritical('Unexpected error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setActing(null)
    }
  }

  async function handleCheckIn(dancer: DancerWithRegistrations) {
    setActing(dancer.dancer_id)
    const checkInRow = checkInMap.get(dancer.dancer_id)
    if (!checkInRow) return

    try {
      const { error: updateErr } = await supabase
        .from('event_check_ins')
        .update({
          checked_in_at: new Date().toISOString(),
          checked_in_by: 'registration_desk',
        })
        .eq('event_id', eventId)
        .eq('dancer_id', dancer.dancer_id)

      if (updateErr) {
        showCritical('Failed to check in', { description: updateErr.message })
        return
      }

      // Defensive sync — heals registrations if stale
      const syncResult = await syncCompetitorNumberToRegistrations(
        supabase, eventId, dancer.dancer_id, checkInRow.competitor_number
      )
      if (syncResult.error) {
        showCritical('Checked in but sync failed — retry', { description: syncResult.error.message })
        return
      }

      void logAudit(supabase, {
        userId: null,
        entityType: 'dancer',
        entityId: dancer.dancer_id,
        action: 'check_in',
        afterData: {
          competitor_number: checkInRow.competitor_number,
          event_id: eventId,
          source: 'pre_assigned',
        },
      })

      setCheckInMap((prev) => {
        const next = new Map(prev)
        next.set(dancer.dancer_id, {
          ...checkInRow,
          checked_in_at: new Date().toISOString(),
        })
        return next
      })

      showSuccess(`${dancer.first_name} ${dancer.last_name} checked in`)
    } catch (err) {
      showCritical('Unexpected error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setActing(null)
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Registration Desk</h1>
        {event && <p className="text-muted-foreground">{event.name}</p>}
      </div>

      <div className="flex gap-3 items-center">
        <input
          type="text"
          placeholder="Search by dancer name or school..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-4 py-3 text-lg shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="bg-feis-green-light text-feis-green px-4 py-3 rounded-md font-semibold text-sm whitespace-nowrap">
          Next #: <span className="font-mono text-lg">{nextNumber}</span>
        </div>
      </div>

      {filtered.length === 0 && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {search ? 'No dancers match your search.' : 'No dancers imported yet.'}
            </p>
          </CardContent>
        </Card>
      )}

      {filtered.map((dancer) => {
        const checkInRow = checkInMap.get(dancer.dancer_id) ?? null
        const state = getCheckInState(checkInRow)

        return (
          <Card
            key={dancer.dancer_id}
            className={`feis-card ${state === 'checked_in' ? 'border-feis-green/30' : ''}`}
          >
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-lg font-semibold">
                    {dancer.first_name} {dancer.last_name}
                  </div>
                  {dancer.school_name && (
                    <div className="text-sm text-muted-foreground">{dancer.school_name}</div>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {dancer.registrations.map((reg) => (
                      <Badge key={reg.id} variant="secondary" className="text-xs">
                        {reg.competition_code && `${reg.competition_code} — `}
                        {reg.competition_name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="shrink-0">
                  {state === 'checked_in' && checkInRow && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-lg bg-feis-green-light text-feis-green px-3 py-1 rounded-md">
                        #{checkInRow.competitor_number}
                      </span>
                      <CheckCircle2 className="h-5 w-5 text-feis-green" />
                    </div>
                  )}
                  {state === 'awaiting_arrival' && checkInRow && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-lg border border-muted-foreground/30 text-muted-foreground px-3 py-1 rounded-md">
                        #{checkInRow.competitor_number}
                      </span>
                      <Button
                        onClick={() => handleCheckIn(dancer)}
                        disabled={acting === dancer.dancer_id}
                        size="lg"
                      >
                        {acting === dancer.dancer_id ? 'Checking in...' : 'Check In'}
                      </Button>
                    </div>
                  )}
                  {state === 'needs_number' && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">
                        Needs Number
                      </Badge>
                      <Button
                        onClick={() => handleAssignAndCheckIn(dancer)}
                        disabled={acting === dancer.dancer_id}
                        size="lg"
                      >
                        {acting === dancer.dancer_id
                          ? 'Assigning...'
                          : `Assign #${nextNumber} & Check In`}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}

      <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-4">
        <div className="flex gap-4">
          <span><strong className="text-foreground">{stats.checkedIn}</strong> Checked In</span>
          <span><strong className="text-foreground">{stats.awaitingArrival}</strong> Awaiting Arrival</span>
          <span><strong className="text-foreground">{stats.needsNumber}</strong> Needs Number</span>
        </div>
        <span>
          Next: <strong className="font-mono text-foreground">#{nextNumber}</strong>
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`

Expected: Clean build.

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: All tests pass. No existing tests depend on the registration desk page.

- [ ] **Step 4: Manual test — three states**

1. Reset DB: `npx supabase db reset`
2. Start dev: `npm run dev`
3. Go to registration desk for Spring Feis 2026 (code: SPRING26)
4. All 10 dancers should show **Awaiting Arrival** (seed data has numbers but no `checked_in_at`)
5. Click "Check In" on a dancer → should transition to **Checked In** with green badge
6. Stats bar should update: 1 Checked In, 9 Awaiting Arrival, 0 Needs Number

- [ ] **Step 5: Manual test — assign flow**

1. Import a CSV without competitor numbers
2. New dancers should appear as **Needs Number** with gray badge
3. Click "Assign #111 & Check In" → should create `event_check_ins` row + sync + show green badge
4. Verify in Supabase dashboard that `registrations.competitor_number` was synced

- [ ] **Step 6: Manual test — verify legacy screens still work**

1. After checking in a dancer, go to the judge page → dancer should show with correct competitor number
2. Check side-stage → dancer should appear with correct number in roster
3. Check competition detail → dancer number visible

- [ ] **Step 7: Commit**

```bash
git add src/app/registration/[eventId]/page.tsx
git commit -m "feat: rewrite registration desk with three-state check-in model"
```

---

### Task 7: Run full verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: All tests pass (existing + new check-in tests).

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: Clean build, no TypeScript errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: Clean.

- [ ] **Step 4: Post-migration validation queries**

After `npx supabase db reset`, run these validation queries in the Supabase SQL editor:

```sql
-- 1. No duplicate (event_id, dancer_id) rows
SELECT event_id, dancer_id, COUNT(*) FROM event_check_ins GROUP BY event_id, dancer_id HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- 2. No duplicate (event_id, competitor_number) rows
SELECT event_id, competitor_number, COUNT(*) FROM event_check_ins GROUP BY event_id, competitor_number HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- 3. No backfilled rows have checked_in_at set
SELECT * FROM event_check_ins WHERE checked_in_by = 'backfill' AND checked_in_at IS NOT NULL;
-- Expected: 0 rows (though with fixed seed data, backfill produces 0 rows since seed inserts directly)

-- 4. Every event_check_ins number matches registrations
SELECT eci.event_id, eci.dancer_id, eci.competitor_number, r.competitor_number as reg_number
FROM event_check_ins eci
JOIN registrations r ON r.event_id = eci.event_id AND r.dancer_id = eci.dancer_id
WHERE r.competitor_number IS NOT NULL AND r.competitor_number != eci.competitor_number;
-- Expected: 0 rows
```

- [ ] **Step 5: Commit any fixes**

If any issues found, fix and commit with appropriate message.

- [ ] **Step 6: Final commit — feature complete**

Only if there are uncommitted changes from fixes:

```bash
git status
# Stage specific changed files (never git add -A)
git commit -m "test: verify check-in state separation — all tests passing, build clean"
```
