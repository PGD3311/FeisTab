# Phase 1 Completion — Operational Gaps

**Date:** 2026-03-12
**Goal:** Close the three gaps between "Phase 1 core logic done" and "Phase 1 full workflow done."
**North star:** Make tabulation and results trustworthy, fast, and hard to screw up.

---

## Current State

Phase 1 core engine is ~85% complete. Scoring logic, anomaly detection, tabulation, and result gating are solid and tested (97 tests). But the operational layer that makes it trustworthy and demo-safe has three real gaps.

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

## Bonus Fix: Score Entry Responsiveness

**Problem:** Score entry form has no responsive breakpoints. Judges use phones.

**Fix:** Add `flex-wrap` and responsive breakpoints to `score-entry-form.tsx` so it stacks properly on narrow screens.

**Files:**
- Modify: `src/components/score-entry-form.tsx`

---

## Priority Order

1. Competition advancement buttons (unblocks the entire demo flow)
2. Error handling around scoring/tabulation (prevents silent corruption)
3. Audit logging wiring (completes the trust story)
4. Score entry responsiveness (field-readiness for judges on phones)
