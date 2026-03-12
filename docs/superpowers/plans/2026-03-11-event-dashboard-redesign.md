# Event Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure event detail pages with a shared layout containing context cards, segmented tab bar, and React Context for data sharing — no new features, Phase 1 scope only.

**Architecture:** New client layout at `[eventId]/layout.tsx` fetches event + competition data once and shares it via React Context (`EventProvider`). Segmented tab bar highlights the active route via `usePathname()`. Child pages strip their redundant headers and consume shared data via `useEvent()`.

**Tech Stack:** Next.js 15 App Router, React Context, Tailwind CSS, lucide-react, existing `useSupabase()` hook, existing `CompetitionStatusBadge` component.

**Spec:** `docs/superpowers/specs/2026-03-11-event-dashboard-redesign.md`

---

## Chunk 1: Foundation (CSS + Context + Components)

### Task 1: Add CSS classes for segmented tabs and context cards

**Files:**
- Modify: `src/app/globals.css`

- [x] **Step 1: Add CSS classes at the end of `@layer components`**

Append before the closing `}` of `@layer components` in `globals.css`:

```css
  /* Segmented tab bar */
  .feis-segmented-bar {
    display: inline-flex;
    background-color: var(--color-feis-green-light);
    border-radius: 8px;
    padding: 3px;
    overflow-x: auto;
  }

  .feis-segmented-tab {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--muted-foreground);
    transition: all 0.15s ease;
    text-decoration: none;
    white-space: nowrap;
  }

  .feis-segmented-tab-active {
    background: white;
    color: var(--color-feis-green);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  /* Context card */
  .feis-context-card {
    background: white;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px;
  }
```

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [x] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: add CSS classes for segmented tabs and context cards"
```

---

### Task 2: Create EventContext provider

**Files:**
- Create: `src/contexts/event-context.tsx`

- [x] **Step 1: Create the context file**

```tsx
'use client'

import { createContext, useContext } from 'react'
import { type CompetitionStatus } from '@/lib/competition-states'

interface EventData {
  id: string
  name: string
  start_date: string
  end_date: string | null
  location: string | null
  status: string
  registration_code: string | null
}

interface CompetitionData {
  id: string
  code: string | null
  name: string
  age_group: string
  level: string
  status: CompetitionStatus
  event_id: string
  registrations: [{ count: number }] | null
}

export type { EventData, CompetitionData }

interface EventContextValue {
  event: EventData | null
  competitions: CompetitionData[]
  loading: boolean
  reload: () => void
}

const EventContext = createContext<EventContextValue>({
  event: null,
  competitions: [],
  loading: true,
  reload: () => {},
})

export function EventProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: EventContextValue
}) {
  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
}

export function useEvent(): EventContextValue {
  return useContext(EventContext)
}
```

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/contexts/event-context.tsx
git commit -m "feat: add EventContext provider for shared event data"
```

---

### Task 3: Create EventTabs segmented control component

**Files:**
- Create: `src/components/event-tabs.tsx`

- [x] **Step 1: Create the component**

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { label: 'Overview', path: '' },
  { label: 'Competitions', path: '/competitions' },
  { label: 'Judges', path: '/judges' },
  { label: 'Import', path: '/import' },
  { label: 'Results', path: '/results' },
]

export function EventTabs({ eventId }: { eventId: string }) {
  const pathname = usePathname()
  const basePath = `/dashboard/events/${eventId}`

  return (
    <nav className="feis-segmented-bar">
      {tabs.map(tab => {
        const href = `${basePath}${tab.path}`
        const isActive = tab.path === ''
          ? pathname === basePath
          : pathname.startsWith(href)

        return (
          <Link
            key={tab.label}
            href={href}
            className={`feis-segmented-tab ${isActive ? 'feis-segmented-tab-active' : ''}`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/components/event-tabs.tsx
git commit -m "feat: add EventTabs segmented control component"
```

---

### Task 4: Create EventContextCards component

**Files:**
- Modify: `src/lib/competition-states.ts`
- Create: `src/components/event-context-cards.tsx`

The context cards component receives competition data and computes the 4 metrics. Status groupings are centralized in `competition-states.ts` so they stay co-located with the status definitions.

- [x] **Step 1: Add status grouping helpers to `competition-states.ts`**

Append to the end of `src/lib/competition-states.ts`:

```ts
/** Statuses where a competition is actively being worked on */
export const ACTIVE_STATUSES: CompetitionStatus[] = [
  'in_progress', 'awaiting_scores', 'ready_to_tabulate', 'recalled_round_pending',
]

/** Statuses where operator action is needed to unblock progress */
export const BLOCKED_STATUSES: CompetitionStatus[] = [
  'ready_to_tabulate', 'recalled_round_pending',
]
```

- [x] **Step 2: Create the component**

```tsx
'use client'

import { type CompetitionStatus, ACTIVE_STATUSES, BLOCKED_STATUSES } from '@/lib/competition-states'

interface Competition {
  status: CompetitionStatus
}

interface EventContextCardsProps {
  competitions: Competition[]
}

export function EventContextCards({ competitions }: EventContextCardsProps) {
  const total = competitions.length
  const published = competitions.filter(c => c.status === 'published').length
  const inProgress = competitions.filter(c => ACTIVE_STATUSES.includes(c.status)).length
  const blocked = competitions.filter(c => BLOCKED_STATUSES.includes(c.status)).length

  const cards = [
    { label: 'Competitions', value: total, orange: false },
    { label: 'Published', value: published, orange: false },
    { label: 'In Progress', value: inProgress, orange: false },
    { label: 'Blocked', value: blocked, orange: blocked > 0 },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map(card => (
        <div key={card.label} className="feis-context-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
            {card.label}
          </p>
          <p className={`feis-stat ${card.orange ? 'text-feis-orange' : ''}`}>
            {card.value}
          </p>
        </div>
      ))}
    </div>
  )
}
```

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/lib/competition-states.ts src/components/event-context-cards.tsx
git commit -m "feat: add EventContextCards with centralized status groupings"
```

---

## Chunk 2: Layout + Page Modifications

### Task 5: Create shared event layout

**Files:**
- Create: `src/app/dashboard/events/[eventId]/layout.tsx`

This is the core of the redesign. The layout fetches event + competition data, provides it via context, and renders the header + cards + tabs chrome around `{children}`.

- [x] **Step 1: Create the layout**

```tsx
'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
import { EventProvider, type EventData, type CompetitionData } from '@/contexts/event-context'
import { EventTabs } from '@/components/event-tabs'
import { EventContextCards } from '@/components/event-context-cards'
import { Badge } from '@/components/ui/badge'

export default function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const [event, setEvent] = useState<EventData | null>(null)
  const [competitions, setCompetitions] = useState<CompetitionData[]>([])
  const [loading, setLoading] = useState(true)

  async function loadData() {
    const [eventRes, compRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('competitions').select('*, registrations(count)').eq('event_id', eventId).order('code'),
    ])

    if (eventRes.error) {
      console.error('Failed to load event:', eventRes.error.message)
    }
    if (compRes.error) {
      console.error('Failed to load competitions:', compRes.error.message)
    }

    setEvent(eventRes.data as EventData | null)
    setCompetitions((compRes.data as CompetitionData[] | null) ?? [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [eventId])

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>
  }

  if (!event) {
    return <p className="text-muted-foreground">Event not found.</p>
  }

  return (
    <EventProvider value={{ event, competitions, loading, reload: loadData }}>
      <div className="space-y-5">
        {/* Back nav */}
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Events
        </Link>

        {/* Event header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{event.name}</h1>
            <p className="text-muted-foreground text-sm">
              {event.start_date} {event.location && `· ${event.location}`}
            </p>
          </div>
          <Badge variant={event.status === 'active' ? 'default' : 'secondary'}>
            {event.status}
          </Badge>
        </div>

        {/* Context cards */}
        <EventContextCards competitions={competitions} />

        {/* Segmented tab bar */}
        <EventTabs eventId={eventId} />

        {/* Tab content */}
        <div>{children}</div>
      </div>
    </EventProvider>
  )
}
```

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds. Note: some child pages may now show duplicate headers — that's expected until we strip them in the next tasks.

- [x] **Step 3: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/layout.tsx
git commit -m "feat: add shared event layout with header, context cards, and tab bar"
```

---

### Task 6: Simplify Overview page (event detail)

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/page.tsx`

Strip the header, stats row, button row, and back nav — the layout provides all of that now. Keep only the competition list. Convert to client component consuming `useEvent()`. Replace the plain `Badge` with `CompetitionStatusBadge` for color-coded pills.

- [x] **Step 1: Rewrite the page**

Replace the entire contents of `src/app/dashboard/events/[eventId]/page.tsx` with:

```tsx
'use client'

import Link from 'next/link'
import { useEvent } from '@/contexts/event-context'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function EventOverviewPage() {
  const { event, competitions } = useEvent()

  if (!event) return null

  const eventId = event.id

  return (
    <Card className="feis-card">
      <CardHeader>
        <CardTitle className="text-lg">Competitions</CardTitle>
      </CardHeader>
      <CardContent>
        {competitions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No competitions yet. Import registrations to create competitions automatically.
          </p>
        ) : (
          <div className="space-y-2">
            {competitions.map(comp => (
              <Link
                key={comp.id}
                href={`/dashboard/events/${eventId}/competitions/${comp.id}`}
                className="flex items-center justify-between p-3 rounded-md border hover:bg-feis-green-light/50 transition-colors"
              >
                <div>
                  <span className="font-medium">{comp.code && `${comp.code} — `}{comp.name}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {comp.age_group} · {comp.level}
                  </span>
                </div>
                <CompetitionStatusBadge status={comp.status} />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds. Navigate to an event — should see layout chrome + competition list with colored status pills.

- [x] **Step 3: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/page.tsx
git commit -m "refactor: simplify event overview page to use shared layout and context"
```

---

### Task 7: Simplify Competitions page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/page.tsx`

Strip the heading and back nav — the layout provides them. The competitions page **stays as a server component** — it fetches its own detailed data (rounds + score counts per competition) that the layout doesn't have. This is an intentional deviation from the spec: the spec said to convert it to client, but it needs server-side data not available in the layout context. Next.js supports server component children inside client layouts.

- [x] **Step 1: Update the page**

In `src/app/dashboard/events/[eventId]/competitions/page.tsx`:

1. Remove the `ChevronLeft` import (if present) and back nav link
2. Remove the `<div className="flex items-center justify-between mb-6">` wrapper containing the heading
3. Keep the table as the top-level content

The return should start directly with the table card, no heading wrapper:

```tsx
  return (
    <div className="feis-card overflow-hidden">
      <table className="w-full text-sm">
        {/* ... existing table content unchanged ... */}
      </table>
    </div>
  )
```

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/competitions/page.tsx
git commit -m "refactor: strip heading from competitions page (provided by layout)"
```

---

### Task 8: Simplify Judges page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/judges/page.tsx`

Strip the heading, subtitle, and back nav link. Keep the Add Judge card and Judge List card.

- [x] **Step 1: Update the page**

In `src/app/dashboard/events/[eventId]/judges/page.tsx`:

1. Remove the `Link` and `ChevronLeft` imports
2. Remove the back nav `<Link>` element
3. Remove the `<h1>` heading and the `<p>` subtitle below it
4. The return should start with the Add Judge card directly

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/judges/page.tsx
git commit -m "refactor: strip heading from judges page (provided by layout)"
```

---

### Task 9: Simplify Import page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/import/page.tsx`

Strip the heading and back nav link. Keep the upload card and preview/import functionality.

- [x] **Step 1: Update the page**

In `src/app/dashboard/events/[eventId]/import/page.tsx`:

1. Remove the `ChevronLeft` import (from lucide-react)
2. Remove the back nav `<Link>` element
3. Remove the `<h1>` heading
4. The return should start with the Upload CSV card directly

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/import/page.tsx
git commit -m "refactor: strip heading from import page (provided by layout)"
```

---

### Task 10: Simplify Results page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/results/page.tsx`

Strip the heading and back nav link.

- [x] **Step 1: Update the page**

In `src/app/dashboard/events/[eventId]/results/page.tsx`:

1. Remove the `Link` and `ChevronLeft` imports
2. Remove the back nav `<Link>` element
3. Remove the `<h1>` heading
4. The return should start with the public results page info + cards directly

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/app/dashboard/events/\[eventId\]/results/page.tsx
git commit -m "refactor: strip heading from results page (provided by layout)"
```

---

### Task 11: Add back nav to judge event page

**Files:**
- Modify: `src/app/judge/[eventId]/page.tsx`

This page already imports `Link`. Add a `ChevronLeft` back arrow pointing to `/judge` at the top of the return JSX.

- [x] **Step 1: Add import and back link**

Add `import { ChevronLeft } from 'lucide-react'` to imports.

Add before the existing `<div className="flex items-center justify-between">`:

```tsx
<Link
  href="/judge"
  className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
>
  <ChevronLeft className="h-4 w-4" /> Back
</Link>
```

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/app/judge/\[eventId\]/page.tsx
git commit -m "feat: add back navigation to judge event page"
```

---

### Task 12: Final verification

- [x] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with all routes rendering.

- [x] **Step 2: Run all tests**

Run: `npm test`
Expected: All 97 tests pass. No test changes needed — this is a UI-only restructure.

- [x] **Step 3: Manual smoke test**

Open `http://localhost:3000/dashboard` and verify:
1. Click into an event — see layout with back arrow, header, 4 context cards, segmented tab bar
2. Click each tab — content switches, active tab highlights, URL updates
3. Click a competition from Overview → goes to competition detail with its own back arrow to Competitions
4. Zero competitions event shows empty state message
5. Tab bar persists across all tabs (no page flash)
6. Go to `/judge`, log in, verify back arrow on event page
