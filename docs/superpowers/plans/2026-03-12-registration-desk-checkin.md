# Registration Desk Check-In Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable event-day check-in where a desk person searches for imported dancers, assigns competitor numbers, and marks them checked in — the entry point for all downstream scoring.

**Architecture:** Two changes: (1) make `competitor_number` optional in the CSV parser so CSVs without numbers import cleanly, (2) build a new `/registration/[eventId]` page where the desk person searches dancers, assigns numbers, and checks them in. No new migrations — the schema already supports nullable `competitor_number` and `checked_in` status.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase, Tailwind CSS, shadcn/ui v4

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/csv/import.ts` | Modify | Remove `competitor_number` from required fields, make optional in interface, guard dedup warning |
| `tests/csv/import.test.ts` | Modify | Add tests for CSV without competitor numbers |
| `src/app/dashboard/events/[eventId]/import/page.tsx` | Modify | Update help text — `competitor_number` is optional |
| `src/lib/audit.ts` | Modify | Add `check_in` to `AuditAction` type |
| `src/app/registration/layout.tsx` | Create | Minimal standalone layout (like judge layout) |
| `src/app/registration/[eventId]/page.tsx` | Create | Registration desk page — search, assign numbers, check in |
| `CLAUDE.md` | Modify | Note that registration desk check-in is Phase 1 |

---

## Chunk 1: CSV Import Changes + Audit Type

### Task 1: Make `competitor_number` Optional in CSV Parser

**Files:**
- Modify: `src/lib/csv/import.ts`
- Modify: `tests/csv/import.test.ts`

- [ ] **Step 1: Write failing test — CSV without competitor_number column parses successfully**

Add to `tests/csv/import.test.ts`:

```typescript
it('parses CSV without competitor_number column', () => {
  const csv = `first_name,last_name,age_group,level,competition_code,competition_name
Siobhan,Murphy,U12,Beginner,B-U12-R1,Beginner U12 Reel
Aoife,Kelly,U12,Beginner,B-U12-R1,Beginner U12 Reel`

  const result = parseRegistrationCSV(csv)
  expect(result.valid).toHaveLength(2)
  expect(result.errors).toHaveLength(0)
  expect(result.valid[0].competitor_number).toBeUndefined()
  expect(result.valid[0].first_name).toBe('Siobhan')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/csv/import.test.ts`
Expected: FAIL — `competitor_number` is required, rows get flagged as errors

- [ ] **Step 3: Write failing test — CSV without numbers skips duplicate number warning**

```typescript
it('does not warn about duplicate numbers when competitor_number is absent', () => {
  const csv = `first_name,last_name,age_group,level,competition_code,competition_name
Siobhan,Murphy,U12,Beginner,B-U12-R1,Beginner U12 Reel
Aoife,Kelly,U12,Beginner,B-U12-R1,Beginner U12 Reel`

  const result = parseRegistrationCSV(csv)
  expect(result.warnings.filter(w => w.message.includes('duplicate'))).toHaveLength(0)
})
```

- [ ] **Step 4: Implement changes to `src/lib/csv/import.ts`**

In `ImportRow` interface, change:
```typescript
competitor_number?: string
```

In `REQUIRED_FIELDS`, remove `'competitor_number'`:
```typescript
const REQUIRED_FIELDS: (keyof ImportRow)[] = [
  'first_name',
  'last_name',
  'age_group',
  'level',
  'competition_code',
  'competition_name',
]
```

In the `valid.push()` block, make `competitor_number` conditional:
```typescript
competitor_number: raw.competitor_number?.trim() || undefined,
```

In the duplicate number check, guard for absent numbers:
```typescript
for (let i = 0; i < valid.length; i++) {
  if (!valid[i].competitor_number) continue
  const key = `${valid[i].competition_code}:${valid[i].competitor_number}`
  if (seen.has(key)) {
    warnings.push({
      row: i + 1,
      message: `duplicate competitor number ${valid[i].competitor_number} in competition ${valid[i].competition_code}`,
    })
  }
  seen.set(key, i + 1)
}
```

- [ ] **Step 5: Run all CSV tests to verify they pass**

Run: `npx vitest run tests/csv/import.test.ts`
Expected: ALL PASS (existing tests still pass — CSVs WITH numbers still work)

- [ ] **Step 6: Commit**

```bash
git add src/lib/csv/import.ts tests/csv/import.test.ts
git commit -m "feat: make competitor_number optional in CSV import"
```

### Task 2: Update Import Page Help Text + Add Audit Action

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/import/page.tsx:173-174`
- Modify: `src/lib/audit.ts:3-17`
- Modify: `src/app/dashboard/events/[eventId]/import/page.tsx:144` (registration insert)

- [ ] **Step 1: Update help text in import page**

In `src/app/dashboard/events/[eventId]/import/page.tsx`, line 174, change:
```
Required columns: first_name, last_name, competitor_number, age_group, level, competition_code, competition_name
```
to:
```
Required columns: first_name, last_name, age_group, level, competition_code, competition_name. Optional: competitor_number (assigned at registration desk if not provided)
```

- [ ] **Step 2: Handle null competitor_number in registration insert**

In `src/app/dashboard/events/[eventId]/import/page.tsx`, line 144, change:
```typescript
competitor_number: row.competitor_number,
```
to:
```typescript
competitor_number: row.competitor_number ?? null,
```

- [ ] **Step 3: Add `check_in` to AuditAction type**

In `src/lib/audit.ts`, add `'check_in'` to the `AuditAction` union:
```typescript
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
  | 'unlock_for_correction'
  | 'check_in'
```

- [ ] **Step 4: Build to verify no type errors**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/import/page.tsx src/lib/audit.ts
git commit -m "feat: update import help text for optional competitor_number, add check_in audit action"
```

---

## Chunk 2: Registration Desk Page

### Task 3: Create Registration Layout

**Files:**
- Create: `src/app/registration/layout.tsx`

- [ ] **Step 1: Create the layout file**

Follow the same pattern as `src/app/judge/layout.tsx` but with "Registration" label:

```typescript
export default function RegistrationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen feis-bg-texture">
      <header className="bg-feis-green">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <span className="text-lg font-bold text-white tracking-wide uppercase">
            FeisTab <span className="font-normal text-white/60 normal-case tracking-normal text-sm ml-1">Registration</span>
          </span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/registration/layout.tsx
git commit -m "feat: add registration desk layout"
```

### Task 4: Build Registration Desk Page

**Files:**
- Create: `src/app/registration/[eventId]/page.tsx`

This is the main page. It needs to:
1. Load event info + all dancers with their registrations for the event
2. Show a search bar that filters dancers by name or school
3. Show each dancer with their school and competitions
4. Show "Assign #N" button for unchecked dancers, green checkmark for checked-in ones
5. On assign: update all registrations for that dancer, set `competitor_number` and `status = 'checked_in'`
6. Show progress footer and next-number indicator

- [ ] **Step 1: Create the page file**

Create `src/app/registration/[eventId]/page.tsx`:

```typescript
'use client'

import { useEffect, useState, useMemo, use } from 'react'
import { logAudit } from '@/lib/audit'
import { showSuccess, showCritical } from '@/lib/feedback'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2 } from 'lucide-react'

interface RegistrationDancer {
  id: string
  first_name: string
  last_name: string
  school_name: string | null
}

interface RegistrationCompetition {
  id: string
  code: string | null
  name: string
}

interface DancerWithRegistrations {
  dancer_id: string
  first_name: string
  last_name: string
  school_name: string | null
  competitor_number: string | null // null = not checked in, uses first registration's number
  registrations: {
    id: string
    competition_id: string
    competition_code: string | null
    competition_name: string
    competitor_number: string | null
    status: string
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
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState<string | null>(null)

  async function loadData() {
    const [eventRes, regRes] = await Promise.all([
      supabase.from('events').select('id, name').eq('id', eventId).single(),
      supabase
        .from('registrations')
        .select('id, dancer_id, competition_id, competitor_number, status, dancers(id, first_name, last_name, school_name), competitions(id, code, name)')
        .eq('event_id', eventId)
        .order('dancer_id'),
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

    // Group registrations by dancer
    const dancerMap = new Map<string, DancerWithRegistrations>()
    for (const reg of regRes.data ?? []) {
      const dancer = reg.dancers as unknown as RegistrationDancer | null
      const comp = reg.competitions as unknown as RegistrationCompetition | null
      if (!dancer || !comp) continue

      if (!dancerMap.has(dancer.id)) {
        dancerMap.set(dancer.id, {
          dancer_id: dancer.id,
          first_name: dancer.first_name,
          last_name: dancer.last_name,
          school_name: dancer.school_name,
          competitor_number: reg.competitor_number,
          registrations: [],
        })
      }

      const entry = dancerMap.get(dancer.id)!
      // Use any non-null competitor_number found
      if (reg.competitor_number && !entry.competitor_number) {
        entry.competitor_number = reg.competitor_number
      }
      entry.registrations.push({
        id: reg.id,
        competition_id: comp.id,
        competition_code: comp.code,
        competition_name: comp.name,
        competitor_number: reg.competitor_number,
        status: reg.status,
      })
    }

    // Sort by last name, then first name
    const sorted = [...dancerMap.values()].sort((a, b) => {
      const lastCmp = a.last_name.localeCompare(b.last_name)
      if (lastCmp !== 0) return lastCmp
      return a.first_name.localeCompare(b.first_name)
    })

    setDancers(sorted)
    setLoading(false)
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute next available number
  const nextNumber = useMemo(() => {
    let max = 99 // Start at 100
    for (const d of dancers) {
      if (d.competitor_number) {
        const num = parseInt(d.competitor_number, 10)
        if (!isNaN(num) && num > max) max = num
      }
    }
    return max + 1
  }, [dancers])

  // Filter dancers by search
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

  // Stats
  const checkedInCount = dancers.filter((d) => d.competitor_number).length
  const totalCount = dancers.length

  async function handleAssign(dancer: DancerWithRegistrations) {
    setAssigning(dancer.dancer_id)

    try {
      const numberToAssign = String(nextNumber)

      // Update all registrations for this dancer in this event
      const regIds = dancer.registrations.map((r) => r.id)
      const { error } = await supabase
        .from('registrations')
        .update({
          competitor_number: numberToAssign,
          status: 'checked_in',
        })
        .in('id', regIds)

      if (error) {
        showCritical('Failed to assign number', { description: error.message })
        setAssigning(null)
        return
      }

      // Audit log
      void logAudit(supabase, {
        userId: null,
        entityType: 'dancer',
        entityId: dancer.dancer_id,
        action: 'check_in',
        afterData: {
          competitor_number: numberToAssign,
          event_id: eventId,
          registrations_updated: regIds.length,
        },
      })

      // Update local state
      setDancers((prev) =>
        prev.map((d) => {
          if (d.dancer_id !== dancer.dancer_id) return d
          return {
            ...d,
            competitor_number: numberToAssign,
            registrations: d.registrations.map((r) => ({
              ...r,
              competitor_number: numberToAssign,
              status: 'checked_in',
            })),
          }
        })
      )

      showSuccess(`#${numberToAssign} assigned to ${dancer.first_name} ${dancer.last_name}`)
    } catch (err) {
      showCritical('Unexpected error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setAssigning(null)
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Registration Desk</h1>
        {event && <p className="text-muted-foreground">{event.name}</p>}
      </div>

      {/* Search + Next number */}
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

      {/* Dancer list */}
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
        const isCheckedIn = !!dancer.competitor_number

        return (
          <Card
            key={dancer.dancer_id}
            className={`feis-card ${isCheckedIn ? 'border-feis-green/30' : ''}`}
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
                  {isCheckedIn ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-lg bg-feis-green-light text-feis-green px-3 py-1 rounded-md">
                        #{dancer.competitor_number}
                      </span>
                      <CheckCircle2 className="h-5 w-5 text-feis-green" />
                    </div>
                  ) : (
                    <Button
                      onClick={() => handleAssign(dancer)}
                      disabled={assigning === dancer.dancer_id}
                      size="lg"
                    >
                      {assigning === dancer.dancer_id
                        ? 'Assigning...'
                        : `Assign #${nextNumber}`}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Progress footer */}
      <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-4">
        <span>
          <strong className="text-foreground">{checkedInCount}</strong> / {totalCount} checked in
        </span>
        <span>
          Last assigned: <strong className="font-mono text-foreground">#{nextNumber > 100 ? nextNumber - 1 : '—'}</strong>
        </span>
      </div>
    </div>
  )
}
```

**Key patterns followed:**
- `'use client'` + `useSupabase()` hook (CLAUDE.md 1.3)
- `.error` checked on all Supabase calls (CLAUDE.md 1.5)
- `use(params)` for unwrapping params promise (Next.js 15 pattern)
- `logAudit` fire-and-forget with `void` (existing pattern)
- `showSuccess` / `showCritical` from `@/lib/feedback` (existing pattern)
- Loading state shown (CLAUDE.md 1.5)

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: PASS — page compiles, no type errors

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`
Navigate to: `http://localhost:3000/registration/<eventId>` (use the event ID from the seed data)
Verify:
- Event name shows in header
- Search filters dancers by name and school
- "Assign #100" button appears on unchecked dancers
- Clicking assign sets the number and shows green checkmark
- Next number increments
- Progress footer updates

- [ ] **Step 4: Commit**

```bash
git add src/app/registration/layout.tsx src/app/registration/\[eventId\]/page.tsx
git commit -m "feat: add registration desk check-in page"
```

### Task 5: Update CLAUDE.md + Update Seed Script

**Files:**
- Modify: `CLAUDE.md`
- Modify: `scripts/seed-newport-feis.mjs` (optional — clear competitor numbers so registration desk can assign them)

- [ ] **Step 1: Update CLAUDE.md Phase 1 scope**

In `CLAUDE.md`, under `### Phase 1 — Scoring and Results Engine (CURRENT)`, add after "Judge management (setup for scoring)":
```
- Registration desk check-in (competitor number assignment)
```

- [ ] **Step 2: Update seed script to omit competitor numbers**

In `scripts/seed-newport-feis.mjs`, find where registrations are inserted and set `competitor_number: null` instead of the auto-generated number. This way the seed data matches the real-world flow where numbers are assigned at the desk.

Alternatively, keep the seed as-is (numbers pre-assigned) so other flows still work, but add a `--no-numbers` flag or just document that the registration desk page is for events where CSV didn't include numbers.

**Decision:** Keep the seed as-is — it seeds a complete event for testing all flows. The registration desk page will work regardless (already-checked-in dancers show their number).

- [ ] **Step 3: Build + test**

Run: `npm run build && npm test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add registration desk check-in to Phase 1 scope"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Make `competitor_number` optional in CSV parser | `src/lib/csv/import.ts`, `tests/csv/import.test.ts` |
| 2 | Update import page help text + add audit action | `import/page.tsx`, `src/lib/audit.ts` |
| 3 | Create registration layout | `src/app/registration/layout.tsx` |
| 4 | Build registration desk page | `src/app/registration/[eventId]/page.tsx` |
| 5 | Update CLAUDE.md scope | `CLAUDE.md` |
