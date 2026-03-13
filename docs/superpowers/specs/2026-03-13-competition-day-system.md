# Competition Day System

**Date:** 2026-03-13
**Goal:** Give FeisTab a system-level backbone so every role — organizer, side-stage, judge — sees what's happening now, what's next, and who's dancing, without keeping any of it in their head.
**North star:** "Bridget could run a feis every weekend and it be no problem."

---

## What We're Building

A unified system across three layers that turns FeisTab from a pile of disconnected competition screens into a connected competition-day operating system.

| Layer | What it answers | Builds on |
|---|---|---|
| **Layer 1 — Day Schedule** | What competition is NOW, NEXT, UPCOMING on each stage? | Existing stages + competitions tables |
| **Layer 2 — Competition Execution** | When does side-stage hand off to the judge? When does the judge start? | Already spec'd: `side-stage-judge-sync.md` |
| **Layer 3 — Within-Competition Rotation** | Who is dancing now? Who lines up next? | Existing registrations + new heat generation |

**Design together, build in order:** Layer 1 → Layer 2 → Layer 3. Each layer depends on the one before it. The schedule backbone must exist before the handoff makes sense, and the handoff must exist before within-competition rotation matters.

---

## Layer 1 — Day Schedule Backbone

### Problem

Competitions exist in the database but have no stage assignment, no run order, and no system-level concept of "the program." Every role (organizer, side-stage, judge) has to keep the schedule in their head or on a printed sheet. The app can't answer "what's happening now on Stage 1?" because it doesn't know what order competitions run in.

### Schema Changes

Add columns to `competitions`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `schedule_position` | `integer` | `null` | Run order within a stage (1, 2, 3...) |
| `dance_type` | `text` | `null` | Reel, jig, hornpipe, slip_jig, treble_jig, set_dance, etc. |

**Constraints:**
- `UNIQUE(stage_id, schedule_position)` — two competitions cannot occupy the same position on the same stage. Non-negotiable.
- `stage_id` already exists as FK to `stages`.

**`group_size`** is stored on `competitions` as execution config (see Layer 3), not as backbone logic.

**`dance_type`** is free text for now. A controlled enum is desirable later to prevent "Slip Jig" vs "slip_jig" vs "slipjig" divergence, but not blocking for Phase 1.

**Status CHECK constraint:** The `competitions` table in migration `00002_competitions.sql` has a `CHECK (status IN (...))` constraint that does NOT include `released_to_judge`. The Layer 2 migration must `DROP` and re-add this constraint with `released_to_judge` included in the allowed values. Without this, any attempt to set `status = 'released_to_judge'` will fail at the database level. **Prerequisite:** Before implementing Layer 2, update the Schema Migration section of `side-stage-judge-sync.md` to include the CHECK constraint DROP/re-add. That spec (line 68) incorrectly claims "The `competitions.status` column is an unconstrained text field (no Postgres enum or CHECK constraint)" — this is wrong and will cause the migration to fail.

**`dance_type` reference values:** Free text for now, but the migration should include a comment noting common values: `reel`, `jig`, `hornpipe`, `slip_jig`, `treble_jig`, `set_dance`. This gives CSV importers and UI builders a reference set even without enforcement.

**No changes to `stages` table** — it already has `id`, `event_id`, `name`, `display_order`.

### The Program View

The schedule is the program. It's the single view that tells every role what's happening.

**Who sees it:**
- **Organizer** — full program across all stages on the dashboard
- **Side-stage** — their stage's column on the checkin page
- **Judge** — their assigned competitions highlighted in the program
- **Public/family** — designed-for but not built in Layer 1 scope

**Same data, different views.** The underlying query is the same: competitions for this event, joined to stages, ordered by `stages.display_order` then `competitions.schedule_position`, grouped by status.

### NOW / NEXT / UPCOMING — Derived, Not Stored

Competition groupings are derived from `schedule_position` + competition status + readiness gates. Never stored as raw fields.

#### Schedule Derivation Function

`src/lib/engine/schedule.ts` — pure, no Supabase, no React.

```typescript
type ScheduleGroup = 'now' | 'next' | 'upcoming' | 'complete'

interface ScheduleCompetition {
  id: string
  status: CompetitionStatus
  schedule_position: number | null
  stage_id: string | null
  roster_confirmed_at: string | null
  judge_count: number
}

interface ScheduleGrouping {
  now: ScheduleCompetition | null
  next: ScheduleCompetition | null
  upcoming: ScheduleCompetition[]
  complete: ScheduleCompetition[]
}

function groupBySchedule(
  competitions: ScheduleCompetition[],
  stageId: string
): ScheduleGrouping
```

This function is the single source of truth for NOW/NEXT/UPCOMING. All views (dashboard, side-stage, judge) call it. Tested in `tests/engine/schedule.test.ts`.

**`judge_count` derivation:** `judge_count` is derived from `COUNT(judge_assignments)` — the caller query joins this before passing to `groupBySchedule()`. The function itself is pure and doesn't know about the database.

**`ACTIVE_STATUSES` note:** The existing `ACTIVE_STATUSES` constant in `competition-states.ts` does not include `released_to_judge`. The schedule derivation uses its own status sets defined within `schedule.ts`, separate from `ACTIVE_STATUSES`. This avoids changing a shared constant that other consumers depend on. If a future refactor unifies them, `ACTIVE_STATUSES` should be updated at that point.

#### Group Definitions

**NOW (current competition):** The stage's current blocking focus. The first competition on this stage (by `schedule_position`) that is actively being worked on.

NOW statuses (defined in `schedule.ts`): `released_to_judge`, `in_progress`, `awaiting_scores`, `ready_to_tabulate`, `recalled_round_pending`.

Conceptually: any competition that the stage is currently occupied with or waiting on before it can move forward.

**NEXT:** The earliest competition after NOW on this stage that is operationally eligible to run next.

This is not hard-wired to a single status set. The conceptual rule: the first later competition that is prepared enough to become NOW once the current competition clears. For Phase 1, this typically means `ready_for_day_of` with `roster_confirmed_at` set, or `released_to_judge` if no active NOW exists. The `groupBySchedule()` function encodes the eligibility logic — if new statuses or readiness gates are added later, only this function changes.

**UPCOMING:** Everything else on this stage that is not complete, in `schedule_position` order.

**COMPLETE:** Competitions with status in `complete_unpublished`, `published`, `locked`.

**Auto-advance:** When a competition finishes (publishes results), it naturally moves to COMPLETE. The next competition in schedule order becomes the new NEXT candidate. No manual queue management needed — the schedule + state machine handle it.

### Blocked Visibility

The program view must surface why a competition isn't moving forward:
- Roster not confirmed
- No judges assigned
- Waiting on judge sign-off
- Anomaly blockers unresolved

**Two systems, not one.** The existing `getTransitionBlockReason()` handles state-machine transition gates (e.g., "Assign judges before starting" blocks `ready_for_day_of` → `in_progress`). Schedule-level readiness indicators are different — they're not tied to a specific transition, they're about whether a competition is operationally ready to appear in the program.

A new pure function `getScheduleBlockReasons()` in `src/lib/engine/schedule.ts` handles the schedule-view indicators:

```typescript
function getScheduleBlockReasons(comp: ScheduleCompetition): string[]
```

| Block reason | When shown |
|---|---|
| "No stage assigned" | `stage_id` is null |
| "No schedule position" | `schedule_position` is null |
| "Roster not confirmed" | `roster_confirmed_at` is null and competition is past `draft` |
| "No judges assigned" | `judge_count` is 0 and competition is past `draft` |

These are visibility indicators for the program view, not transition gates. A competition without a stage assignment can still transition — it just can't meaningfully appear in the schedule. The existing `getTransitionBlockReason()` is unchanged.

The schedule view displays these alongside any competition that has one.

### Judge Assignment Visibility

Each competition row in the program view shows its assigned judge(s). The data already exists in `judge_assignments` — the program view surfaces it alongside stage + position + status. A complete schedule row is: stage, position, competition, assigned judge(s), status, block reason (if any).

### Setup Experience

How the organizer builds the program before the feis:

1. **Create stages** — "Main Hall", "Side Room", or just "Stage 1" for a one-stage feis
2. **Import competitions** via CSV (already works)
3. **Assign competitions to stages** — dropdown or drag
4. **Set run order** within each stage — drag to reorder, auto-assigns `schedule_position`
5. **Set or confirm competition run format** — including group size where applicable (Layer 3 config)

For a one-stage feis: steps 1 and 3 are trivial. Bridget just sets the order. Done in minutes after CSV import.

**Reordering safety:** Drag-and-drop must reassign `schedule_position` values deterministically, not create duplicates, and operate within a single stage scope. Implementation: a single batch update that receives `{competitionId, newPosition}[]` and bulk-updates `schedule_position` in a transaction.

### Files

- Migration: add `schedule_position` and `dance_type` to `competitions`
- Modify: competition detail page (show position in schedule context)
- Create: program/schedule view component (used on dashboard, side-stage, judge pages)
- Modify: event dashboard (embed program view)
- Modify: checkin page (use schedule position for ordering, show NOW/NEXT per stage)
- Modify: judge event page (use schedule position for ordering, show program context)

### Acceptance Criteria

- Organizer can assign competitions to stages and set run order
- `UNIQUE(stage_id, schedule_position)` enforced
- Program view shows NOW/NEXT/UPCOMING/COMPLETE per stage
- Block reasons visible in the program view
- Assigned judges visible per competition in program view
- All existing functionality unchanged — schedule is additive, not a rewrite

---

## Layer 2 — Competition Execution (Handoff)

**Already spec'd in `docs/superpowers/specs/2026-03-13-side-stage-judge-sync.md`.**

Layer 2 adds the `released_to_judge` status and real-time handoff signal between side-stage and judge. Within the unified system:

- Side-stage uses the schedule backbone (Layer 1) to know which competition is NEXT
- Side-stage confirms roster, then taps "Send to Judge" → competition enters `released_to_judge`
- Judge sees it appear in "Incoming" group → taps "Start Scoring" → `in_progress`
- Fallback: judge can start directly from `ready_for_day_of` at small feiseanna without dedicated side-stage

**Integration with Layer 1:** The handoff transitions (`released_to_judge` → `in_progress`) are part of the NOW/NEXT derivation. A competition in `released_to_judge` is part of NOW (the stage is occupied with it). When the judge starts, it becomes clearly NOW.

**No design changes from the existing spec.** Layer 2 is included here for completeness — it's the connective tissue between Layer 1 (what competition) and Layer 3 (which dancers within it).

---

## Layer 3 — Within-Competition Rotation

### Problem

The app currently shows all dancers in a flat list on the judge scoring page. There's no concept of "who is on stage now" vs "who is next." Side-stage has no view of heat progression within a competition. At a real feis, dancers perform in groups of 2-3, and the side-stage person needs to know who to line up next.

### Schema Changes

Add column to `competitions`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `group_size` | `integer` | `2` | Dancers per heat (1, 2, or 3). Execution config, not backbone. |

Add column to `registrations`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `display_order` | `integer` | `null` | Dance order within the competition. Defaults to `competitor_number` order. Allows future manual reordering. |

Add column to `rounds` (see Heat Stability Rule below for full details):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `heat_snapshot` | `jsonb` | `null` | Persisted heat structure, generated at competition start. |

**`group_size` auto-suggestion:** When `dance_type` is set, the UI can suggest a default (soft shoe → 2, hard shoe → 3). This is a suggestion, not magic — the organizer can override.

### Heat Generation — Pure Engine Function

`src/lib/engine/heats.ts` — pure, no Supabase, no React.

```typescript
interface HeatDancer {
  dancer_id: string
  competitor_number: string
  display_order: number
}

interface HeatSlot {
  dancer_id: string
  competitor_number: string
  status: 'active' | 'scratched' | 'no_show' | 'absent'
}

interface Heat {
  heat_number: number
  slots: HeatSlot[]
}

interface HeatSnapshot {
  group_size: number
  generated_at: string  // ISO timestamp
  heats: Heat[]
}

function generateHeats(activeDancers: HeatDancer[], groupSize: number): HeatSnapshot
function getCurrentHeat(snapshot: HeatSnapshot, scoredDancerIds: Set<string>): Heat | null
```

**`generateHeats()`:** Takes active dancers sorted by `display_order`, chunks into groups of `groupSize`. Last heat may be smaller. Returns a `HeatSnapshot` with a timestamp. Deterministic output — same input always produces the same snapshot.

**`getCurrentHeat()`:** Takes a persisted `HeatSnapshot` and the set of dancer IDs with saved scores. Returns the heat containing the first incomplete active slot. This is more resilient than deriving from scored count — it handles out-of-order scoring, partial completion, and corrections. Returns `null` when all active slots are scored.

Both functions tested in `tests/engine/heats.test.ts`.

### Heat Stability Rule — Persisted Snapshot

**Heat structure is generated from the active roster when the judge starts the competition and persisted as a heat snapshot on the active round. After the competition begins, all side-stage and judge views read from that same persisted snapshot. Mid-competition status changes update slot status within the snapshot but do not silently regenerate or reshuffle heats.**

This is non-negotiable. The alternatives fail:

| Approach | Why it fails |
|---|---|
| React state as source of truth | Page refresh breaks it. Side-stage and judge can drift. Another device won't see the same heat map. |
| Live recomputation from roster after start | Heats silently mutate mid-competition. #107 jumps from Heat 4 to Heat 3. Humans get confused and the stage picture stops matching the screen. |
| **Persisted snapshot** | **Stable, shared across devices, auditable, human-safe on a real stage.** |

#### Lifecycle

**Before judge starts** (status is `released_to_judge` or earlier):
- Heats are freely generated as a preview from the current active roster using `generateHeats()`.
- Side-stage can see an estimated heat breakdown while confirming the roster.
- No snapshot is persisted yet. If dancers scratch before scoring, heats recalculate cleanly.

**At judge start** (transition to `in_progress`):
- `generateHeats()` runs once against the active roster at that moment.
- The returned `HeatSnapshot` is persisted to `rounds.heat_snapshot` (JSONB).
- This is the official heat structure for the competition.

**After judge starts** (status is `in_progress` or later):
- All views (side-stage, judge, tabulator) read from the persisted `rounds.heat_snapshot`.
- No auto-regeneration. No recomputation from the live roster.
- Mid-competition no-shows or scratches update the `status` field of the affected slot within the snapshot — the slot stays in its heat, visually marked as absent.
- Heat numbering never changes. Heat membership never changes. The stage picture matches the screen.

#### Schema Change

Add column to `rounds`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `heat_snapshot` | `jsonb` | `null` | Persisted heat structure, generated at competition start. `null` means heats not yet locked. |

#### Snapshot Shape

```json
{
  "group_size": 2,
  "generated_at": "2026-03-13T10:15:00Z",
  "heats": [
    {
      "heat_number": 1,
      "slots": [
        { "dancer_id": "d1", "competitor_number": "101", "status": "active" },
        { "dancer_id": "d2", "competitor_number": "102", "status": "active" }
      ]
    },
    {
      "heat_number": 2,
      "slots": [
        { "dancer_id": "d3", "competitor_number": "103", "status": "active" },
        { "dancer_id": "d4", "competitor_number": "104", "status": "scratched" }
      ]
    }
  ]
}
```

When dancer #104 scratches after start, only the slot status changes. Heat 2 stays Heat 2.

#### Current Heat Derivation

**Current heat = the heat containing the first incomplete active slot in the persisted snapshot.**

Not scored count. Not live roster recomputation. The persisted snapshot + scored dancer IDs are the only inputs.

#### Explicit Rebuild Rule

- **Before judge start:** Heats can be regenerated freely (preview mode).
- **After judge start:** No auto-regeneration. Period.
- **Phase 1:** Post-start rebuild is not supported. If an organizer needs to restructure heats after scoring has begun, that's a manual data correction — out of Phase 1 scope.

#### Why `rounds` and not `competitions`

Heats belong to the active scoring round, not to the competition forever. Scoring is already round-scoped (`score_entries.round_id`). If a recall round happens, it gets its own snapshot. `rounds` is the correct home.

### Performance Unit vs Entry Unit

- **Performance unit = heat.** Dancers perform together as a heat. The side-stage and judge view the heat as the current unit of activity.
- **Entry unit = dancer.** Score entry is still per-dancer. The judge enters one score at a time, even though the heat may contain 2-3 dancers.

The existing `ScoreEntryForm` component is unchanged. Layer 3 adds visual grouping around it — current heat is prominent, already-scored heats are collapsed, upcoming heats are dimmed.

### Side-Stage View (during a running competition)

On the checkin page, when a competition is in `in_progress`:

- **On Stage Now:** The current heat — huge competitor numbers, dancer names below. "Heat 3 of 6."
- **Line Up Next Heat:** The next heat — competitors listed, ready to be called. Button label: "Line Up Next Heat" (informational, not a state transition).
- **Remaining:** Summary of upcoming heats.

Competitor numbers are the primary visual element — the side-stage person is calling them over a microphone. Numbers must be large enough to read at a glance on a tablet.

### Judge View (during scoring)

On the judge scoring page:

- Current heat is visually grouped and highlighted
- Already-scored dancers/heats are dimmed/collapsed
- Upcoming heats are visible but secondary
- Progress indicator: "6 of 12 scored · Heat 3 of 6"

Same `ScoreEntryForm` per dancer. The heat grouping is purely visual — it doesn't change how scores are entered or stored.

### What This Does NOT Change

- **Tabulation engine** — unchanged. Operates on all scores for the competition, heat-agnostic.
- **Score entry form** — unchanged. Still per-dancer.
- **Sign-off flow** — unchanged. Per-judge, all dancers in the round.
- **State machine** — unchanged. Heats are below the competition-level abstraction.
- **Audit trail** — unchanged. Scores are per-dancer, not per-heat.
- **Anomaly detection** — unchanged. Operates on all scores, heat-agnostic.

### Files

- Migration: add `group_size` to `competitions`, `display_order` to `registrations`, `heat_snapshot` (JSONB) to `rounds`
- Create: `src/lib/engine/heats.ts` (pure heat generation + snapshot creation + current heat derivation)
- Create: `tests/engine/heats.test.ts`
- Modify: competition start transition — generate and persist heat snapshot to `rounds.heat_snapshot`
- Modify: judge scoring page (read from snapshot, visual heat grouping)
- Modify: checkin/side-stage page (read from snapshot during active competition, current heat + next heat display)
- Modify: tabulator entry page (read from snapshot, visual heat grouping)
- Modify: competition detail page (show group size config)

### Acceptance Criteria

- `generateHeats()` produces correct `HeatSnapshot` for various dancer counts and group sizes
- `getCurrentHeat()` correctly identifies current heat from snapshot + scored dancer IDs
- Heat snapshot is persisted to `rounds.heat_snapshot` when competition transitions to `in_progress`
- Before `in_progress`: heats are generated as live previews (not persisted)
- After `in_progress`: all views read from the persisted snapshot, not from live roster
- Mid-competition no-shows update slot status within the snapshot — heats do not reshuffle
- No-shows appear as visible empty slots in their original heat position
- Same snapshot is visible across all devices (side-stage, judge, tabulator)
- Post-start heat regeneration is not supported in Phase 1
- Judge scoring page shows visual heat grouping with current heat highlighted
- Side-stage sees current heat (big numbers) and next heat during active competition
- Tabulation, sign-off, anomaly detection, and audit trail are completely unaffected

---

## Testing

### Layer 1 — Schedule

DB constraint tests:
- `UNIQUE(stage_id, schedule_position)` — duplicate position on same stage rejected

Engine tests in `tests/engine/schedule.test.ts`:
- Single stage, 3 comps: one `in_progress`, one `ready_for_day_of` with confirmed roster, one `draft` → NOW is `in_progress`, NEXT is `ready_for_day_of`, UPCOMING is `draft`
- No competition in an active status → NOW is `null`, NEXT is first eligible
- All competitions complete → NOW and NEXT are `null`, all in COMPLETE
- Competition in `released_to_judge` is NOW (not NEXT)
- Two stages return independent groupings (filter by `stageId`)
- Competitions without `schedule_position` (`null`) are excluded from NOW and NEXT but appear in UPCOMING as unscheduled (sorted after positioned competitions)
- `getScheduleBlockReasons()` returns `["No stage assigned"]` when `stage_id` is null
- `getScheduleBlockReasons()` returns `["No judges assigned"]` when `judge_count` is 0 and status past `draft`
- `getScheduleBlockReasons()` returns empty array when competition is fully ready

### Layer 2 — Handoff

See `side-stage-judge-sync.md` testing section. State machine tests for `released_to_judge` transitions.

### Layer 3 — Heats

Engine tests in `tests/engine/heats.test.ts`:
- 12 dancers, group size 2 → snapshot with 6 heats of 2 slots each
- 11 dancers, group size 3 → snapshot with 3 heats of 3 + 1 heat of 2
- 1 dancer, group size 2 → snapshot with 1 heat of 1
- 0 dancers → snapshot with empty heats array
- Snapshot includes `group_size` and `generated_at` metadata
- All slots in a fresh snapshot have `status: 'active'`
- `getCurrentHeat()` with no scores → heat 1
- `getCurrentHeat()` with first 4 scored (group size 2) → heat 3
- `getCurrentHeat()` with out-of-order scoring → correct heat based on first unscored active slot
- `getCurrentHeat()` with all active slots scored → null
- `getCurrentHeat()` skips slots with `status: 'scratched'` or `'no_show'` — they don't block heat progression
- Snapshot with a scratched slot: heat structure unchanged, slot remains in its original heat

### Existing Tests

All 142 existing tests must continue to pass. Engine, state machine, CSV, anomaly detection — none are affected by this spec.

---

## Build Order

1. **Layer 1 — Day Schedule Backbone**
   - Migration: `schedule_position`, `dance_type` on competitions
   - Program view component
   - Setup UI: stage assignment, run ordering
   - NOW/NEXT/UPCOMING on dashboard, checkin, judge pages

2. **Layer 2 — Side-Stage → Judge Handoff**
   - Already spec'd in `side-stage-judge-sync.md`
   - `released_to_judge` status, realtime sync, incoming queue
   - Integrates with schedule backbone for stage-aware handoff

3. **Layer 3 — Within-Competition Rotation**
   - Migration: `group_size` on competitions, `display_order` on registrations, `heat_snapshot` (JSONB) on rounds
   - `heats.ts` pure engine function (generates snapshot) + tests
   - Snapshot persistence: generate and persist to `rounds.heat_snapshot` at `in_progress` transition
   - All views read from persisted snapshot — no live recomputation after start
   - Visual heat grouping on judge and side-stage pages
   - Mid-competition status changes update slot status within snapshot

Each layer is independently useful. Layer 1 alone makes the app dramatically better — it turns "pile of competitions" into "the program." Layer 2 connects side-stage and judge. Layer 3 adds within-competition flow.

---

## What This Does NOT Include

- **Per-dancer SMS notifications** — Phase 3
- **Live results streaming** — Phase 3
- **Multi-event tournament management** — out of scope
- **Drag-to-reorder dance order within a competition** — future manual override, not Phase 1
- **Authentication / RLS** — comes after prototype validation
- **Public program display** — designed-for but not Layer 1 build scope
- **Post-start heat rebuild** — not supported in Phase 1. If an organizer needs to restructure heats after scoring has begun, that's a manual data correction.
- **Estimated time per competition** — future enhancement for schedule planning
