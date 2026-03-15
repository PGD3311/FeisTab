# Comment Sheet Output

**Date:** 2026-03-15
**Goal:** Per-dancer printable comment sheet showing all judge feedback across their competitions. Layer B of the comments system — capture (Layer A) is already done.

---

## Problem

Comments are captured on score entries (`comment_data` with checkbox codes + optional note), but there's no way to view or print them. At a real feis, parents expect a feedback sheet for their dancer. The organizer needs to hand them something clean immediately when asked.

---

## Design

### Route

`/dashboard/events/[eventId]/comments/[dancerId]` — per-dancer comment sheet.

Also needs an index page to find the dancer: `/dashboard/events/[eventId]/comments` — search/list of dancers with a link to each sheet.

### Index Page (dancer list)

Simple search page:
- Search by dancer name
- Show all dancers registered for the event
- Each row: competitor number, name, school, number of competitions with comments
- Click → opens the per-dancer comment sheet

### Per-Dancer Comment Sheet

**Header:**
- Dancer name
- Competitor number (from `event_check_ins`, fallback to `registrations`)
- Event name

**Body — one section per competition:**
- Competition code + name (e.g., "B101 — Beginner Reel")
- Per judge who scored that dancer:
  - Judge name
  - Comment codes as labels (e.g., "Turnout · Timing")
  - Note (if any)
  - If no `comment_data` but legacy `comments` text exists, show that as "Note: {text}"
  - If no comments at all for this judge, show "No comments recorded"
- Score and placement are NOT shown on the comment sheet (that's result explainability, a separate feature)

**Empty state:** If the dancer has no comments across any competition, show "No feedback recorded for this dancer yet."

### Print-Friendly

The comment sheet page should be print-friendly:
- `@media print` styles: hide nav/header, use full width, clean typography
- A "Print" button on the page that calls `window.print()`
- No heavy card borders or backgrounds in print — just clean text

### Data Query

One query per dancer, joining across:
- `registrations` — which competitions they're in
- `competitions` — competition code + name
- `score_entries` — scores with `comment_data` and `comments`, joined with `judges` for judge name
- `event_check_ins` — competitor number (source of truth)

**Index page:** Client component (needs search interactivity). Uses `useSupabase()`.

**Per-dancer comment sheet:** Client component (needs the Print button which calls `window.print()`). Uses `useSupabase()`. The page is mostly read-only but the print action requires client-side JavaScript.

**`dancerId` URL parameter** is the `dancers.id` UUID, not a competitor number. The index page links using this UUID.

**Round handling:** Show comments from all rounds (including recall rounds). Group by competition, then by judge — if a judge scored multiple rounds, their comments from each round appear separately.

**Index page query shape:** A single aggregate query, not N+1. Join `registrations → score_entries` grouped by `dancer_id`, counting distinct competitions where `comment_data IS NOT NULL OR comments IS NOT NULL`.

### Code Label Resolution

Comment codes (`["turnout", "timing"]`) need to be resolved to human-readable labels (`"Turnout · Timing"`). Use `COMMENT_CODES` from `src/lib/comment-codes.ts` to map `code → label`. Unknown codes display as-is (no crash).

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/app/dashboard/events/[eventId]/comments/page.tsx` | Dancer search/list index |
| Create | `src/app/dashboard/events/[eventId]/comments/[dancerId]/page.tsx` | Per-dancer comment sheet |

Two new pages. No new components, no engine changes. Uses existing `COMMENT_CODES` from `src/lib/comment-codes.ts`.

---

## Navigation

Add "Comments" to the event tab bar (`src/components/event-tabs.tsx`) between Judges and Import:

`Overview | Competitions | Program | Side-Stage ↗ | Judges | Comments | Import | Results`

---

## Testing

No automated tests — these are read-only server pages. Manual testing:

1. Dancer with comments across multiple competitions → all shown, grouped by competition
2. Dancer with no comments → empty state message
3. Competition with multiple judges → each judge's feedback shown separately
4. Legacy `comments` text fallback → displayed as note
5. Print → clean output, no navigation chrome
6. Comment codes resolve to labels correctly

---

## Acceptance Criteria

1. Index page lists all dancers for the event with search
2. Per-dancer sheet shows all competitions with judge feedback
3. Comment codes display as human-readable labels
4. Optional note displayed when present
5. Legacy comments text displayed as fallback
6. Print-friendly layout (clean, no nav)
7. "Print" button works
8. Empty state when no comments exist
9. Competitor number reads from `event_check_ins` with fallback
10. Comments tab appears in event navigation

---

## What This Does NOT Include

- Per-competition comment view (all dancers in one competition)
- PDF generation or download
- Parent-facing portal or auth
- Email/SMS delivery of comment sheets
- Score or placement data on the comment sheet
