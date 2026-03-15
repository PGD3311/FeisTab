# Side-Stage Event Arrival Awareness

**Date:** 2026-03-15
**Goal:** Give the side-stage operator visibility into whether each dancer has arrived at the event, not just whether they're confirmed for a specific competition. Close the gap between "the app works" and "the room works."

---

## Problem

Side-stage currently reads `registrations.status` and `registrations.competitor_number`. It can tell if a dancer is `present` for a competition, but cannot distinguish between:

- A dancer who never checked in at the event (probably absent)
- A dancer who checked in at the door but hasn't come to side-stage yet (somewhere in the building)

This distinction matters operationally. The dad's scenario: "Penelope picked up her number but isn't at side-stage. Announce her on the mic." Without arrival awareness, Erin can't tell Penelope apart from someone who never showed up.

---

## Design

### Data Query

**Current:** Side-stage queries `registrations` per competition for dancer name, competitor number, and status.

**New:** Side-stage also queries `event_check_ins` once per polling cycle (event-wide, not per-competition). Builds a `Map<dancerId, CheckInRow>` and reuses it across all competition rosters.

Query:
```ts
supabase
  .from('event_check_ins')
  .select('dancer_id, competitor_number, checked_in_at')
  .eq('event_id', eventId)
```

Refreshed on the existing 5-second polling interval. One fetch per cycle, not per competition.

### Competitor Number Source

Side-stage now reads competitor number from `event_check_ins` (source of truth) instead of `registrations.competitor_number`. Fallback to `registrations.competitor_number` if no `event_check_ins` row exists (safety net for unsynced or legacy data).

### Per-Dancer State Derivation

For each dancer in a competition roster:

| State | Condition | Visual |
|-------|-----------|--------|
| **Present** | `registrations.status === 'present'` | Green checkmark (existing behavior, no change) |
| **Arrived** | `event_check_ins.checked_in_at` is set AND `registrations.status !== 'present'` | `Arrived` badge (muted teal/blue). If competition is in an active state: "Call to stage" hint text. |
| **Not Arrived — no number** | No `event_check_ins` row for this dancer | `Not arrived` text + "No number" subtext |
| **Not Arrived — awaiting** | `event_check_ins` row exists, `checked_in_at` is null | `Not arrived` text + "Number assigned, not checked in" subtext. Competitor number shown dimmed. |

The "Call to stage" hint only shows when the competition is in a scoring-relevant status: `released_to_judge`, `in_progress`, or `awaiting_scores`. This is intentionally broader than the codebase's `ACTIVE_STATUSES` (which excludes `released_to_judge`) — the reasoning is that once a judge has the packet, missing dancers should be flagged. On setup/draft competitions, arrival info is shown but the action hint is suppressed to reduce noise.

**Known limitation:** The existing 5-second poll refreshes `event_check_ins` and competition statuses, but does NOT re-fetch the expanded competition's registration roster. If a dancer's `registrations.status` changes on another screen (e.g., marked present), the side-stage operator won't see it until they collapse and re-expand that competition. This is acceptable for now — the existing page has this same limitation.

### What Does NOT Change

- Roster confirmation flow (mark present / scratched / no-show)
- Heat display and grouping
- Polling interval (5 seconds)
- Competition grouping (scoring, sent, waiting, done)
- The existing actions (confirm roster, release to judge, etc.)
- `registrations.status` is still the source for competition-level presence

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/app/checkin/[eventId]/page.tsx` | Add `event_check_ins` query, arrival indicator per dancer, read competitor number from check-ins |

Single-file change. The query result `{ dancer_id, competitor_number, checked_in_at }` is mapped into `Map<string, CheckInRow>` using `dancer_id` as the key. `CheckInRow` (from `src/lib/check-in.ts`) has `competitor_number` and `checked_in_at` — the `dancer_id` is only needed for map construction, not stored in the value. No changes to `CheckInRow` needed.

**Note on competitor number nullability:** `event_check_ins.competitor_number` is `NOT NULL` (always a string), but the fallback `registrations.competitor_number` is `string | null`. When falling back, the display should handle `null` (show a dash, matching existing behavior at line 914).

---

## Testing

No new automated tests (side-stage is UI, manually tested per project convention).

**Manual test cases:**
1. Dancer with no `event_check_ins` row → shows "Not arrived · No number"
2. Dancer with `event_check_ins` row but `checked_in_at` null → shows "Not arrived · Number assigned, not checked in" with dimmed number
3. Dancer with `checked_in_at` set but not marked present → shows "Arrived" badge. If competition is active, shows "Call to stage"
4. Dancer marked present → green checkmark (unchanged)
5. Competitor number displays from `event_check_ins`, not `registrations`
6. Fallback: dancer with `registrations.competitor_number` but no `event_check_ins` row → shows registration number

---

## Acceptance Criteria

1. Side-stage shows arrival state per dancer (Present / Arrived / Not Arrived)
2. Not Arrived distinguishes "no number" from "number assigned, not checked in"
3. Arrived dancers in active competitions show "Call to stage" hint
4. Competitor number reads from `event_check_ins` with fallback to registrations
5. One `event_check_ins` query per polling cycle, not per competition
6. Existing side-stage functionality (roster confirmation, heats, actions) unchanged

---

## What This Does NOT Include

- Automatic mic announcement system
- New state machine statuses
- Changes to any page other than side-stage
- Removing `registrations.competitor_number` (Phase 3)
- Dashboard-level arrival summary
