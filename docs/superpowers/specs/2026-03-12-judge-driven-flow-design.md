# Judge-Driven Competition Flow

## Goal

Shift competition-day control from the organizer to the people at the stage: **judges start and end competitions**, a **side-stage person confirms rosters and releases competitions to judges**, and the **organizer handles tabulation and results** from the back office. All three views share the same data — the syllabus is the single source of truth.

## Context

At a real feis, the organizer preps everything before the day (import syllabus, create judges, assign competitions). On competition day, the judge at the table controls the pace — they start when dancers are ready and submit when scoring is done. A volunteer at the side of the stage calls competitor numbers, confirms who's present, and feeds the next group to the judge. The organizer watches the big picture and handles results.

The judge-driven flow introduces a `released_to_judge` status between `ready_for_day_of` and `in_progress`. The side-stage person or organizer releases a competition to the judge after confirming the roster and verifying judges are assigned. The judge then starts scoring when ready.

## Data Model

### Table: `judge_assignments` (migration 008)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK, default `gen_random_uuid()` | |
| `judge_id` | uuid, FK -> judges, ON DELETE CASCADE | |
| `competition_id` | uuid, FK -> competitions, ON DELETE CASCADE | |
| `created_at` | timestamptz, default `now()` | |

**Unique constraint:** `(judge_id, competition_id)` — a judge cannot be double-assigned to the same competition.

**No `event_id` column.** Both `judges` and `competitions` already reference `events`. Join through either when filtering by event. Avoids denormalization sync risk.

Many-to-many: a competition can have multiple judges (panel of 3), and a judge can be assigned many competitions.

### Competition table additions (migrations 008 + 009)

Migration 008 added a `roster_confirmed` boolean. Migration 009 replaced it with auditable fields:

| Column | Type | Notes |
|---|---|---|
| `roster_confirmed_at` | timestamptz, nullable | When the roster was confirmed |
| `roster_confirmed_by` | text, nullable | Who confirmed it (e.g. "Side-Stage") |

**Checking confirmation status:** `roster_confirmed_at IS NOT NULL`.

**Un-confirming:** `roster_confirmed_at` can be set back to `null` if the roster was confirmed in error or a late change is needed. Only allowed while the competition is still `ready_for_day_of` — once released to judge or in progress, the roster is locked.

## State Machine

The state machine lives in `src/lib/competition-states.ts`. The full transition graph:

```
draft -> imported -> ready_for_day_of -> released_to_judge -> in_progress -> awaiting_scores -> ready_to_tabulate -> complete_unpublished -> published -> locked
```

Key branching:
- `ready_for_day_of` can go to `released_to_judge` (primary path) or `in_progress` (fallback, for events not using side-stage release)
- `released_to_judge` can go to `in_progress` (judge starts) or back to `ready_for_day_of` (recall)
- `ready_to_tabulate` can go to `complete_unpublished`, `recalled_round_pending`, or `awaiting_scores` (unlock for correction)

### Who triggers each transition

| Transition | Who | Where |
|---|---|---|
| `imported -> ready_for_day_of` | Organizer | Dashboard |
| `ready_for_day_of -> released_to_judge` | Side-stage or organizer | Side-stage view or dashboard |
| `released_to_judge -> in_progress` | Judge | Judge competition list "Start Scoring" button |
| `released_to_judge -> ready_for_day_of` | Side-stage or organizer | Side-stage "Recall" button or dashboard |
| `ready_for_day_of -> in_progress` | Organizer | Dashboard (fallback when side-stage release is not used) |
| `in_progress -> awaiting_scores` | Auto (round creation) | Scoring page |
| `awaiting_scores -> ready_to_tabulate` | Auto on all assigned judges sign-off | Judge scoring page |
| `ready_to_tabulate -> complete_unpublished` | Organizer | Dashboard (runs tabulation) |
| `complete_unpublished -> published` | Organizer | Dashboard |

The organizer retains the ability to trigger any valid transition from the dashboard (override capability for edge cases).

### Release-to-judge prerequisites

The `ready_for_day_of -> released_to_judge` transition is gated by `getTransitionBlockReason()`:

1. **Roster must be confirmed** — `roster_confirmed_at` is not null
2. **Judges must be assigned** — at least one judge assignment exists for the competition

Both the side-stage view and the organizer dashboard enforce these gates.

## Three Views

### View 1: Organizer Dashboard (existing, enhanced)

**Judge assignment UI** on the judges page (`/dashboard/events/[eventId]/judges`):

- Click a judge to expand their assignment panel
- Batch assign by code range, by level, by age group
- "Assign All Competitions" for single-stage feiseanna
- Count badge per judge: "12 comps assigned"
- Remove individual assignments or clear all
- Assignment changes to completed competitions auto-revert `ready_to_tabulate` to `awaiting_scores` when sign-offs are incomplete

This is part of pre-feis setup: import syllabus -> create judges -> assign competitions to judges -> mark competitions ready for day-of.

**Roster confirmation from dashboard:** The organizer can also confirm/un-confirm rosters and release competitions to judges from the dashboard. This is the fallback when no dedicated side-stage person is available.

The rest of the organizer dashboard stays the same — pipeline view, tabulation, corrections, publishing.

### View 2: Side-Stage (`/checkin/[eventId]`)

The side-stage view is a **competition-readiness station** for the volunteer at the side of the stage. It manages the pipeline from roster confirmation through release to judge and tracks competition progress.

**Filters:**
- Filter by judge (shows only that judge's assigned competitions)
- Filter by stage (when stages are configured)

**Competition groups** (five sections):

| Group | Statuses | Purpose |
|---|---|---|
| **Scoring** | `in_progress`, `awaiting_scores` | Currently being judged — shows heat progress |
| **Sent to Judge** | `released_to_judge` | Released but not yet started — shows "Recall" button |
| **Ready** | `ready_for_day_of` + roster confirmed | Roster confirmed, ready to send — shows "Send to Judge" button |
| **Upcoming** | `imported`, `draft`, or `ready_for_day_of` without confirmation | Not yet ready — tap to expand roster and start checking in dancers |
| **Done** | `ready_to_tabulate` or later | Completed — collapsed by default |

**Roster management** (expanded competition):
- Shows each dancer with competitor number and arrival status
- Mark each dancer: Present / No Show / Scratched
- Checks event-wide check-in status (from registration desk `event_check_ins` table)
- "Confirm Roster" button — requires all dancers accounted for (no `registered` status remaining)
- "Un-confirm" allowed while competition is still `ready_for_day_of`

**Release to judge:**
- "Send to Judge" button appears on `ready_for_day_of` competitions with confirmed rosters
- Transitions competition to `released_to_judge`
- Warns if other competitions are already sent or scoring (confirmation dialog)
- Uses atomic conditional update (`WHERE status = 'ready_for_day_of'`) to prevent race conditions

**Recall:**
- "Recall" button appears on `released_to_judge` competitions
- Transitions back to `ready_for_day_of`
- Only works if the judge has not yet started (atomic conditional update on `status = 'released_to_judge'`)

**Live scratches during scoring:**
- When a competition is in progress, the side-stage person can still mark dancers as scratched/no-show
- Updates the round's `heat_snapshot` slot statuses so the judge sees changes in real time

### View 3: Judge Scoring (`/judge/[eventId]` and `/judge/[eventId]/[compId]`)

**Competition list** (`/judge/[eventId]`):

Competitions are filtered to the judge's assignments (via `judge_assignments`). If no assignments exist for this judge, all event competitions are shown (backward compatibility).

Competitions are sorted by `schedule_position` (nulls last), then by `code`.

**Three groups:**

| Group | Statuses | UI |
|---|---|---|
| **Score Now** | `released_to_judge`, `in_progress`, `awaiting_scores` | "Start Scoring" button for `released_to_judge`; direct link for `in_progress`/`awaiting_scores` |
| **Queued** | `ready_for_day_of` with roster confirmed | "Start" button (fallback path, bypasses release) |
| **Done** | `ready_to_tabulate`, `complete_unpublished`, `published`, `locked`, `recalled_round_pending` | Count summary line |

**Schedule awareness:** When competitions have `schedule_position` values and stages are configured, a NOW/NEXT indicator card appears per stage showing what is currently scoring and what is next.

**"Start Scoring" button behavior (on `released_to_judge` competition):**

1. If competition is already `in_progress` or `awaiting_scores`, navigate directly to scoring page (panel judging: second judge arriving)
2. Validate `canTransition(comp.status, 'in_progress')`
3. Transition competition to `in_progress` (atomic conditional update on current status)
4. Audit log the transition with `trigger: 'judge_start'`
5. Create Round 1 if no round exists
6. Generate heat snapshot from active registrations using `generateHeats()`
7. Persist heat snapshot to the round
8. Navigate judge to the scoring page

Steps 5-7 are best-effort and non-blocking — scoring proceeds even if heat snapshot generation fails.

**Panel judging (multiple judges per competition):** When Judge A taps "Start Scoring", the competition moves to `in_progress`. Judge B sees it in the "Score Now" group and taps through directly to the scoring page — no redundant state transition.

**Scoring page** (`/judge/[eventId]/[compId]`):

- Shows roster filtered to active dancers, organized by heats when a heat snapshot exists
- Score entry per dancer with flagging support
- Completed heats auto-collapse; current heat is highlighted
- Absent dancers (scratched/no-show) shown with strikethrough
- Competition-recalled banner if organizer changes status away from scoring

**Sign-off sequence:**

1. Lock all score entries for this judge/round (`locked_at` timestamp)
2. Record sign-off in round's `judge_sign_offs` JSONB field
3. Check if all assigned judges have signed off (or all event judges if no assignments exist)
4. If all done: auto-advance through `in_progress -> awaiting_scores -> ready_to_tabulate`
5. Audit log the sign-off and any status changes

After sign-off, the judge returns to the competition list. The finished competition appears in the Done group.

## Live Update Strategy

Both side-stage and judge views use a dual-layer approach:

**Primary: Supabase Realtime subscriptions**
- Subscribe to `postgres_changes` on the `competitions` table for status and roster confirmation updates
- Side-stage also subscribes to `event_check_ins` for registration desk arrivals
- Scoring page subscribes to `registrations` and `rounds` for live scratch/heat updates

**Fallback: 5-second polling**
- Lightweight query: `SELECT id, status, roster_confirmed_at FROM competitions WHERE id IN (...)`
- Side-stage also re-fetches check-in data on each poll cycle

**Visibility pause/resume:** Both polling and Realtime benefits from a `document.visibilitychange` listener. Polling pauses when the tab is hidden and resumes with an immediate fetch when the tab becomes visible again.

## Seed Script

The existing seed script (`scripts/seed-newport-feis.mjs`) creates judge assignments — assigning each judge a set of competitions so the workflow is testable out of the box.

## Acceptance Criteria

1. **Organizer can assign competitions to judges** — batch by code range, level, or age group. Assignments visible per judge with count badge.
2. **Judge sees only assigned competitions** — filtered to their assignments in code/schedule order. Falls back to all competitions if no assignments exist.
3. **Judge can start a `released_to_judge` competition** — "Start Scoring" button transitions to `in_progress`, creates round + heat snapshot, navigates to scoring page.
4. **Panel judging works** — second judge on same competition navigates directly to scoring. No state transition error.
5. **Side-stage person can confirm rosters** — expand competition, mark attendance, tap "Confirm Roster" (blocked until all dancers accounted for). Auto-advances `imported` to `ready_for_day_of`.
6. **Side-stage person can release to judge** — "Send to Judge" requires `roster_confirmed_at IS NOT NULL` and at least one judge assigned.
7. **Side-stage person can recall** — "Recall" button on `released_to_judge` competitions reverts to `ready_for_day_of`.
8. **Views update via Realtime** — status changes appear immediately via Supabase Realtime subscriptions, with 5-second polling as fallback.
9. **Judge view uses three groups** — Score Now, Queued, Done.
10. **Organizer retains override** — all valid transitions still available from dashboard.
11. **Roster un-confirm** — allowed while competition is `ready_for_day_of`, blocked once released or in progress.
12. **Seed script creates assignments** — Newport Feis seed data includes judge-competition assignments for immediate testability.

## Not In Scope

- Prediction engine ("when am I up?" estimation UI)
- Public dancer view (parents checking schedules)
- Cross-stage conflict detection (dancer on two stages at once)
- Automated scheduling (organizer assigns manually)
- Judge reassignment mid-competition (reassign between competitions only)
