# Registration Desk Check-In

## Goal

Enable event-day check-in at the registration desk: assign competitor numbers and confirm dancer arrival. This is the entry point that feeds all downstream scoring — without a competitor number, a dancer cannot be scored.

## Architecture

- **Source of truth:** The `event_check_ins` table owns competitor numbers and event-day arrival state. The `registrations` table receives a compatibility copy via `syncCompetitorNumberToRegistrations()`.
- **3-state model:** `needs_number` / `awaiting_arrival` / `checked_in` — derived from the presence and contents of an `event_check_ins` row.
- **Route:** `/registration/[eventId]` — standalone client page (`'use client'`), no dashboard nav.
- **Pure logic:** `src/lib/check-in.ts` contains `getCheckInState`, `deriveCheckInStats`, and `computeNextNumber` — pure functions with no Supabase or React dependencies.
- **Sync helper:** `src/lib/check-in-sync.ts` writes `competitor_number` back to `registrations` for compatibility. This is the only path that updates `registrations.competitor_number` in new code. If sync fails, the UI must not show success — the row should remain in an error state until retry succeeds, because legacy screens depend on the synced value.
- **Multi-device support:** Supabase Realtime subscription on `event_check_ins` provides instant cross-device updates. A 5-second polling fallback (visibility-aware — pauses when tab is hidden) ensures resilience if the WebSocket drops.
- **Collision-safe number assignment:** Up to 3 retries on unique constraint violation (Postgres error `23505`) when inserting into `event_check_ins`.
- **Undo supported:** Desk operators can reverse a check-in, which deletes the `event_check_ins` row and nulls `registrations.competitor_number`.

## Data Model

### `event_check_ins` table

Created in `supabase/migrations/012_event_check_ins.sql`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, auto-generated |
| `event_id` | `uuid` | FK → `events(id)`, cascade delete |
| `dancer_id` | `uuid` | FK → `dancers(id)`, cascade delete |
| `competitor_number` | `text` | Not null |
| `checked_in_at` | `timestamptz` | Null = pre-assigned but not yet arrived |
| `checked_in_by` | `text` | Source identifier. Phase 1 allowed values: `'registration_desk'`, `'import'`, `'backfill'`, `'seed'`. No other values should be written. |
| `created_at` | `timestamptz` | Auto-set |
| `updated_at` | `timestamptz` | Auto-updated via trigger |

**Unique constraints:**
- `(event_id, dancer_id)` — one check-in row per dancer per event
- `(event_id, competitor_number)` — no duplicate numbers within an event

### Pure types (`src/lib/check-in.ts`)

```ts
type CheckInState = 'needs_number' | 'awaiting_arrival' | 'checked_in'

interface CheckInRow {
  competitor_number: string
  checked_in_at: string | null
}

interface CheckInStats {
  checkedIn: number
  awaitingArrival: number
  needsNumber: number
}
```

## Behavior (3 States)

### Needs Number

- **Condition:** No `event_check_ins` row exists for this dancer/event.
- **UI:** "Needs Number" badge + "Assign #N & Check In" button showing the next available number.
- **Action:** Inserts a new `event_check_ins` row with `competitor_number` and `checked_in_at` set. Syncs the number to `registrations`. Logs an audit event with `source: 'desk_assigned'`.

### Awaiting Arrival

- **Condition:** `event_check_ins` row exists, `checked_in_at` is null.
- **UI:** Muted competitor number badge + "Check In" button.
- **Action:** Updates `checked_in_at` and `checked_in_by` on the existing row. Syncs the number to `registrations`. Logs an audit event with `source: 'pre_assigned'`.

### Checked In

- **Condition:** `event_check_ins` row exists, `checked_in_at` is set.
- **UI:** Green competitor number badge + checkmark icon + "Print #" button + "Undo" button.
- **Undo action:** Deletes the `event_check_ins` row and sets `registrations.competitor_number` to null for all of that dancer's registrations in the event. Requires confirmation dialog.
- **Print action:** Opens a popup window with the number in large monospace font (250px) and triggers `window.print()`.

## Number Assignment

- Numbers start at 100. `computeNextNumber()` finds the max numeric value among all existing `event_check_ins.competitor_number` values for the event, then returns `max + 1`. Non-numeric values are ignored.
- If an event has CSV-imported numbers 1-50, desk-assigned numbers still start at 100 (the floor is 99, so `99 + 1 = 100`).
- The suggested next number is advisory only; final assignment must handle uniqueness conflicts at insert time. If an insert fails with Postgres unique constraint error `23505`, the system retries up to 3 times, incrementing the number each attempt. If all retries fail, the user sees "Number conflict — refresh and try again."

## Data Flow

### CSV Import → `event_check_ins`

`src/app/dashboard/events/[eventId]/import/page.tsx`

1. CSV rows are parsed. `competitor_number` is an optional column.
2. Dancers and competitions are upserted. Registrations are created with `competitor_number: null`.
3. For dancers that have a `competitor_number` in the CSV:
   - If the dancer has conflicting numbers across CSV rows (multiple distinct values), the dancer is flagged as a conflict and skipped.
   - If an `event_check_ins` row already exists with a different number, the dancer is flagged as a conflict.
   - Otherwise, an `event_check_ins` row is inserted with `checked_in_by: 'import'` and `checked_in_at: null` (awaiting arrival).
   - `syncCompetitorNumberToRegistrations()` is called to write the number to `registrations`.

### Registration Desk → `event_check_ins`

`src/app/registration/[eventId]/page.tsx`

1. All dancers for the event are loaded (via `registrations` join to `dancers`), plus all `event_check_ins` rows.
2. Dancers are displayed sorted by last name, then first name.
3. Client-side search filters on `first_name`, `last_name`, and `school_name` (case-insensitive, substring match).
4. Desk operator assigns numbers and/or confirms arrival. Every write to `event_check_ins` is followed by a sync to `registrations` and an audit log entry.

### Downstream consumers

- **Side-stage:** Reads `event_check_ins` for arrival awareness (checked-in status).
- **Scoring / tabulation:** Reads `registrations.competitor_number` (the compatibility copy).

### Migration backfill

The migration (`012_event_check_ins.sql`) backfills existing data: for each dancer/event pair where exactly one distinct `competitor_number` exists across registrations, an `event_check_ins` row is created with `checked_in_by: 'backfill'`. Dancers with conflicting numbers are logged as a warning and skipped.

## Status Interactions

These are separate concerns:

- **Event-level arrival** = `event_check_ins.checked_in_at` — "has the dancer arrived at the feis today?"
- **Competition-level presence** = `registrations.status` (`registered`, `present`, `scratched`, etc.) — "is the dancer competing in this specific competition?"

A dancer can be checked in at the event but scratched from a specific competition. A dancer without a competitor number (not checked in) can still appear on side-stage rosters — they just won't have a number displayed.

## UI Details

### Page layout

- **Back link** to `/dashboard/events/[eventId]`
- **Header:** "Registration Desk" title + event name
- **Search bar:** Large text input with placeholder "Search by dancer name or school..."
- **Next number badge:** Green badge showing "Next #: {N}"
- **Dancer cards:** One card per dancer showing name, age (computed from `date_of_birth`), school, and state-dependent action area
- **Progress footer:** Shows counts for each state ("X Checked In", "Y Awaiting Arrival", "Z Needs Number") + next number

### Data loading

- Event metadata and `event_check_ins` load in parallel on mount.
- Dancer IDs are fetched from `registrations`, then dancer details are loaded in chunks of 100 (Supabase `.in()` has URL length limits).
- All filtering is client-side (assumes < 500 dancers per event, which covers all local feiseanna).

## Audit Logging

Every check-in and undo is logged via `logAudit()`:

```ts
{
  userId: null,
  entityType: 'dancer',
  entityId: dancer_id,
  action: 'check_in',
  afterData: {
    competitor_number,
    event_id,
    source: 'desk_assigned' | 'pre_assigned',
  },
}
```

## Testing

### Pure function tests (`tests/check-in.test.ts`)

| Test | What it covers |
|---|---|
| `getCheckInState(null)` → `'needs_number'` | No row = no number |
| `getCheckInState(undefined)` → `'needs_number'` | Defensive against undefined |
| `getCheckInState({ ..., checked_in_at: null })` → `'awaiting_arrival'` | Row exists, not arrived |
| `getCheckInState({ ..., checked_in_at: timestamp })` → `'checked_in'` | Fully checked in |
| `deriveCheckInStats` counts all three states | Aggregation across dancer list |
| `deriveCheckInStats` handles empty inputs | Zero-dancer edge case |
| `computeNextNumber([])` → `100` | Default starting number |
| `computeNextNumber(['101', '102', '105'])` → `106` | Max + 1 |
| `computeNextNumber` ignores non-numeric values | Mixed numeric/alpha values |
| `computeNextNumber` with all non-numeric → `100` | Falls back to floor |

### Manual testing

- CSV import with pre-assigned numbers → dancers appear as "Awaiting Arrival"
- CSV import without numbers → dancers appear as "Needs Number"
- Desk number assignment → number appears, state moves to "Checked In"
- Check-in of pre-assigned dancer → state moves to "Checked In"
- Undo → row deleted, dancer returns to "Needs Number"
- Number collision retry → second device assigns same number, first retries successfully
- Multi-device sync → check-in on device A appears on device B within seconds
- Two devices attempt assignment simultaneously → both succeed with different numbers (no duplicate)
- One device assigns while another has stale next-number suggestion → stale device retries cleanly
- Sync failure scenario → UI does not show success until registrations sync completes

## Key Files

| File | Role |
|---|---|
| `supabase/migrations/012_event_check_ins.sql` | Table schema + backfill |
| `supabase/migrations/012_enable_realtime.sql` | Realtime publication for `event_check_ins` |
| `src/lib/check-in.ts` | Pure state derivation functions |
| `src/lib/check-in-sync.ts` | Compatibility sync to `registrations.competitor_number` |
| `src/app/registration/[eventId]/page.tsx` | Registration desk UI |
| `src/app/dashboard/events/[eventId]/import/page.tsx` | CSV import (creates `event_check_ins` rows) |
| `tests/check-in.test.ts` | Unit tests for pure functions |
