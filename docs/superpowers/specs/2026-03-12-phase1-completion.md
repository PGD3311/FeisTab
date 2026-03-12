# Phase 1 Completion — Operator Control Layer

**Date:** 2026-03-12
**Goal:** Build the control layer that makes FeisTab usable and trustworthy in the real world.
**North star:** Make tabulation and results trustworthy, fast, and hard to screw up.

---

## Current State

Phase 1 is no longer a scoring-math problem. It is now an operator workflow problem. The core scoring foundation is in place (engine, anomaly detection, state machine, 97 tests). What's missing is the control layer: explicit state transitions, dancer status handling, tabulation preview, audit logging, correction workflows, publish controls, and failure-safe recovery.

**The test for "done":** A normal operator can do this without touching the database:
1. Import / create competition
2. Advance it into a scoreable state
3. Collect judge scores
4. Surface blockers/warnings
5. Tabulate safely
6. Verify / sign off
7. Publish result
8. Inspect audit trail afterward

---

## Gap 1: Competition Advancement Flow (Priority 1)

**Problem:** After CSV import, competitions are stuck at `imported`. No UI to advance through `imported → ready_for_day_of → in_progress → awaiting_scores`. The system is "developer-operated," not "organizer-operated."

**Fix:** Add a "Next Step" action button on the competition detail page (`[compId]/page.tsx`) that shows the next valid transition(s) from `getNextStates()`. One button, always shows the right action for the current state. Uses `canTransition()` before every update.

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

**Acceptance criteria:**
- Organizer can advance a competition from `imported` all the way to `awaiting_scores` via button clicks
- Each transition goes through `canTransition()`
- Button label reflects the next state (e.g., "Mark Ready for Day-Of", "Start Competition", "Open for Scoring")
- Button is disabled/hidden when no transitions are available

---

## Gap 2: Error Handling on Scoring/Tabulation (Priority 2)

**Problem:** If Supabase fails mid-tabulation, partial results get written with no rollback and no feedback. Silent failures are poison for trust.

**Fix:**
- Wrap `handleTabulate()`, `handleSignOff()`, `handlePublish()` in try/catch with user-visible error state
- Check `.error` on all Supabase calls in the scoring/tabulation/sign-off paths
- Add a root `error.tsx` boundary so React crashes don't white-screen the app
- Fix judge sign-off to use `canTransition()` (closes state machine enforcement gap)

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx` (sign-off error handling + canTransition fix)
- Create: `src/app/error.tsx` (root error boundary)
- Create: `src/app/dashboard/error.tsx` (dashboard error boundary)

**Acceptance criteria:**
- All Supabase responses in the scoring/tabulation flow check `.error`
- User sees a visible error message if any DB call fails
- Tabulation is wrapped in try/catch — partial failure shows error, doesn't silently corrupt
- Judge sign-off uses `canTransition()` before status update
- Root and dashboard error boundaries catch React rendering failures

---

## Gap 3: Audit Trail Wiring (Priority 3)

**Problem:** `logAudit()` exists with proper types and table, but is called zero times. Phase 1 says "defensible output" — dead code is not a feature.

**Fix:** Wire `logAudit()` into the 6 critical actions:
1. Score submission (judge enters/edits a score)
2. Sign-off (judge locks scores for a round)
3. Status change (competition advances to new state)
4. Tabulation (results calculated)
5. Result publish (results made public)
6. Result unpublish (results pulled back)

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` (status change, tabulation, publish)
- Modify: `src/app/dashboard/events/[eventId]/results/page.tsx` (publish/unpublish)
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx` (score submission, sign-off)

**Acceptance criteria:**
- Every critical action writes to `audit_log` with: action type, entity IDs, actor info, timestamp
- After running the full workflow, `audit_log` contains a complete trail of what happened
- Audit logging failures do not block the primary action (fire-and-forget, console.error on failure)

---

## Gap 4: Dancer Status Handling

**Problem:** No UI for organizers to mark dancers as scratched, no-show, DNC, or medical. The anomaly engine detects "registered but no scores and no explanation" — but there's no way to provide the explanation. Operators need to update dancer status before/during a competition.

**Fix:** Add dancer status controls on the competition detail page roster. Dropdown or quick-action buttons for common statuses (scratched, no-show, did_not_complete, medical) with optional reason.

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

**Acceptance criteria:**
- Organizer can change a dancer's registration status from the roster view
- Status changes clear the "unexplained no scores" warnings
- Status changes are audit-logged

---

## Gap 5: Tabulation Preview and Approval

**Problem:** Tabulation currently runs and commits results in one step. No preview. No "are you sure?" If something looks wrong, results are already written.

**Fix:** Split tabulation into preview → approve → commit. Show results in a preview table before writing to the database. Organizer reviews and clicks "Approve Results" to commit.

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

**Acceptance criteria:**
- "Run Tabulation" shows a preview of results without writing to the database
- Preview shows rank, dancer name, points, per-judge breakdown
- "Approve & Save Results" commits to the database
- "Cancel" discards the preview
- Approved results are audit-logged

---

## Gap 6: Correction Workflows

**Problem:** What happens when a score is wrong after sign-off? Currently no path to correct it. Scores are locked, and there's no unlock mechanism.

**Fix:** Add an "Unlock for Correction" flow on the competition detail page. Organizer can unlock a judge's scores for a specific round, which:
1. Reverts sign-off for that judge
2. Transitions competition back to `awaiting_scores`
3. Logs the unlock in the audit trail
4. Judge can then re-enter/edit and re-sign-off

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

**Acceptance criteria:**
- Organizer can unlock a specific judge's scores for correction
- Unlock reverts sign-off and transitions state back appropriately
- Unlock is audit-logged with reason
- Judge can re-edit and re-sign-off
- Previously computed results are cleared if scores change

---

## Gap 7: Score Entry Responsiveness

**Problem:** Score entry form has no responsive breakpoints. Judges use phones at the table.

**Fix:** Add `flex-wrap` and responsive breakpoints to `score-entry-form.tsx` so it stacks properly on narrow screens.

**Files:**
- Modify: `src/components/score-entry-form.tsx`

**Acceptance criteria:**
- Score entry form is usable on a 375px-wide phone screen
- Inputs stack vertically on narrow screens
- Touch targets are large enough for reliable tapping

---

## Priority Order

1. Competition advancement buttons (unblocks the entire demo flow)
2. Error handling around scoring/tabulation (prevents silent corruption)
3. Audit logging wiring (completes the trust story)
4. Dancer status handling (closes the "unexplained no scores" loop)
5. Tabulation preview and approval (adds review before commit)
6. Correction workflows (handles the "oops" case)
7. Score entry responsiveness (field-readiness for judges on phones)
