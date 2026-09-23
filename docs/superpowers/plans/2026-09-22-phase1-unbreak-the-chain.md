# Phase 1: Unbreak the Chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every feis-day action that currently "succeeds" on screen but is silently discarded by RLS goes through a role-checked database function, and the RPC security holes found on 2026-09-22 are closed.

**Architecture:** The March security hardening (migrations 024–030) set `UPDATE/INSERT/DELETE USING (false)` on most tables but left 20 client-side direct writes in place (security plan Task 11, never finished). Postgres returns zero rows and no error for an RLS-filtered UPDATE/DELETE, so the UI reports success. This plan adds one migration (`032_phase1_unbreak_chain.sql`) that creates or replaces SECURITY DEFINER RPCs for every blocked write, validates the competition state machine in the database, and closes the cross-event holes. The pages are then switched to typed wrappers in `src/lib/supabase/rpc.ts`.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), Next.js 15 client pages, Vitest.

**Spec:** Report "FeisTab: state of the app" (claude.ai doc, 2026-09-22). The sections that apply: "The feis-day chain", "Gaps and risks" #1–5 and #8, and "Database and security" #1–5.

## Global Constraints

- All status changes go through `canTransition()` on the client, and now through `is_valid_transition()` in the DB. The two transition tables must match exactly. A parity test enforces this.
- Integer-math scoring and the engine in `src/lib/engine/` are not touched.
- No `any` in new code. Always check `.error` on Supabase responses. Form submissions use try/catch.
- Every new SECURITY DEFINER function sets `search_path = public`, checks the caller's role via `user_event_role()`, and writes `audit_log`.
- Revoke EXECUTE on every write RPC from `anon`. Only `public_feedback` and the new `public_event_results` / `public_feedback_header` stay callable anonymously.
- The public read paths must never expose `dancers.date_of_birth`.
- No `supabase` Branch DB exists; migrations are applied by hand to project `acxyvouzwgvobtbmvoej`. The SQL tests run inside a transaction that always rolls back.

## Review Focus

1. A scratch made at side-stage while the judge is scoring must reach the judge's screen (status plus heat snapshot) through realtime.
2. The last judge's sign-off must leave the competition in `ready_to_tabulate` with no error on screen. A second sign-off tap must not error.
3. Unlock for correction must delete the stale results, so a re-publish can't show old placings.
4. A logged-in user with no role in an event must be refused by every event-scoped RPC, including when they pass a competition/dancer/round/judge id from another event alongside their own event id.
5. An anonymous visitor to `/results/<eventId>` sees published competitions and dancer names only, with no DOB and nothing unpublished.

## File Map

- Create: `supabase/migrations/032_phase1_unbreak_chain.sql`
- Create: `supabase/tests/032_phase1_rpc_tests.sql` (a rollback-only SQL test, run through Supabase MCP `execute_sql`)
- Create: `tests/db/transition-parity.test.ts`
- Modify: `src/lib/supabase/rpc.ts` (new wrappers; `guardedStatusUpdate` → RPC)
- Delete: `src/lib/check-in-sync.ts` (the number sync moves into `check_in_dancer`)
- Modify pages:
  - `registration/[eventId]`
  - `checkin/[eventId]`
  - `judge/[eventId]`
  - `judge/[eventId]/[compId]`
  - `dashboard/page`
  - `dashboard/events/[eventId]/competitions/[compId]`
  - `.../tabulator`
  - `.../judges`
  - `.../import`
  - `results/[eventId]`
  - `results/[eventId]/feedback/[dancerId]`

---

### Task 1: Migration 032 plus SQL tests

**Files:** create `supabase/migrations/032_phase1_unbreak_chain.sql` and `supabase/tests/032_phase1_rpc_tests.sql`.

**Produces (RPC signatures later tasks rely on):**
- `transition_competition_status(p_competition_id uuid, p_new_status text, p_expected_status text DEFAULT NULL) → void`
  - Checks the state machine. Roles:
    - organizer: any valid transition
    - side_stage: `imported→ready_for_day_of`, `ready_for_day_of↔released_to_judge`
    - assigned judge: `ready_for_day_of|released_to_judge → in_progress`
  - Idempotent when already in the target status.
- `sign_off_judge(p_round_id, p_judge_id, p_competition_id, p_action DEFAULT 'add') → jsonb`
  - `add` locks the judge's scores, records the sign-off, and auto-advances to `ready_to_tabulate` when every assigned judge has signed.
  - Only an organizer can `remove`. Removing also unlocks the scores.
- `unlock_for_correction(p_competition_id uuid, p_judge_id uuid, p_reason text, p_note text DEFAULT NULL) → void`
- `set_registration_status(p_registration_id uuid, p_status text) → void`: organizer or side_stage; also patches the latest round's heat_snapshot slot.
- `confirm_roster(p_competition_id) → void` and `unconfirm_roster(p_competition_id) → void`: organizer or side_stage.
- `create_round(p_competition_id, p_round_number, p_round_type DEFAULT 'standard') → uuid`: organizer or assigned judge; idempotent.
- `update_heat_snapshot(p_round_id, p_snapshot) → void`: organizer, side_stage, or an assigned judge while the snapshot is still empty.
- `check_in_dancer(p_event_id, p_dancer_id, p_competitor_number int) → uuid`: dancer must be registered in the event; also syncs `registrations.competitor_number`.
- `undo_check_in(p_event_id uuid, p_dancer_id uuid) → void`
- `register_dancer`, `submit_score`, `tabulator_enter_score`: add cross-event ownership checks.
- `import_event_rows(p_event_id uuid, p_rows jsonb) → jsonb {competitions_created, registrations, check_ins, conflicts: uuid[]}`
- `delete_event(p_event_id uuid) → void`: refused if any competition is published or locked.
- `remove_judge(p_judge_id uuid) → void`: refused if the judge has scores.
- `public_event_results(p_event_id uuid) → jsonb` and `public_feedback_header(p_event_id uuid, p_dancer_id uuid) → jsonb`: anon-callable, published data only.
- Trigger `trg_competition_status_guard`: rejects any competitions.status UPDATE that isn't a valid transition.
- Policies:
  - `registrations_select_floor`: side_stage for the event, or a judge assigned to the competition.
  - `rule_sets` insert/update: false.
  - `pending_invitations` insert: `judge_id` must belong to the same event.
- Drops: `update_stage_status` (unused, and it has the cross-event hole). Revokes anon/authenticated EXECUTE on `fulfill_invitation`.

- [ ] Step 1: Write `supabase/tests/032_phase1_rpc_tests.sql`: a single DO block that creates two throwaway users and two events, impersonates each role through `set_config('request.jwt.claims', ...)` plus `SET LOCAL ROLE authenticated`, asserts every Review Focus item and each hole from the report, and ends with `RAISE EXCEPTION 'TESTS PASSED: n'` so everything rolls back.
- [ ] Step 2: Run it against the live DB before the migration. Expected: fails, because the functions don't exist or behave the old way.
- [ ] Step 3: Write the migration.
- [ ] Step 4: Apply it with MCP `apply_migration`. Re-run the tests. Expected: `TESTS PASSED`.
- [ ] Step 5: Re-run Supabase security advisors. Expected: no ERROR, and no anon-executable write RPCs.
- [ ] Step 6: Commit `feat(db): phase 1 RPCs — role-checked writes, state machine guard, cross-event checks`.

### Task 2: Transition parity test

- [ ] Write `tests/db/transition-parity.test.ts`. It reads migration 032, extracts the `('from','to')` pairs from `is_valid_transition`, and asserts they equal every `canTransition` pair produced from `getNextStates()` over all statuses.
- [ ] Run `npx vitest run tests/db`: PASS. Commit.

### Task 3: RPC wrappers

- [ ] In `src/lib/supabase/rpc.ts`:
  - Re-implement `guardedStatusUpdate` as a call to `transition_competition_status` with `p_expected_status`; keep its signature, drop `extraFields`.
  - Add typed wrappers: `unlockForCorrection`, `setRegistrationStatus`, `unconfirmRoster`, `undoCheckIn`, `importEventRows`, `deleteEvent`, `removeJudge`.
  - Remove `updateStageStatus`.
  - Change `createRound`'s default round type to `'standard'`.
- [ ] Commit.

### Task 4: Registration desk

- [ ] `registration/[eventId]/page.tsx`:
  - Assign: drop the `syncCompetitorNumberToRegistrations` call.
  - Re-check-in: call `checkInDancer` with the existing number.
  - Undo: call `undoCheckIn`.
- [ ] Delete `src/lib/check-in-sync.ts`. Commit.

### Task 5: Side-stage

- [ ] `checkin/[eventId]/page.tsx`:
  - Status change → `setRegistrationStatus`. Drop the client snapshot write, and patch local `heatSnapshot` state only after the RPC succeeds.
  - Un-confirm → `unconfirmRoster`.
- [ ] Commit.

### Task 6: Judge flow

- [ ] `judge/[eventId]/[compId]/page.tsx` `handleSignOff`: remove the direct `locked_at` update and the whole auto-advance block; call `signOffJudge` only.
- [ ] `judge/[eventId]/page.tsx`: no change needed, since `transition_competition_status`, `create_round` and `update_heat_snapshot` now accept an assigned judge.
- [ ] Commit.

### Task 7: Organiser competition page and tabulator

- [ ] `competitions/[compId]/page.tsx`:
  - Unlock → `unlockForCorrection(reason, note)`.
  - Roster status select → `setRegistrationStatus`.
  - Un-confirm → `unconfirmRoster`.
- [ ] `tabulator/page.tsx`: remove the `locked_at` update and the post-sign-off `guardedStatusUpdate` calls.
- [ ] Commit.

### Task 8: Import, event delete, judge delete, bulk ready

- [ ] `import/page.tsx`: send `preview.valid` to `importEventRows` and map the result into the existing `conflicts` state. Remove `syncFailures`.
- [ ] `dashboard/page.tsx`: delete → `deleteEvent`.
- [ ] `judges/page.tsx`: remove → `removeJudge`.
- [ ] `dashboard/events/[eventId]/page.tsx` "Mark All Ready": keep the direct update (organizers are allowed; the trigger now guards validity).
- [ ] Commit.

### Task 9: Public results

- [ ] `results/[eventId]/page.tsx`: load through `public_event_results`.
- [ ] Feedback page: load the header through `public_feedback_header`.
- [ ] Commit.

### Task 10: Verify

- [ ] Run `npx tsc --noEmit`, `npm run lint`, `npm test` and `npm run build`. All must pass.
- [ ] Re-run the SQL tests and the security advisors.
- [ ] Browser walkthrough (a mock feis):
  - check in 3 dancers
  - scratch 1 at side-stage
  - judge sees the scratch
  - judge scores and signs off: no error, status `ready_to_tabulate`
  - tabulate, approve, publish
  - anonymous window sees results
  - unlock for correction clears the results
