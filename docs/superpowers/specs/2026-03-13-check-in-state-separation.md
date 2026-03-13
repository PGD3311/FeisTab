# Check-In State Separation

**Date:** 2026-03-13
**Goal:** Separate competitor-number assignment from event-day physical arrival. Fix the data model so FeisTab stops conflating "has a number" with "is physically here."
**Truth test questions addressed:** #1 (check in without touching DB directly), #3 (side-stage confidence in who's present)

---

## Problem

The current model stores `competitor_number` on `registrations` (per-competition) and treats its presence as proof of check-in (`const isCheckedIn = !!dancer.competitor_number`). This is wrong in two ways:

1. **Competitor number is an event-level fact, not a competition-level fact.** A dancer gets one number for the whole day. Storing it per-registration row is redundant (N copies of the same value) and was already being written that way — the registration desk assigns the same number to all of a dancer's registrations in one action.

2. **Number assignment and physical arrival are different events.** Numbers can be assigned at registration (pre-feis, via FeshWeb). Physical arrival happens at the door on event day. The current model cannot represent "has a number but hasn't arrived yet." If a CSV import includes pre-assigned numbers, every dancer immediately appears "checked in" even though nobody has walked through the door.

This matters for:
- Registration desk accuracy (who actually arrived?)
- Side-stage confidence (should I expect this dancer?)
- No-show reasoning (did they ever pick up their card?)
- Audit trail honesty (when did they actually arrive?)

---

## Design

### Approach: Source-of-Truth First, Reads Later

Create `event_check_ins` as the correct event-level table. Make it the write target immediately. Keep `registrations.competitor_number` temporarily as a compatibility copy so existing screens (judge, side-stage, tabulator, competition detail, heats, anomalies) continue working without changes.

**The law:** `event_check_ins` is the write target. `registrations.competitor_number` is a compatibility copy. New code never writes `registrations.competitor_number` directly. One-directional sync, never the reverse.

Phase 2 (separate sprint) migrates reads. Phase 3 removes the old column.

---

## Data Model

### New table: `event_check_ins`

| Column | Type | Constraints |
|--------|------|------------|
| `id` | uuid | PK, default `uuid_generate_v4()` |
| `event_id` | uuid | FK → events, NOT NULL |
| `dancer_id` | uuid | FK → dancers, NOT NULL |
| `competitor_number` | text | NOT NULL |
| `checked_in_at` | timestamptz | nullable |
| `checked_in_by` | text | nullable (role label in Phase 1, user FK when auth lands) |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `updated_at` | timestamptz | NOT NULL, default `now()` |

**Constraints:**
- `UNIQUE (event_id, dancer_id)` — one row per dancer per event
- `UNIQUE (event_id, competitor_number)` — no two dancers share a number at the same event
- `updated_at` trigger (same pattern as other tables)

**Row existence rule:** Rows should only exist once a competitor number is assigned. Do not create rows with null state — the absence of a row IS the "needs number" state.

### State derivation

| Condition | State | Meaning |
|-----------|-------|---------|
| No `event_check_ins` row | **Needs Number** | Dancer imported but no number assigned |
| Row exists, `checked_in_at` null | **Awaiting Arrival** | Number assigned (pre-feis), not yet physically present |
| Row exists, `checked_in_at` set | **Checked In** | Physically arrived, card handed out |

### Invariants

1. One `event_check_ins` row per `(event_id, dancer_id)` — enforced by unique constraint
2. One non-null `competitor_number` per `(event_id, competitor_number)` — enforced by unique constraint
3. `checked_in_at` cannot be set without a row existing
4. New code treats `event_check_ins` as the source of truth for event-day arrival and competitor number
5. `registrations.competitor_number` is never written directly in new code — only via the sync helper

### Compatibility layer

- `registrations.competitor_number` column stays (temporary)
- `registrations.status = 'checked_in'` stays in the enum (deprecated — new flows do not write it)
- Existing screens continue reading `registrations.competitor_number` via the compatibility sync

---

## Sync Helper

### `syncCompetitorNumberToRegistrations`

**Type:** DB write helper (compatibility bridge). Not pure — mutates database state.

**Signature:**
```ts
async function syncCompetitorNumberToRegistrations(
  supabase: SupabaseClient,
  eventId: string,
  dancerId: string,
  competitorNumber: string
): Promise<{ error: Error | null }>
```

**Behavior:**
1. Updates `registrations.competitor_number` on all registrations for that dancer in competitions belonging to the specified event
2. Scoped to `registrations` where `dancer_id` matches AND `competition_id` belongs to a competition with the given `event_id`

**Sync is part of the primary action.** Both the `event_check_ins` write and the sync must succeed, or the action surfaces an error to the operator. This is not fire-and-forget. During the migration period, sync failure means legacy screens would show stale data — that is a real operational failure.

**Number change handling:** If a competitor number is changed on `event_check_ins`, the sync overwrites all matching registrations with the new value. No stale values left behind.

**This function is the only path that writes `registrations.competitor_number` in new code.**

---

## CSV Import Changes

### Current behavior

Import creates registrations. If CSV has `competitor_number`, it's stored on each registration row. No check-in concept.

### New behavior

After creating registrations, if CSV rows for a dancer include `competitor_number`:

1. Create one `event_check_ins` row for that `(event_id, dancer_id)` with the number, `checked_in_at = null`
2. Call `syncCompetitorNumberToRegistrations` to copy number to registrations for compatibility

If CSV has no `competitor_number` for a dancer → no `event_check_ins` row → **Needs Number**.

### Source-of-truth precedence

If CSV provides `competitor_number`, import treats it as authoritative for initial `event_check_ins` creation. FeisTab is accepting upstream assignment, not inventing numbers.

### Conflict handling

**Duplicate numbers across different dancers:** Import conflict (not a soft warning). The `UNIQUE (event_id, competitor_number)` constraint rejects the second insert. The UI must tell the operator that duplicate competitor numbers were found for different dancers in the same event. The conflicting dancer's `event_check_ins` row is skipped. Import continues for non-conflicting dancers.

**Conflicting numbers for the same dancer:** If the same dancer appears in the CSV with different `competitor_number` values across rows, do not create an `event_check_ins` row. Surface a conflict for manual resolution. Do not silently pick a winner.

### Idempotency

- Re-import, same dancer, same number → no-op (row already exists)
- Re-import, same dancer, different number → conflict, surface for resolution
- New dancer in re-import → normal creation

### Where the logic lives

The CSV parser (`src/lib/csv/import.ts`) stays pure. The `event_check_ins` writes happen in the import page alongside existing registration writes — not in the parser.

---

## Registration Desk Rewrite

### Current behavior

One action — "Assign #N" — sets `competitor_number` and `status: 'checked_in'` on all registrations. Binary: either no number or "checked in."

### New behavior

Three visual states, two possible actions.

### States

| State | Condition | Visual |
|-------|-----------|--------|
| **Needs Number** | No `event_check_ins` row | Muted gray badge "Needs Number". Action: **"Assign #N & Check In"** |
| **Awaiting Arrival** | Row exists, `checked_in_at` null | Number badge (dimmed/outlined). Action: **"Check In"** |
| **Checked In** | `checked_in_at` set | Number badge (solid green) + checkmark. No action. |

**Needs Number must be visually explicit**, not invisible. This is the most actionable state — it needs intervention.

### Actions

**"Assign #N & Check In"** (dancers without numbers):
1. Create `event_check_ins` row: `competitor_number = next available`, `checked_in_at = now()`, `checked_in_by = 'registration_desk'`
2. Call `syncCompetitorNumberToRegistrations` (must succeed)
3. Audit log: `check_in` with `{ competitor_number, event_id, source: 'desk_assigned' }`

Number selection: auto-suggest next available number for the event (same as current behavior — `max(existing) + 1`, starting from 100).

**"Check In"** (dancers with pre-assigned numbers):
1. Update `event_check_ins` row: `checked_in_at = now()`, `checked_in_by = 'registration_desk'`
2. No sync needed (number already synced at import)
3. Audit log: `check_in` with `{ competitor_number, event_id, source: 'pre_assigned' }`

### Number editability

The registration desk can reassign/change a competitor number after creation:
- Updates `event_check_ins.competitor_number`
- Calls `syncCompetitorNumberToRegistrations` with the new number
- `UNIQUE (event_id, competitor_number)` prevents collisions
- Old number values are fully overwritten — no stale copies

### What the desk does NOT do

Registration desk check-in updates `event_check_ins` only. It does **not** set `registrations.status = 'present'`. Competition-level presence is side-stage's job. A dancer can arrive at the venue and still not be present for a specific competition yet.

### Data loading

Registration desk queries `event_check_ins` as the primary source for number + arrival state. Joins to registrations for the dancer's competition list only.

### Stats bar

| Label | Meaning |
|-------|---------|
| **Checked In** | Has `checked_in_at` — physically here |
| **Awaiting Arrival** | Has number, no `checked_in_at` — expected but not arrived |
| **Needs Number** | No `event_check_ins` row — no number assigned yet |

---

## Migration & Backfill

### Migration file: `00012_event_check_ins.sql`

Creates:
- `event_check_ins` table (schema above)
- `UNIQUE (event_id, dancer_id)`
- `UNIQUE (event_id, competitor_number)`
- `updated_at` trigger

### Backfill from existing data

For each distinct `(event_id, dancer_id)` in registrations where `competitor_number IS NOT NULL`:

- If exactly **one** distinct non-null `competitor_number` exists across that dancer's registrations in the event:
  - Create one `event_check_ins` row
  - Set `competitor_number` to that value
  - Set `checked_in_at = null` (do not fabricate arrival timestamps)
  - Set `checked_in_by = 'backfill'`

- If **multiple** distinct `competitor_number` values exist for the same dancer/event:
  - Do not create the row
  - Log migration conflict (comment in migration output or raise notice)
  - Requires manual cleanup

**Do not backfill `checked_in_at` from registration timestamps.** That would fabricate event-day arrival history from data that represents registration/import existence — a different fact. All backfilled rows land in **Awaiting Arrival** state.

### Post-migration validation

After running the migration, verify:

1. Every `(event_id, dancer_id)` with a non-null registration competitor number has at most one `event_check_ins` row
2. No duplicate `(event_id, competitor_number)` rows exist
3. No backfilled rows have `checked_in_at` set
4. Count of `event_check_ins` rows ≤ count of distinct `(event_id, dancer_id)` with non-null numbers in registrations
5. Any skipped conflicts are identified and logged

### Seed data fix

Update `seed.sql` so each dancer has one competitor number across all their competitions within the event. Current seed gives the same dancer different numbers per competition — that's wrong per the corrected model.

### What does NOT change

- `registrations.competitor_number` column stays
- `checked_in` stays in the registrations status enum (deprecated)
- No changes to any other table

---

## What Stays the Same (Phase 1)

These screens continue reading `registrations.competitor_number` via the compatibility sync. No changes:

- **Side-stage** — reads `competitor_number` from registrations, sorts by it
- **Judge page** — reads competitor number from registrations
- **Tabulator page** — same
- **Competition detail** — same
- **Heats engine** — pure function, reads competitor number from data passed in
- **Anomaly detection** — pure functions operating on registration data
- **Score entry form** — displays competitor number passed as prop

Phase 2 (separate sprint) migrates these reads to join through `event_check_ins`.

---

## Testing

### What needs tests

**State derivation helper** (`getCheckInState`):
- No row → `needs_number`
- Row with null `checked_in_at` → `awaiting_arrival`
- Row with `checked_in_at` → `checked_in`

**`syncCompetitorNumberToRegistrations`:**
- Syncs number to all registrations for dancer in event
- Handles number change (overwrites old value)
- Scoped to correct event (doesn't touch other events)

**Stats/count derivation:**
- Correct counts for each of the three states

**CSV import (extend existing tests):**
- Import with competitor numbers creates `event_check_ins` rows with `checked_in_at = null`
- Import without numbers creates no `event_check_ins` rows
- Duplicate competitor numbers across different dancers → conflict surfaced
- Conflicting numbers for same dancer → row skipped, conflict surfaced
- Re-import same data → idempotent

### What doesn't need tests

- Registration desk UI rendering (manual testing per project convention)
- Migration/backfill SQL (verified via post-migration validation queries)

---

## What This Does NOT Include

- Migrating reads from `registrations.competitor_number` to `event_check_ins` (Phase 2)
- Removing `registrations.competitor_number` column (Phase 3)
- Removing `checked_in` from registrations status enum (Phase 3)
- Side-stage reading `event_check_ins.checked_in_at` for "has this dancer arrived at the event?" (Phase 2)
- Event-level check-in dashboard or summary view
- Auth integration for `checked_in_by`

---

## Phase 2 Read Migration Order (for reference, not this sprint)

When migrating reads away from `registrations.competitor_number`:

1. Registration desk (already done in Phase 1)
2. Competition detail page
3. Side-stage / check-in page
4. Judge page
5. Tabulator page
6. Heats engine helper
7. Anomaly detection helper

Once all reads are migrated, Phase 3 removes the column.
