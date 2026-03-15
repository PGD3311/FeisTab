# Event Dashboard Redesign

**Date:** 2026-03-14
**Goal:** Redesign the event overview dashboard from a landing page into an operations console. Answer three questions: what needs attention, what's happening on each stage, what's the state of every competition.

---

## Problem

The current overview page leads with a large Event Progress card (percentage, pipeline bar, stat counters) and promotional quick-link cards (Program, Side-Stage, Registration Desk). This layout prioritizes summaries and navigation over operational information. An organizer running a live feis needs to see what requires action, not what percentage they're at.

---

## Design

### What stays

- **Event header** (compact: name, date/location, active badge) — already handled by layout
- **Tab row** (Overview, Competitions, Program, Judges, Import, Results) — already handled by layout
- **Stage Activity section** — already exists, good structure, keep it
- **Needs Attention section** — already exists, promote it to first position
- **All Competitions section** — already exists, keep as final section

### What gets removed

- **Large Event Progress card** (percentage, pipeline bar, phase legend) — replaced by summary strip
- **Quick-link cards** (Program, Side-Stage, Registration Desk) — these are already in the tab row or accessible from the nav. Removing the promotional cards.
- **Large stat counters** (competitions, dancers, published as big numbers) — folded into summary strip
- **`EventContextCards`** — the layout renders a 4-card grid (Competitions, Published, In Progress, Blocked) above the tab bar. This duplicates the summary strip. Remove it from the layout.

### What gets added

- **Summary strip** — one compact line replacing the progress card and stat counters

---

## Layout (top to bottom)

### 1. Summary Strip

One horizontal strip, no card wrapper. Compact inline stats separated by middots or pipes:

```
3 competitions · 15 dancers · 2 published · 1 active · 2 need attention · 80% complete
```

Implementation:
- Derive all values from existing `competitions` array (already loaded via event context)
- `need attention` = competitions in `awaiting_scores`, `ready_to_tabulate`, `recalled_round_pending`, or `complete_unpublished` (same as current `needsAttention` filter). **Do not use the word "blocked"** — the codebase has a separate `BLOCKED_STATUSES` constant with a narrower definition. "Need attention" matches the section below and avoids confusion.
- `active` = competitions in `ACTIVE_STATUSES`
- `complete` percentage = same weighted formula already in the page
- Style: `text-sm text-muted-foreground` with `font-semibold text-foreground` on the numbers
- No card, no border — just a text line with light bottom border as separator

### 2. Needs Attention

**First main section.** Promoted from its current position (was after Stage Activity).

- Keep the existing structure: pulsing orange dot, heading, count
- Each row: competition link with code, name, metadata, status badge
- **Add an action hint** per status, displayed as `text-xs text-muted-foreground` after the status badge:
  - `awaiting_scores` → "Waiting for sign-offs"
  - `ready_to_tabulate` → "Ready to tabulate"
  - `recalled_round_pending` → "Recall round pending"
  - `complete_unpublished` → "Ready to publish"
- If no competitions need attention: show "No competitions need attention right now." in muted text. Do not hide the section heading — the absence of items is itself useful information.

### 3. Stage Activity

**Second main section.** Keep the existing NOW/NEXT structure per stage.

Changes from current:
- Slightly tighter spacing (reduce from `space-y-3` to `space-y-2` on cards)
- Keep block reason display on NEXT
- No other changes — the existing stage activity section is already well-structured

Only render this section if stages exist and at least one competition has a `schedule_position`. Same condition as current.

### 4. All Competitions

**Final section.** Keep the existing compact list.

Changes from current:
- Add stage name as a subtle label in each row (when assigned). Use the `stages` array already loaded in the `useEffect` to build a `stageId → name` map. Access `stage_id` on competitions via the existing unsafe cast pattern (`(c as unknown as Record<string, unknown>).stage_id`).
- Keep: code, name, metadata, dancer count, status badge
- Keep: "Full table view" link to `/competitions`
- Keep: empty state with link to Import

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/app/dashboard/events/[eventId]/page.tsx` | Restructure overview layout |
| Modify | `src/app/dashboard/events/[eventId]/layout.tsx` | Remove `EventContextCards` |

Two-file change. No new components, no new data queries. All data is already loaded.

---

## What This Does NOT Include

- Changing the tab row
- Changing the event header
- Adding new data queries or API calls
- Changing any sub-pages (competitions, program, judges, import, results)
- Changing the competition status badge component
- Adding real-time updates or polling

---

## Acceptance Criteria

1. Summary strip shows stats in one compact line (using "need attention" not "blocked")
2. Needs Attention is the first section after the summary strip
3. Stage Activity is the second section
4. All Competitions is the final section
5. No Event Progress card (percentage hero, pipeline bar, phase legend)
6. No quick-link promo cards (Program, Side-Stage, Registration Desk)
7. `EventContextCards` removed from layout (summary strip replaces it)
8. Page loads the same data as before — no new queries
9. Empty states work correctly (no competitions, no stages, no attention items)
