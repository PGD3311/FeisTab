# Event Dashboard Redesign — Design Spec

## Goal

Redesign the event detail pages to feel like a cohesive operator workspace instead of a collection of separate pages. A shared layout wraps all event sub-pages with persistent navigation, event context, and a summary strip — no new features, purely a structural and visual refactor.

## Architecture

### Shared Event Layout

`src/app/dashboard/events/[eventId]/layout.tsx` is a **client component** that wraps all event sub-pages. It:

1. Fetches event data + competition summary once (shared across all tabs via React context)
2. Renders the back nav, event header (name, date, location, status badge, access code), and tab bar
3. Wraps `{children}` in an `EventProvider` for data sharing
4. Wraps everything in an `EventGate` that requires the event access code before rendering

The layout uses `useSupabase()` for data fetching and React's `use()` to unwrap the async `params` promise.

### Data Sharing: React Context

`src/contexts/event-context.tsx` exports `EventProvider` and `useEvent()`.

The context value shape:

```ts
interface EventContextValue {
  event: EventData | null
  competitions: CompetitionData[]
  loading: boolean
  reload: () => void
}
```

- The layout provides `event`, `competitions`, `loading`, and a `reload` function
- Child pages call `useEvent()` to access layout-level data without re-fetching
- The `reload()` function re-fetches event + competition data, used by child pages after mutations and by the overview page's polling/realtime subscriptions
- Child pages with their own data needs (judges, import) still fetch independently but skip re-fetching event-level info

### Tab Structure

7 tabs, defined in `src/components/event-tabs.tsx`:

| Tab | Route | Notes |
|---|---|---|
| Overview | `/dashboard/events/[eventId]` | Stats strip, needs attention list, stage activity, all competitions |
| Schedule | `.../program` | Schedule/program view |
| Side-Stage | `/checkin/[eventId]` | External link (`target="_blank"`), always shows as inactive |
| Judges | `.../judges` | Judge management |
| Import | `.../import` | CSV import |
| Results | `.../results` | Results publishing |
| Comments | `.../comments` | Comments view |

The Competitions sub-route (`.../competitions` and `.../competitions/[compId]`) exists but is not a tab — it is accessed from the Overview page via the "Full table view" link and from individual competition row links. Competition detail pages sit below the tab bar and keep their own back navigation.

### Tab Bar Style

Underline-style tab bar, not a segmented control. CSS classes in `globals.css`:

- **`.feis-segmented-bar`**: `display: flex`, bottom border, horizontal scroll on overflow, hidden scrollbar
- **`.feis-segmented-tab`**: 13px font, 500 weight, muted foreground color, transparent bottom border (2px), no text decoration
- **`.feis-segmented-tab-active`**: `feis-green` text color, 600 weight, `feis-green` bottom border

Active tab is determined by `usePathname()` matching against each tab's `isActive` predicate. The Side-Stage tab always returns `false` for `isActive` since it navigates away from the dashboard.

## Overview Page

`src/app/dashboard/events/[eventId]/page.tsx` is the default tab content. It renders four sections:

### 1. Summary Stats Strip

An inline `flex-wrap` strip with six data points, rendered as `<strong>` values with muted labels:

| Stat | Computation |
|---|---|
| Competitions | `competitions.length` |
| Dancers | Sum of `registrations[0].count` across all competitions |
| Published | Count where `status === 'published'` or `status === 'locked'` |
| Active | Count where status is in `ACTIVE_STATUSES` (`in_progress`, `awaiting_scores`, `ready_to_tabulate`) |
| Need Attention | Count where status is `awaiting_scores`, `ready_to_tabulate`, `recalled_round_pending`, or `complete_unpublished` |
| % Complete | Weighted average using `STATUS_WEIGHT` map (each status has a weight 0-100, divided by max possible) |

### 2. Station Links

Quick external links to Registration Desk (`/registration/[eventId]`) and Side-Stage (`/checkin/[eventId]`), both open in new tabs.

### 3. Actionable Banners

- **Bulk advance**: If any competitions are in `imported` status, shows a banner with count and a "Mark All Ready" button that advances them to `ready_for_day_of`
- **No judges warning**: If any non-draft/published/locked competitions have zero judge assignments, shows a destructive-styled banner linking to the Judges tab

### 4. Needs Attention

Lists competitions in statuses that require operator action (`awaiting_scores`, `ready_to_tabulate`, `recalled_round_pending`, `complete_unpublished`). Each row is a card linking to the competition detail page, showing competition code/name and a status badge. Shows a pulsing orange dot when items exist.

### 5. Stage Activity

Shown only when competitions have `schedule_position` values and stages exist. For each stage, shows:

- **NOW**: The currently active competition (or "No active competition")
- **NEXT**: The next ready competition with any schedule block reasons (or appropriate empty state)
- **Upcoming count**: Number of remaining competitions on that stage

Uses `groupBySchedule()` and `getScheduleBlockReasons()` from `src/lib/engine/schedule.ts`.

### 6. All Competitions

Full competition list with rows linking to competition detail pages. Each row shows code, name, stage name (on wider screens), dancer count, and status badge. Links to "Full table view" (the Competitions sub-route) in the section header. Empty state directs to the Import tab.

### Live Updates

The overview page subscribes to two update mechanisms:

- **Realtime**: Supabase channel subscription on `competitions` table `UPDATE` events, triggering `reload()`
- **Polling fallback**: 5-second interval polling via `setInterval`, paused when the tab is hidden (visibility change listener), resumed on return

## Event Header

Rendered by the layout above the tab bar:

- **Back nav row**: `< Events` link to `/dashboard` (left) + `Switch station` link to `/` (right)
- **Title row**: Event name (`text-3xl font-bold`) + status badge (right-aligned)
- **Subtitle**: Start date, location (if set), access code with click-to-copy (if set)

## Components

| File | Responsibility |
|---|---|
| `src/app/dashboard/events/[eventId]/layout.tsx` | Client layout — fetches event + competition data, renders header + tab bar, provides `EventProvider` context, wraps in `EventGate` |
| `src/components/event-tabs.tsx` | Tab bar — 7 tabs, underline style, active state via `usePathname()` |
| `src/contexts/event-context.tsx` | React context — `EventProvider`, `useEvent()` hook, `EventData` and `CompetitionData` type exports |
| `src/components/event-gate.tsx` | Access code gate — validates event access code against DB, persists in localStorage |

## What This Does NOT Include

- No new database tables or columns
- No new API endpoints
- No stage management UI (Phase 3)
- No check-in UI (Phase 3)
- No judge packet lifecycle (Phase 2/3)
- No real-time websocket infrastructure beyond existing Supabase realtime
- No new features — purely a visual/navigation restructure of existing pages

## Responsive Behavior

- Tab bar: horizontal scroll on narrow screens (no wrapping), hidden scrollbar
- Stats strip: `flex-wrap` so items flow to next line on narrow screens
- Competition rows: stage name hidden on small screens (`hidden sm:inline`)
- Station links: `flex-wrap` for narrow viewports

This is a Phase 1 prototype primarily used on laptops/desktops at event venues. Mobile polish is nice-to-have, not blocking.

## Known Risks

1. **Stale layout data after child page mutations.** The layout fetches event and competition data once on mount. Child pages that mutate competition status (e.g., advancing a competition, publishing results) must call `reload()` from the context to refresh the shared data. If a child page forgets to call `reload()`, the stats strip, needs-attention list, and tab-adjacent data will be stale until the next poll cycle (5 seconds) or realtime event.

2. **"Need Attention" is a heuristic, not real anomaly detection.** The needs-attention count is based on competition status values (`awaiting_scores`, `ready_to_tabulate`, `recalled_round_pending`, `complete_unpublished`). It does not run the anomaly engine — that would require fetching scores, rounds, results, judges, and rulesets per competition, which is too expensive for the overview. The full anomaly engine runs on individual competition detail pages where all data is already loaded.

3. **Side-Stage external link breaks the workspace mental model.** The Side-Stage tab opens `/checkin/[eventId]` in a new browser tab rather than rendering content within the dashboard layout. This is intentional (side-stage is a separate station UI) but breaks the expectation that all tabs keep you within the persistent workspace. The tab never shows as active in the tab bar.

## Testing

- `npm run build` passes
- All existing tests pass (`npm test`)
- Manual verification scenarios:
  - Navigate to each of the 7 tabs — active tab highlights correctly
  - Side-Stage tab opens in new window, does not highlight as active
  - Back arrow on every tab goes to `/dashboard`
  - Stats strip shows correct counts matching competition data
  - Needs-attention section shows only actionable-status competitions
  - Stage activity section appears only when schedule data exists
  - Competition list shows correct status badge colors and dancer counts
  - Zero competitions state renders gracefully with Import link
  - Competition detail page (`[compId]`) still has its own back arrow
  - Tab bar persists when navigating between tabs (no flash/reload)
  - `reload()` updates shared data after child page mutations
  - Access code gate blocks unauthenticated access
