# Judge-Driven Competition Flow

## Goal

Shift competition-day control from the organizer to the people at the stage: **judges start and end competitions**, a **side-stage person confirms rosters and manages the queue**, and the **organizer handles tabulation and results** from the back office. All three views share the same data — the syllabus is the single source of truth.

## Context

At a real feis, the organizer preps everything before the day (import syllabus, create judges, assign competitions). On competition day, the judge at the table controls the pace — they start when dancers are ready and submit when scoring is done. A volunteer at the side of the stage calls competitor numbers, confirms who's present, and feeds the next group to the judge. The organizer watches the big picture and handles results.

Currently, FeisTab requires the organizer to advance every competition through the state machine. Judges can only score competitions that are already `in_progress`. There's no roster confirmation view, no way to assign specific competitions to specific judges, and no live status view.

## Data Model

### New table: `judge_assignments`

Migration: next available number (e.g., `008_judge_assignments.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK, default `gen_random_uuid()` | |
| `judge_id` | uuid, FK → judges, ON DELETE CASCADE | |
| `competition_id` | uuid, FK → competitions, ON DELETE CASCADE | |
| `created_at` | timestamptz, default `now()` | |

**Unique constraint:** `(judge_id, competition_id)` — a judge can't be double-assigned to the same competition.

**Note:** No `event_id` column. Both `judges` and `competitions` already reference `events`. Join through either when filtering by event. Avoids denormalization sync risk.

Many-to-many: a competition can have multiple judges (panel of 3), and a judge can be assigned many competitions.

### Competition table addition

Same migration file.

| Column | Type | Notes |
|---|---|---|
| `roster_confirmed` | boolean, default false | Flipped after checking in dancers |

**Index:** `CREATE INDEX idx_competitions_roster_confirmed ON competitions (roster_confirmed) WHERE roster_confirmed = true;` — partial index for filtering ready-to-start competitions.

**Un-confirming:** `roster_confirmed` can be set back to `false` if the roster was confirmed in error or a late change is needed. Only allowed while the competition is still `ready_for_day_of` — once a judge taps "Start" and the competition is `in_progress`, the roster is locked.

## Three Views

### View 1: Organizer Dashboard (existing, enhanced)

**Judge assignment UI** on the existing judges page (`/dashboard/events/[eventId]/judges`):

- Click a judge → see their currently assigned competitions
- Batch assign by code range ("1–50"), by level ("all Beginner"), by age group ("all Under 8")
- "Assign All" for single-stage feiseanna where every judge gets everything
- Count badge per judge: "Margaret — 50 comps assigned"
- Remove/reassign competitions on the fly

This is part of pre-feis setup: import syllabus → create judges → assign competitions to judges → mark competitions ready for day-of.

**Roster confirmation from dashboard:** The organizer can also confirm/un-confirm rosters from the existing competition detail page. This is the fallback when no dedicated side-stage person is available.

The rest of the organizer dashboard stays the same — pipeline view, tabulation, corrections, publishing.

### View 2: Side-Stage Roster Confirmation (new page: `/checkin/[eventId]`)

A streamlined roster confirmation view for the side-stage volunteer. This is NOT a full check-in/registration screen — it uses the existing `registrations.status` field to mark attendance and confirm rosters for the judge. The organizer dashboard can do the same thing; this view is optimized for speed on a tablet.

**Scope note:** CLAUDE.md forbids "check-in screens" (Phase 3). This view is narrowly scoped to roster confirmation — a gate for the scoring pipeline. It writes to `registrations.status` (existing field) and `competitions.roster_confirmed` (new field). No new registration, no event-ops features.

**Features:**
- Filter by judge (effectively: "show me this judge's competitions")
- Competitions in syllabus code order
- Three groups: **NOW** (in_progress), **NEXT** (ready_for_day_of), **UPCOMING** (imported/not yet ready), **DONE** (ready_to_tabulate or later)
- Tap a competition to expand its roster
- Mark each dancer: present / no-show / scratched (writes to `registrations.status`)
- "Confirm Roster" button → sets `roster_confirmed = true` on the competition
- "Un-confirm" allowed while competition is still `ready_for_day_of`
- Polls competition statuses every 5 seconds (lightweight query: competition id, status, roster_confirmed only)
- When a judge signs off and competition advances, the view updates

**Minimal, fast UI.** Large tap targets, clear status colors, works on a tablet held in one hand.

### View 3: Judge Scoring (existing, enhanced)

**Changes to judge competition list** (`/judge/[eventId]`):

- Show competitions where the judge is assigned (via `judge_assignments`)
- **Fallback:** If no assignments exist for this judge, show all competitions for the event (backward compatibility with events that don't use assignments)
- Competitions in code order
- Four groups:
  - **Ready to Start** — `ready_for_day_of` AND `roster_confirmed = true` → shows "Start" button
  - **Scoring** — `in_progress` or `awaiting_scores` → shows "Score Now" (existing behavior)
  - **Waiting** — `ready_for_day_of` but `roster_confirmed = false`, or `imported` → grayed out, "Roster not confirmed yet"
  - **Done** — `ready_to_tabulate` or later → shows checkmark

**"Start" button behavior:**
1. Checks current status — if already `in_progress` or `awaiting_scores`, skip to step 5 (handles panel judging: second judge clicking "Start" on an already-started competition)
2. Validates `canTransition('ready_for_day_of', 'in_progress')`
3. Transitions competition to `in_progress`
4. Audit logs the transition with `trigger: 'judge_start'`
5. Navigates judge to the scoring page

**Round creation:** Round 1 is created when the judge enters the scoring page and no round exists, via the existing `in_progress → awaiting_scores` transition in the organizer dashboard code. The "Start" button does a single transition (`ready_for_day_of → in_progress`). The scoring page handles creating the round and advancing to `awaiting_scores` as it does today.

**Panel judging (multiple judges per competition):** When Judge A taps "Start", the competition moves to `in_progress`. Judge B sees it as "Scoring" (not "Start") and taps "Score Now" to go directly to the scoring page. The "Start" button is idempotent — if the competition is already beyond `ready_for_day_of`, it navigates to scoring instead of trying to transition again.

**Scoring page** (`/judge/[eventId]/[compId]`) — no changes needed. The judge sees the roster (already filtered to active dancers), enters scores, signs off. Auto-advance on sign-off already works.

**After sign-off:** Judge returns to competition list. The just-finished competition shows as DONE. The next competition with a confirmed roster shows "Start."

## State Machine

No changes to the state machine transitions or `canTransition()`. What changes is who triggers them:

| Transition | Who triggers it | Where |
|---|---|---|
| `imported → ready_for_day_of` | Organizer | Dashboard |
| `ready_for_day_of → in_progress` | **Judge** (new) | Judge competition list "Start" button |
| `in_progress → awaiting_scores` | Organizer or auto (round creation) | Dashboard competition detail / scoring page |
| `awaiting_scores → ready_to_tabulate` | Auto on all assigned judges sign-off | Judge scoring page (existing) |
| `ready_to_tabulate → complete_unpublished` | Organizer runs tabulation | Dashboard |
| `complete_unpublished → published` | Organizer publishes | Dashboard |

The organizer retains the ability to trigger any transition from the dashboard (override capability for edge cases). The judge's "Start" is the primary path on competition day.

## Polling Strategy

Side-stage and judge views use `setInterval` polling (every 5 seconds) to stay current:

- **What gets polled:** Competition statuses and `roster_confirmed` only — a lightweight query (`SELECT id, status, roster_confirmed FROM competitions WHERE id IN (...)`)
- **Not polled:** Full roster data, scores, rounds. These are loaded on-demand when the user taps into a competition.
- **Tab visibility:** Polling pauses when the browser tab is hidden (`document.visibilitychange`) and resumes when visible.

No Supabase realtime subscriptions — polling is simpler and sufficient for this use case.

## Seed Script Update

The existing seed script (`scripts/seed-newport-feis.mjs`) should be updated to create judge assignments — assign each of the 5 judges a set of competitions so the workflow is testable out of the box. Example distribution: Judge 1 gets competitions 1-50, Judge 2 gets 51-100, etc., with overlap for championship-level competitions (multiple judges per panel).

## Acceptance Criteria

1. **Organizer can assign competitions to judges** — batch by code range, level, or age group. Assignments visible per judge with count badge.
2. **Judge sees only assigned competitions** — filtered to their assignments in code order. Falls back to all competitions if no assignments exist.
3. **Judge can start a competition** — "Start" button appears for `ready_for_day_of` + `roster_confirmed` competitions. Transitions to `in_progress`, navigates to scoring.
4. **Panel judging works** — second judge on same competition sees "Score Now" instead of "Start". No state transition error.
5. **Side-stage person can confirm rosters** — expand competition, mark attendance, tap "Confirm Roster". Judge's "Start" button appears.
6. **Side-stage view updates live** — polling shows status changes within 5 seconds.
7. **Judge view updates live** — polling shows roster confirmations and status changes within 5 seconds.
8. **Organizer retains override** — all transitions still available from dashboard.
9. **Seed script creates assignments** — Newport Feis seed data includes judge-competition assignments for immediate testability.
10. **Roster un-confirm** — allowed while competition is `ready_for_day_of`, blocked once `in_progress`.

## Not In Scope

- **Prediction engine** — "when am I up?" estimation UI
- **Stages table** — judge assignments are the implicit stage grouping
- **Public dancer view** — parents checking schedules
- **Cross-stage conflict detection** — dancer on two stages at once
- **Automated scheduling** — organizer assigns manually
- **Supabase realtime** — polling is sufficient
- **Judge reassignment mid-competition** — reassign between competitions only
