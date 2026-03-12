# Audit Trail Viewer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make audit data visible to organizers via an inline summary panel on the competition detail page and a full audit page with filtering, human-readable summaries, and expandable raw data.

**Architecture:** Pure formatter layer (`audit-format.ts`) handles all display logic — no Supabase, no React. Competition detail page gets an inline 5-row summary. Full audit page at `.../audit` provides filtering, pagination, and raw data inspection. Existing `audit_log` table queried by `entity_id` and `after_data->>'competition_id'`.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Tailwind CSS, shadcn/ui, Vitest

**Spec:** `docs/superpowers/specs/2026-03-12-audit-trail-viewer.md`

---

## Chunk 1: Formatter Layer + Payload Convention Fix

### Task 1: Audit format types and badge config

**Files:**
- Create: `src/lib/audit-format.ts`

- [ ] **Step 1: Create audit-format.ts with types and badge config**

```ts
// src/lib/audit-format.ts

export interface AuditEntry {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  created_at: string
}

export interface NameMaps {
  judges: Map<string, string>   // judge_id → "First Last"
  dancers: Map<string, string>  // dancer_id → "First Last (#number)"
}

export interface FormattedAudit {
  summary: string
  actor: string
  badgeText: string
  badgeColor: string
  isCorrection: boolean
  hasRawData: boolean
}

interface BadgeConfig {
  text: string
  color: string
  filterGroup: string
}

const BADGE_MAP: Record<string, BadgeConfig> = {
  score_submit: { text: 'Score', color: 'bg-blue-50 text-blue-700', filterGroup: 'scores' },
  score_transcribe: { text: 'Score', color: 'bg-blue-50 text-blue-700', filterGroup: 'scores' },
  score_edit: { text: 'Score', color: 'bg-blue-50 text-blue-700', filterGroup: 'scores' },
  sign_off: { text: 'Sign-off', color: 'bg-feis-green-light text-feis-green', filterGroup: 'signoffs' },
  status_change: { text: 'Status', color: 'bg-gray-100 text-gray-600', filterGroup: 'status' },
  tabulate: { text: 'Tabulation', color: 'bg-feis-green-light text-feis-green', filterGroup: 'tabulation' },
  unlock_for_correction: { text: 'Correction', color: 'bg-orange-50 text-orange-700', filterGroup: 'corrections' },
  result_publish: { text: 'Published', color: 'bg-feis-green-light text-feis-green', filterGroup: 'publish' },
  result_unpublish: { text: 'Unpublished', color: 'bg-gray-100 text-gray-600', filterGroup: 'publish' },
  recall_generate: { text: 'Recall', color: 'bg-feis-green-light text-feis-green', filterGroup: 'recalls' },
  import: { text: 'Import', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  scratch: { text: 'Status', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  disqualify: { text: 'Status', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  competition_update: { text: 'Update', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
}

export const FILTER_GROUPS: { value: string; label: string }[] = [
  { value: 'all', label: 'All actions' },
  { value: 'scores', label: 'Score entries' },
  { value: 'signoffs', label: 'Sign-offs' },
  { value: 'status', label: 'Status changes' },
  { value: 'corrections', label: 'Corrections' },
  { value: 'tabulation', label: 'Tabulation' },
  { value: 'publish', label: 'Publish/unpublish' },
  { value: 'recalls', label: 'Recalls' },
  { value: 'other', label: 'Other' },
]

export function getBadge(action: string): BadgeConfig {
  return BADGE_MAP[action] ?? { text: action, color: 'bg-gray-100 text-gray-600', filterGroup: 'other' }
}

export function matchesFilter(action: string, filter: string): boolean {
  if (filter === 'all') return true
  return getBadge(action).filterGroup === filter
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/audit-format.ts
git commit -m "feat: add audit-format types and badge config"
```

### Task 2: Formatter functions with TDD

**Files:**
- Create: `tests/audit-format.test.ts`
- Modify: `src/lib/audit-format.ts`

- [ ] **Step 1: Write failing tests for formatAuditEntry**

```ts
// tests/audit-format.test.ts
import { describe, it, expect } from 'vitest'
import { formatAuditEntry, type AuditEntry, type NameMaps } from '@/lib/audit-format'

const names: NameMaps = {
  judges: new Map([
    ['judge-1', 'Mary O\'Brien'],
    ['judge-2', 'Patrick Kelly'],
  ]),
  dancers: new Map([
    ['dancer-1', 'Siobhan Murphy (#104)'],
    ['dancer-2', 'Aoife Walsh (#201)'],
  ]),
}

function makeEntry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'entry-1',
    user_id: null,
    action: 'status_change',
    entity_type: 'competition',
    entity_id: 'comp-1',
    before_data: null,
    after_data: null,
    created_at: '2026-03-12T10:48:00Z',
    ...overrides,
  }
}

describe('formatAuditEntry', () => {
  it('formats score_submit with judge and dancer names', () => {
    const entry = makeEntry({
      action: 'score_submit',
      after_data: {
        judge_id: 'judge-1',
        dancer_id: 'dancer-1',
        raw_score: 72.5,
        entry_mode: 'judge_self_service',
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('72.5')
    expect(result.summary).toContain('Siobhan Murphy (#104)')
    expect(result.actor).toBe("Mary O'Brien")
    expect(result.badgeText).toBe('Score')
    expect(result.isCorrection).toBe(false)
    expect(result.hasRawData).toBe(true)
  })

  it('formats score_transcribe with tabulator actor', () => {
    const entry = makeEntry({
      action: 'score_transcribe',
      after_data: {
        judge_id: 'judge-2',
        dancer_id: 'dancer-1',
        raw_score: 68,
        entry_mode: 'tabulator_transcription',
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('68')
    expect(result.summary).toContain('Siobhan Murphy (#104)')
    expect(result.summary).toContain('Patrick Kelly')
    expect(result.actor).toBe('Tabulator')
  })

  it('formats sign_off with all judges done', () => {
    const entry = makeEntry({
      action: 'sign_off',
      after_data: {
        judge_id: 'judge-1',
        entry_mode: 'judge_self_service',
        all_judges_done: true,
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain("Mary O'Brien")
    expect(result.summary).toContain('signed off')
    expect(result.summary).toContain('all judges done')
    expect(result.badgeText).toBe('Sign-off')
  })

  it('formats status_change with humanized labels', () => {
    const entry = makeEntry({
      action: 'status_change',
      after_data: { from: 'in_progress', to: 'awaiting_scores' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('In Progress')
    expect(result.summary).toContain('Awaiting Scores')
    expect(result.actor).toBe('Organizer')
  })

  it('formats auto-triggered status_change with System actor', () => {
    const entry = makeEntry({
      action: 'status_change',
      after_data: { from: 'in_progress', to: 'awaiting_scores', trigger: 'auto_advance_on_sign_off' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.actor).toBe('System')
    expect(result.summary).toContain('auto_advance_on_sign_off')
  })

  it('formats unlock_for_correction as correction', () => {
    const entry = makeEntry({
      action: 'unlock_for_correction',
      after_data: {
        judge_id: 'judge-1',
        judge_name: "Mary O'Brien",
        reason: 'wrong_score',
        note: 'Entered 72 instead of 27',
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain("Mary O'Brien")
    expect(result.summary).toContain('wrong_score')
    expect(result.summary).toContain('Entered 72 instead of 27')
    expect(result.isCorrection).toBe(true)
    expect(result.badgeText).toBe('Correction')
  })

  it('formats tabulate', () => {
    const entry = makeEntry({
      action: 'tabulate',
      after_data: { result_count: 12, round_id: 'r-1' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('12 results saved')
    expect(result.actor).toBe('Organizer')
  })

  it('formats result_publish', () => {
    const entry = makeEntry({
      action: 'result_publish',
      after_data: { published_at: '2026-03-12T10:48:00Z' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('Results published')
    expect(result.badgeText).toBe('Published')
  })

  it('formats recall_generate', () => {
    const entry = makeEntry({
      action: 'recall_generate',
      after_data: { recalled_count: 8, source_round_id: 'r-1', new_round_number: 2 },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('8 dancers recalled')
  })

  it('falls back gracefully for unknown action', () => {
    const entry = makeEntry({
      action: 'some_future_action',
      after_data: { foo: 'bar', count: 5 },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('some_future_action')
    expect(result.actor).toBe('Unknown')
    expect(result.badgeText).toBe('some_future_action')
    expect(result.hasRawData).toBe(true)
  })

  it('handles null after_data without crashing', () => {
    const entry = makeEntry({
      action: 'result_publish',
      after_data: null,
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('Results published')
    expect(result.hasRawData).toBe(false)
  })

  it('handles malformed after_data without crashing', () => {
    const entry = makeEntry({
      action: 'score_submit',
      after_data: { unexpected: true },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBeDefined()
    expect(result.actor).toBeDefined()
    // Should not throw
  })

  it('resolves unresolved judge_id to "Judge" fallback', () => {
    const entry = makeEntry({
      action: 'sign_off',
      after_data: {
        judge_id: 'unknown-judge-id',
        entry_mode: 'judge_self_service',
        all_judges_done: false,
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.actor).toBe('Judge')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/audit-format.test.ts`
Expected: FAIL — `formatAuditEntry` not exported

- [ ] **Step 3: Implement formatAuditEntry**

Add to `src/lib/audit-format.ts`:

```ts
function humanizeStatus(status: string): string {
  return status
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function resolveJudge(judgeId: unknown, names: NameMaps): string | null {
  if (typeof judgeId !== 'string') return null
  return names.judges.get(judgeId) ?? null
}

function resolveDancer(dancerId: unknown, names: NameMaps): string | null {
  if (typeof dancerId !== 'string') return null
  return names.dancers.get(dancerId) ?? null
}

function get(data: Record<string, unknown> | null, key: string): unknown {
  return data?.[key] ?? null
}

type Formatter = (entry: AuditEntry, names: NameMaps) => { summary: string; actor: string }

const formatters: Record<string, Formatter> = {
  score_submit(entry, names) {
    const d = entry.after_data
    const dancer = resolveDancer(get(d, 'dancer_id'), names) ?? String(get(d, 'dancer_id') ?? '?')
    const score = get(d, 'raw_score') ?? '?'
    const mode = get(d, 'entry_mode') ?? ''
    const judge = resolveJudge(get(d, 'judge_id'), names)
    return {
      summary: `Score: ${score} for ${dancer} · ${mode}`,
      actor: judge ?? 'Judge',
    }
  },

  score_transcribe(entry, names) {
    const d = entry.after_data
    const dancer = resolveDancer(get(d, 'dancer_id'), names) ?? String(get(d, 'dancer_id') ?? '?')
    const score = get(d, 'raw_score') ?? '?'
    const judge = resolveJudge(get(d, 'judge_id'), names) ?? 'judge'
    return {
      summary: `Transcribed ${score} for ${dancer} · Judge: ${judge}`,
      actor: 'Tabulator',
    }
  },

  sign_off(entry, names) {
    const d = entry.after_data
    const judge = resolveJudge(get(d, 'judge_id'), names) ?? String(get(d, 'judge_id') ?? 'Judge')
    const mode = get(d, 'entry_mode') ?? ''
    const allDone = get(d, 'all_judges_done')
    let summary = `${judge} signed off · ${mode}`
    if (allDone) summary += ' · all judges done'
    return {
      summary,
      actor: resolveJudge(get(d, 'judge_id'), names) ?? 'Judge',
    }
  },

  status_change(entry, names) {
    const d = entry.after_data ?? entry.before_data
    const from = get(d, 'from') ?? get(d, 'status')
    const to = get(d, 'to') ?? get(d, 'status')
    const trigger = get(d, 'trigger')
    let summary = ''
    if (from && to) {
      summary = `${humanizeStatus(String(from))} → ${humanizeStatus(String(to))}`
    } else if (to) {
      summary = `Status: ${humanizeStatus(String(to))}`
    } else {
      summary = 'Status changed'
    }
    if (trigger) summary += ` · ${trigger}`
    return {
      summary,
      actor: trigger ? 'System' : 'Organizer',
    }
  },

  tabulate(entry) {
    const count = get(entry.after_data, 'result_count') ?? '?'
    return { summary: `${count} results saved`, actor: 'Organizer' }
  },

  result_publish() {
    return { summary: 'Results published', actor: 'Organizer' }
  },

  result_unpublish() {
    return { summary: 'Results unpublished', actor: 'Organizer' }
  },

  unlock_for_correction(entry, names) {
    const d = entry.after_data
    const judge = resolveJudge(get(d, 'judge_id'), names) ?? String(get(d, 'judge_name') ?? 'judge')
    const reason = get(d, 'reason') ?? ''
    const note = get(d, 'note')
    let summary = `Unlocked ${judge} · ${reason}`
    if (note) summary += ` · ${note}`
    return { summary, actor: 'Organizer' }
  },

  recall_generate(entry) {
    const count = get(entry.after_data, 'recalled_count') ?? '?'
    return { summary: `${count} dancers recalled`, actor: 'Organizer' }
  },

  import() {
    return { summary: 'Data imported', actor: 'Organizer' }
  },
}

export function formatAuditEntry(entry: AuditEntry, names: NameMaps): FormattedAudit {
  const badge = getBadge(entry.action)
  const hasRawData = entry.after_data !== null || entry.before_data !== null

  try {
    const formatter = formatters[entry.action]
    if (formatter) {
      const { summary, actor } = formatter(entry, names)
      return {
        summary,
        actor,
        badgeText: badge.text,
        badgeColor: badge.color,
        isCorrection: entry.action === 'unlock_for_correction',
        hasRawData,
      }
    }
  } catch {
    // Formatter failed — fall through to generic
  }

  // Generic fallback for unknown or failed actions
  const pairs = entry.after_data
    ? Object.entries(entry.after_data).map(([k, v]) => `${k}: ${v}`).join(', ')
    : ''
  return {
    summary: pairs ? `${entry.action}: ${pairs}` : entry.action,
    actor: 'Unknown',
    badgeText: badge.text,
    badgeColor: badge.color,
    isCorrection: false,
    hasRawData,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/audit-format.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit-format.ts tests/audit-format.test.ts
git commit -m "feat: add audit entry formatter with TDD (12 tests)"
```

### Task 3: Fix audit payload convention

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx:567-574`

The registration `status_change` audit call is missing `competition_id` in its payload. Sign-off calls already include it.

- [ ] **Step 1: Add competition_id to registration status_change audit payload**

In `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`, find the registration status change `logAudit` call (around line 567) and add `competition_id: compId` to both `beforeData` and `afterData`:

```ts
// Change from:
beforeData: { status: reg.status, dancer_id: reg.dancer_id },
afterData: { status: newStatus, dancer_id: reg.dancer_id },

// Change to:
beforeData: { status: reg.status, dancer_id: reg.dancer_id, competition_id: compId },
afterData: { status: newStatus, dancer_id: reg.dancer_id, competition_id: compId },
```

- [ ] **Step 2: Run build to verify no errors**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add 'src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx'
git commit -m "fix: add competition_id to registration status_change audit payload"
```

---

## Chunk 2: Inline Audit Summary Panel

### Task 4: Add inline audit panel to competition detail page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

- [ ] **Step 1: Add imports**

Add to the imports at the top of the competition detail page:

```ts
import { formatAuditEntry, matchesFilter, type AuditEntry, type NameMaps } from '@/lib/audit-format'
```

- [ ] **Step 2: Add audit state and query to loadData()**

Add state variable:

```ts
const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
```

Add to `loadData()` after the existing queries (not in the Promise.all — this is a separate query with OR conditions that Supabase client can't easily express in one call):

```ts
// Fetch audit entries for this competition
// Query: entity_id = compId OR after_data contains competition_id
const { data: auditByEntity } = await supabase
  .from('audit_log')
  .select('*')
  .eq('entity_id', compId)
  .order('created_at', { ascending: false })
  .limit(20)

const { data: auditByPayload } = await supabase
  .from('audit_log')
  .select('*')
  .contains('after_data', { competition_id: compId })
  .order('created_at', { ascending: false })
  .limit(20)

// Deduplicate by id
const auditMap = new Map<string, AuditEntry>()
for (const row of [...(auditByEntity ?? []), ...(auditByPayload ?? [])]) {
  if (!auditMap.has(row.id)) {
    auditMap.set(row.id, row as AuditEntry)
  }
}
const sorted = [...auditMap.values()].sort(
  (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
)
setAuditEntries(sorted)
```

- [ ] **Step 3: Build name maps helper**

Add before the return statement, near the other derived values:

```ts
const nameMaps: NameMaps = {
  judges: new Map(judges.map(j => [j.id, `${j.first_name} ${j.last_name}`])),
  dancers: new Map(registrations.map(r => [
    r.dancer_id,
    r.dancers ? `${r.dancers.first_name} ${r.dancers.last_name} (#${r.competitor_number})` : r.dancer_id,
  ])),
}
```

- [ ] **Step 4: Add relative time helper**

Add a simple helper function in the component:

```ts
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
```

- [ ] **Step 5: Add inline audit panel JSX**

Add after the Anomaly Checks section and before the Corrections section in the JSX:

```tsx
{/* Recent Activity */}
<Card className="feis-card">
  <CardHeader>
    <CardTitle className="text-lg flex items-center justify-between">
      <span>Recent Activity</span>
      {auditEntries.length > 0 && (
        <Link
          href={`/dashboard/events/${eventId}/competitions/${compId}/audit`}
          className="text-sm font-normal text-feis-green hover:underline"
        >
          View full audit trail →
        </Link>
      )}
    </CardTitle>
  </CardHeader>
  <CardContent>
    {auditEntries.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        No audit entries yet. Entries appear as scores are entered, sign-offs recorded, and actions taken.
      </p>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-3 font-medium text-xs">When</th>
            <th className="pb-2 pr-3 font-medium text-xs">Action</th>
            <th className="pb-2 font-medium text-xs">Details</th>
          </tr>
        </thead>
        <tbody>
          {auditEntries.slice(0, 5).map(entry => {
            const formatted = formatAuditEntry(entry, nameMaps)
            return (
              <tr key={entry.id} className={`border-b last:border-0 ${formatted.isCorrection ? 'bg-orange-50' : ''}`}>
                <td
                  className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap"
                  title={new Date(entry.created_at).toLocaleString()}
                >
                  {relativeTime(entry.created_at)}
                </td>
                <td className="py-2 pr-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${formatted.badgeColor}`}>
                    {formatted.badgeText}
                  </span>
                </td>
                <td className="py-2 text-xs">{formatted.summary}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 6: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 7: Run all tests**

Run: `npm test -- --run`
Expected: All tests pass (including new audit-format tests)

- [ ] **Step 8: Commit**

```bash
git add 'src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx'
git commit -m "feat: add inline audit summary panel to competition detail page"
```

---

## Chunk 3: Full Audit Page

### Task 5: Create full audit page

**Files:**
- Create: `src/app/dashboard/events/[eventId]/competitions/[compId]/audit/page.tsx`

- [ ] **Step 1: Create the full audit page**

```tsx
'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
import {
  formatAuditEntry,
  matchesFilter,
  FILTER_GROUPS,
  type AuditEntry,
  type NameMaps,
} from '@/lib/audit-format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const PAGE_SIZE = 25

export default function AuditTrailPage({
  params,
}: {
  params: Promise<{ eventId: string; compId: string }>
}) {
  const { eventId, compId } = use(params)
  const supabase = useSupabase()
  const [comp, setComp] = useState<{ code: string | null; name: string } | null>(null)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [nameMaps, setNameMaps] = useState<NameMaps>({ judges: new Map(), dancers: new Map() })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function loadData() {
    const [compRes, judgesRes, regRes] = await Promise.all([
      supabase.from('competitions').select('code, name').eq('id', compId).single(),
      supabase.from('judges').select('id, first_name, last_name').eq('event_id', eventId),
      supabase.from('registrations').select('dancer_id, competitor_number, dancers(first_name, last_name)').eq('competition_id', compId),
    ])

    if (compRes.error) {
      setLoading(false)
      return
    }

    setComp(compRes.data)
    setNameMaps({
      judges: new Map((judgesRes.data ?? []).map(j => [j.id, `${j.first_name} ${j.last_name}`])),
      dancers: new Map((regRes.data ?? []).map((r: any) => [
        r.dancer_id,
        r.dancers ? `${r.dancers.first_name} ${r.dancers.last_name} (#${r.competitor_number})` : r.dancer_id,
      ])),
    })

    // Fetch audit entries — two queries, deduplicate
    const [byEntity, byPayload] = await Promise.all([
      supabase
        .from('audit_log')
        .select('*')
        .eq('entity_id', compId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('audit_log')
        .select('*')
        .contains('after_data', { competition_id: compId })
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    const auditMap = new Map<string, AuditEntry>()
    for (const row of [...(byEntity.data ?? []), ...(byPayload.data ?? [])]) {
      if (!auditMap.has(row.id)) {
        auditMap.set(row.id, row as AuditEntry)
      }
    }
    const sorted = [...auditMap.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    setEntries(sorted)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = entries.filter(e => matchesFilter(e.action, filter))
  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/events/${eventId}/competitions/${compId}`}
        className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" /> Back to Competition
      </Link>

      <div>
        <h1 className="text-3xl font-bold">
          Audit Trail{comp ? ` — ${comp.code ? `${comp.code} ` : ''}${comp.name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Shows score entry, sign-off, correction, and publish history for this competition.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={filter}
          onChange={e => { setFilter(e.target.value); setVisibleCount(PAGE_SIZE) }}
          className="border rounded-md px-3 py-2 text-sm"
        >
          {FILTER_GROUPS.map(g => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {entries.length === 0
                ? 'No audit entries yet. Entries appear as scores are entered, sign-offs recorded, and actions taken.'
                : 'No entries match this filter.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="feis-card">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-feis-green">
                  <th className="px-4 py-3 font-semibold text-xs">Time</th>
                  <th className="px-4 py-3 font-semibold text-xs">Action</th>
                  <th className="px-4 py-3 font-semibold text-xs">Actor</th>
                  <th className="px-4 py-3 font-semibold text-xs">Details</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(entry => {
                  const formatted = formatAuditEntry(entry, nameMaps)
                  const isExpanded = expanded.has(entry.id)
                  return (
                    <tr
                      key={entry.id}
                      className={`border-b last:border-0 ${formatted.isCorrection ? 'bg-orange-50' : ''}`}
                    >
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap align-top">
                        {new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        <br />
                        {new Date(entry.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${formatted.badgeColor}`}>
                          {formatted.badgeText}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs align-top">{formatted.actor}</td>
                      <td className="px-4 py-3 text-xs align-top">
                        <div>{formatted.summary}</div>
                        {formatted.hasRawData && (
                          <button
                            onClick={() => toggleExpanded(entry.id)}
                            className="text-xs text-muted-foreground hover:text-feis-green mt-1 underline"
                          >
                            {isExpanded ? 'Hide raw data' : 'View raw data'}
                          </button>
                        )}
                        {isExpanded && (
                          <pre className="mt-2 p-2 rounded bg-gray-50 border text-xs font-mono whitespace-pre-wrap break-all select-all">
                            {entry.before_data && (
                              <>
                                <span className="text-muted-foreground">before: </span>
                                {JSON.stringify(entry.before_data, null, 2)}
                                {'\n'}
                              </>
                            )}
                            <span className="text-muted-foreground">after: </span>
                            {JSON.stringify(entry.after_data, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {hasMore && (
        <div className="text-center">
          <Button
            variant="outline"
            onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
          >
            Load more ({filtered.length - visibleCount} remaining)
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run build to verify**

Run: `npm run build`
Expected: Build succeeds with new route `/dashboard/events/[eventId]/competitions/[compId]/audit`

- [ ] **Step 3: Run all tests**

Run: `npm test -- --run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add 'src/app/dashboard/events/[eventId]/competitions/[compId]/audit/page.tsx'
git commit -m "feat: add full audit trail page with filtering and raw data"
```

### Task 6: Final verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Clean build, new `/dashboard/events/[eventId]/competitions/[compId]/audit` route visible

- [ ] **Step 2: Run full test suite**

Run: `npm test -- --run`
Expected: All tests pass (129+ tests — 117 existing + 12 new audit-format tests)

- [ ] **Step 3: Verify no lint errors**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Final commit if needed, or tag completion**

Verify `git status` is clean. If any unstaged changes, commit them.
