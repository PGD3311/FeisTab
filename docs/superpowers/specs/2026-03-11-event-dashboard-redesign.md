# Event Dashboard Redesign — Design Spec

## Goal

Redesign the event detail pages to feel like a cohesive operator tool instead of a collection of separate pages. Take the visual polish from the ChatGPT Canvas prototype (context cards, tabbed navigation, inline blocker badges, warm card styling) and apply it to our Phase 1 scope — no new features, no Phase 2/3 creep.

## Inspiration

ChatGPT Canvas prototype ("Feistab Prototype React") demonstrated:
- Context cards at the top for instant orientation
- Tabbed workflow navigation instead of a button row
- Inline blocker callouts with progress bars
- Warm cream/green/orange palette with rounded cards

We adopt the **visual design language** but not the **information architecture** (which assumed Phase 3 features like stages, check-in, and judge packets).

## Architecture

### Shared Event Layout

A new layout component at `src/app/dashboard/events/[eventId]/layout.tsx` wraps all event sub-pages. It:

1. Fetches event data + competition summary once (shared across all tabs)
2. Renders the back arrow, event header, context cards, and segmented tab bar
3. Renders `{children}` below — the individual page content

This is a **client component** (needs `usePathname()` for active tab highlighting and `useSupabase()` for data fetching).

### Data Sharing: React Context

Next.js layouts cannot pass props to `{children}`. The layout provides event data to child pages via a **React Context provider**:

- `src/contexts/event-context.tsx` — exports `EventProvider` and `useEvent()` hook
- The layout wraps `{children}` in `<EventProvider value={{ event, competitions, loading }}>`
- Child pages that need event data call `useEvent()` instead of fetching independently
- Child pages that have their own data needs (judges page, import page) still fetch their own specific data but can skip re-fetching event-level info

This converts the Overview page and Competitions page from server components to client components (they already use client patterns elsewhere). The judges, import, and results pages are already client components.

### Tab Structure

| Tab | Route | Content |
|---|---|---|
| Overview | `/dashboard/events/[eventId]` | Competition list with inline blocker counts |
| Competitions | `.../competitions` | Competition control table |
| Judges | `.../judges` | Judge management (add/remove/codes) |
| Import | `.../import` | CSV import |
| Results | `.../results` | Results publishing |

These are our existing routes — no new routes added.

### Tab Bar Style

Segmented control (iOS-style): active tab is raised white on `feis-green-light` background with subtle shadow. Inactive tabs are flat text on the same green-light bar.

## Components

### New Files

| File | Responsibility |
|---|---|
| `src/app/dashboard/events/[eventId]/layout.tsx` | Client layout — fetches event + competition data, renders header + context cards + tab bar + `{children}` |
| `src/components/event-tabs.tsx` | Segmented control — receives `eventId`, highlights active tab via `usePathname()` |
| `src/components/event-context-cards.tsx` | 4 context cards — receives event + competition data as props |
| `src/contexts/event-context.tsx` | React context provider + `useEvent()` hook for sharing layout data with child pages |

### Modified Files

| File | Change |
|---|---|
| `src/app/dashboard/events/[eventId]/page.tsx` | Strip header, stats row, button row. Keep competition list only. Add inline blocker counts per competition. Convert to client component consuming `useEvent()` context. |
| `src/app/dashboard/events/[eventId]/competitions/page.tsx` | Strip heading. Tab content only. |
| `src/app/dashboard/events/[eventId]/judges/page.tsx` | Strip heading + back nav. Tab content only. |
| `src/app/dashboard/events/[eventId]/import/page.tsx` | Strip heading + back nav. Tab content only. |
| `src/app/dashboard/events/[eventId]/results/page.tsx` | Strip heading + back nav. Tab content only. |
| `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Keep as-is — one level deeper, below tab bar. Keeps its own back arrow to Competitions. |
| `src/app/judge/[eventId]/page.tsx` | Add back arrow linking to `/judge`. |
| `src/app/globals.css` | Add `feis-segmented-bar`, `feis-segmented-tab`, `feis-segmented-tab-active`, `feis-context-card` classes. |

## Event Header

Rendered by the layout, above the tabs:

- **Back arrow**: `< Events` linking to `/dashboard`
- **Title row**: Event name (serif h1) + status badge (right-aligned)
- **Subtitle**: Start date + location

## Context Cards

Four cards in a row below the header. These show metrics NOT already visible in the header (which has event name + status badge):

| Card | Label | Value | Color |
|---|---|---|---|
| Competitions | "Competitions" | Total count | Green (default) |
| Published | "Published" | Count with `status === 'published'` | Green (default) |
| In Progress | "In Progress" | Count with active statuses (`in_progress`, `awaiting_scores`, `ready_to_tabulate`, `recalled_round_pending`) | Green (default) |
| Blocked | "Blocked" | Count with status-based heuristic (see below) | Orange if > 0, green if 0 |

### Blocked Count Strategy

Running the full anomaly engine for every competition on the overview would require fetching scores, rounds, results, judges, and rulesets per competition — too expensive for a summary card.

Instead, use a **lightweight status-based heuristic**: count competitions whose status suggests they need attention but aren't progressing. The competition status itself is the best available signal without heavy queries. Specifically, competitions in `ready_to_tabulate` or `recalled_round_pending` are "blocked" in the sense that operator action is needed.

The full anomaly engine runs on the individual competition detail page where all the data is already loaded — that's the right place for granular blocker detection.

## Competition List Enhancement

On the Overview tab, each competition row shows:

- Competition code + name (bold)
- Age group + level (muted)
- Status badge (right-aligned, color-coded pill):
  - **Gray** (neutral): `draft`, `imported`, `ready_for_day_of`, `locked`
  - **Green** (healthy): `published`, `complete_unpublished`
  - **Orange** (needs attention): `in_progress`, `awaiting_scores`, `ready_to_tabulate`, `recalled_round_pending`

## Judge Back Navigation (separate small fix)

Add to `/judge/[eventId]/page.tsx`: a `< Back` link at the top pointing to `/judge`. This is a standalone fix unrelated to the dashboard redesign — included here for completeness since it was identified during review, but should be a separate commit.

## CSS Additions

```css
/* Segmented tab bar */
.feis-segmented-bar {
  display: inline-flex;
  background-color: var(--color-feis-green-light);
  border-radius: 8px;
  padding: 3px;
}

.feis-segmented-tab {
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--muted-foreground);
  transition: all 0.15s ease;
  text-decoration: none;
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

## What This Does NOT Include

- No new routes
- No new database tables or columns
- No new API endpoints
- No stage management (Phase 3)
- No check-in (Phase 3)
- No judge packet lifecycle (Phase 2/3)
- No real-time updates or websockets
- No new features — purely a visual/navigation restructure of existing pages

## Responsive Behavior

- Context cards: 4 columns on desktop, 2x2 grid on narrow screens (`grid-cols-2 md:grid-cols-4`)
- Segmented tab bar: horizontal scroll on narrow screens (no wrapping)
- Competition list rows: stack code/name above age/level on mobile

This is a Phase 1 prototype primarily used on laptops/desktops at event venues. Mobile polish is nice-to-have, not blocking.

## Testing

- `npm run build` passes
- All existing tests pass (`npm test`)
- Manual verification scenarios:
  - Navigate to each of the 5 tabs — active tab highlights correctly
  - Back arrow on every tab goes to `/dashboard`
  - Context cards show correct counts matching competition data
  - Competition list shows correct status pill colors
  - Zero competitions state renders gracefully
  - Competition detail page (`[compId]`) still has its own back arrow to Competitions
  - Tab bar persists when navigating between tabs (no flash/reload)
