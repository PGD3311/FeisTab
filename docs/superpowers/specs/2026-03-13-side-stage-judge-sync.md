# Side-Stage ↔ Judge Sync

## Goal

Give the side-stage person and judge a connected, real-time handoff workflow so competitions flow from roster confirmation to scoring without ambiguity about who owns what.

## Problem

Today the side-stage person confirms a roster and the judge independently starts scoring. There is no explicit handoff signal between them. At a large feis with multiple stages, the judge has no way to know "side-stage is done, dancers are heading to you" — and the side-stage person has no way to know "judge is done, send the next group."

## Design

### State Machine Change

Add one new competition status: `released_to_judge`.

```
ready_for_day_of → released_to_judge → in_progress → awaiting_scores → ready_to_tabulate → ...
```

**Status meanings:**

| Status | Meaning | Next actor |
|---|---|---|
| `ready_for_day_of` | Event-day setup complete. Roster may or may not be confirmed. | Side-stage / Organizer |
| `released_to_judge` | Side-stage has handed this competition to the judge. Dancers are ready. | Judge |
| `in_progress` | Judge has started scoring. | Judge |

**Transitions:**

| From | To | Trigger | Precondition |
|---|---|---|---|
| `ready_for_day_of` | `released_to_judge` | Side-stage taps "Send to Judge" | `roster_confirmed_at IS NOT NULL` |
| `released_to_judge` | `ready_for_day_of` | Side-stage taps "Recall" | Judge has not started (`in_progress` not reached) |
| `released_to_judge` | `in_progress` | Judge taps "Start Scoring" | — |
| `ready_for_day_of` | `in_progress` | Judge taps "Start Scoring" (fallback) | `roster_confirmed_at IS NOT NULL` |

**Fallback path:** The `ready_for_day_of` → `in_progress` transition is for small feiseanna without a dedicated side-stage person. It is not a shortcut around the handoff workflow. The spec explicitly permits this path only when no side-stage handoff is being used for that event.

**Reverse transition:** `released_to_judge` → `ready_for_day_of` is the only reverse transition in the state machine. It is allowed because the handoff has not been acted on yet — the judge has not started. Once `in_progress` is reached, the handoff is final and cannot be reversed.

**Roster confirmation gate:** Roster confirmation is a precondition for both `released_to_judge` and the fallback `in_progress` transition. It is NOT a lifecycle stage — it is a gate.

The existing `roster_confirmed` boolean is upgraded to auditable fields:

- `roster_confirmed_at: timestamp | null` — when the roster was confirmed
- `roster_confirmed_by: text | null` — who confirmed it (role label for prototype, user_id later)

Derived check: `is_confirmed = roster_confirmed_at IS NOT NULL`. Unconfirming clears both fields. This replaces the plain boolean — same semantics, better auditability, easy undo by nulling.

**State machine implementation:** In `competition-states.ts`, `ready_for_day_of` gets two valid targets: `['released_to_judge', 'in_progress']`. The `released_to_judge` status gets targets: `['in_progress', 'ready_for_day_of']` (the reverse is the recall path).

**`getTransitionBlockReason()` for new transitions:**

| Transition | Block reason |
|---|---|
| `ready_for_day_of` → `released_to_judge` | Blocked if `roster_confirmed_at IS NULL` ("Roster must be confirmed before sending to judge"). Blocked if `judgeCount === 0` ("No judges assigned"). |
| `ready_for_day_of` → `in_progress` (fallback) | Blocked if `roster_confirmed_at IS NULL`. Blocked if `judgeCount === 0`. (Existing behavior, unchanged.) |
| `released_to_judge` → `in_progress` | No preconditions — judge is expected to start. |
| `released_to_judge` → `ready_for_day_of` | No preconditions — recall is always allowed from this state. |

**Race condition (concurrent recall + start):** Both the recall and start transitions use atomic conditional updates: `UPDATE competitions SET status = $new WHERE id = $id AND status = 'released_to_judge'`. If two transitions race, only one succeeds (row count = 1). The loser gets row count = 0 and the UI shows a toast: "Competition status has changed — refreshing." Then re-fetches current state.

**Audit action:** All new transitions use the existing `status_change` audit action. No new action types needed.

### Schema Migration

The `competitions.status` column is an unconstrained text field (no Postgres enum or CHECK constraint). No migration is needed for the new status value. The state machine in `competition-states.ts` is the single source of truth for valid statuses and transitions.

**Migration required for roster confirmation upgrade:**
- Add `roster_confirmed_at: timestamptz default null` to `competitions`
- Add `roster_confirmed_by: text default null` to `competitions`
- Migrate existing data: `UPDATE competitions SET roster_confirmed_at = now() WHERE roster_confirmed = true`
- Drop `roster_confirmed` boolean column

All existing code that checks `roster_confirmed` must be updated to check `roster_confirmed_at IS NOT NULL`.

### Organizer Dashboard

The organizer's competition detail page at `/dashboard/.../competitions/[compId]` uses `getNextStates()` to show available transitions. `released_to_judge` will automatically appear as a valid next state from `ready_for_day_of`. The organizer can also manually transition from `released_to_judge` → `in_progress` or recall back to `ready_for_day_of`.

**Transition labels:**
- `ready_for_day_of` → `released_to_judge`: "Send to Judge"
- `released_to_judge` → `in_progress`: "Start Scoring"
- `released_to_judge` → `ready_for_day_of`: "Recall to Side-Stage"

### Audit Metadata

Every transition is audit-logged via `logAudit()`. Additionally, timestamp metadata is recorded on transition:

- `released_to_judge_at` — when side-stage sent it (stored in audit `afterData`)
- `judge_started_at` — when judge tapped Start Scoring (stored in audit `afterData`)

State tells you what is true now. Timestamps tell you when it became true.

### Real-Time Sync (Supabase Realtime)

Both the side-stage and judge pages subscribe to Supabase Realtime on the `competitions` table, filtered to relevant competition IDs. This replaces the current 5-second polling for status changes.

**Side-stage → Judge signal:**
1. Side-stage taps "Send to Judge"
2. Competition status updates to `released_to_judge`
3. Judge's Realtime subscription fires
4. Competition appears in judge's "Incoming" group with orange highlight

**Judge → Side-stage signal:**
1. Judge signs off on competition
2. Competition status transitions forward (→ `awaiting_scores` → `ready_to_tabulate`)
3. Side-stage's Realtime subscription fires
4. Competition moves to side-stage's "Complete" group
5. Side-stage knows to send next group

**Polling kept as fallback:** If Realtime connection drops, the existing 5-second polling continues to work. Realtime is an enhancement, not a hard dependency.

### Side-Stage UI Changes

**Page:** `/checkin/[eventId]`

**Group renaming:**
- NOW → **Scoring** (competitions currently being scored: `in_progress`, `awaiting_scores`)
- (new) **Sent** (`released_to_judge` — handed off, waiting for judge)
- NEXT → **Ready** (`ready_for_day_of` + `roster_confirmed_at` — can send to judge)
- UPCOMING → **Upcoming** (`ready_for_day_of` + NOT confirmed, `imported`, `draft`)
- DONE → **Complete** (`ready_to_tabulate`, `complete_unpublished`, `published`, `locked`). Note: `recalled_round_pending` also appears here — it means another round is needed, but from the side-stage perspective the current round's handoff work is done.

**New UI elements:**

1. **"Send to Judge →" button** — appears on competition cards in the "Ready" group (after roster is confirmed). Big, green (`bg-feis-green`), full-width within the expanded card. Tapping it transitions the competition to `released_to_judge`.

2. **"Sent to Judge" state** — after sending, the card shows:
   - Green pulsing dot + "Sent to Judge" badge
   - "Waiting for judge to start scoring..."
   - Dancer count: "8 dancers ready"

3. **"Recall" button** — appears on cards in "Sent" state. Outline/secondary style. Returns competition to `ready_for_day_of` (preserves `roster_confirmed_at` so it stays in "Ready" group). Only available while judge hasn't started.

4. **"Complete" group** — replaces "Done." Shows competitions that have finished scoring. Label: "Complete" with count.

### Judge UI Changes

**Page:** `/judge/[eventId]`

**Group changes:**

| Group | Statuses | Behavior |
|---|---|---|
| **Scoring** | `in_progress`, `awaiting_scores` | Links to score entry (existing) |
| **Incoming** | `released_to_judge` | Orange accent, pulsing dot, "Start Scoring" button |
| **Ready to Start** | `ready_for_day_of` + `roster_confirmed_at` | Fallback start (existing behavior, for small feiseanna) |
| **Waiting** | `ready_for_day_of` + NOT confirmed, `imported` | Greyed out (existing) |
| **Complete** | `ready_to_tabulate`, `complete_unpublished`, `published`, `locked`, `recalled_round_pending` | Checkmark (existing, renamed from "Done") |

**New "Incoming" group:**

- Positioned between Scoring and Ready to Start
- Orange border + faint orange background (`border-feis-orange`, `bg-feis-orange/5`)
- Pulsing orange dot next to "Incoming" header
- Each competition card shows:
  - Competition code + name + age/level
  - "N dancers ready · Sent by side-stage" in orange text
  - Relative timestamp: "Sent just now" / "Sent 2 min ago"
  - **"Start Scoring"** button (green, right-aligned)
- Tapping "Start Scoring" transitions to `in_progress` and navigates to the scoring page

**Realtime subscription:**
- Judge page subscribes to `competitions` table changes for assigned competition IDs
- When a competition enters `released_to_judge`, it appears in the Incoming group without page refresh
- When a competition leaves `released_to_judge` (recalled by side-stage), it disappears from Incoming

### Judge Scoring Page

**Page:** `/judge/[eventId]/[compId]`

**No changes to scoring behavior.** Dancers continue to be sorted by `competitor_number` (official dance order). The scoring form, sign-off flow, and score locking all work exactly as they do today.

The only change: when the judge navigates here from "Incoming," the competition has already transitioned to `in_progress`, so existing code handles it normally.

### What This Does NOT Include

- Per-dancer NOW/NEXT tracking (Phase 3 — stage management)
- SMS notifications (Phase 3)
- Multi-stage coordination (Phase 3)
- Drag-to-reorder dance order (not needed — official order is by competitor number)
- Side-stage person assignment or authentication (prototype uses shared URLs)

### Testing

**State machine tests** (in `tests/competition-states.test.ts`):
- `ready_for_day_of` → `released_to_judge` is valid
- `released_to_judge` → `in_progress` is valid
- `released_to_judge` → `ready_for_day_of` is valid (recall/undo)
- `released_to_judge` cannot skip to `awaiting_scores`
- `ready_for_day_of` → `in_progress` fallback is still valid
- `imported` → `released_to_judge` is invalid (must go through `ready_for_day_of`)
- `in_progress` → `released_to_judge` is invalid (cannot reverse from scoring to handoff)
- Transition labels and block reasons for new transitions

**No new engine tests** — tabulation, scoring, and anomaly detection are unaffected.

**Manual testing:**
- Side-stage sends → judge sees Incoming in real-time
- Judge starts → side-stage sees it move to Scoring/Complete
- Side-stage recalls before judge starts → competition returns to Ready
- Side-stage cannot recall after judge starts
- Fallback: judge starts from Ready to Start without side-stage send
- Realtime reconnects after tab switch / network drop
