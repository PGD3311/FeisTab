# Phase 1 Completion — Operator Control Layer

**Date:** 2026-03-12
**Goal:** Build the control layer that makes FeisTab usable and trustworthy in the real world.
**North star:** Make tabulation and results trustworthy, fast, and hard to screw up.

**Key insight:** FeisTab must support both digital-first scoring and paper-first transcription, because paper-first is the adoption bridge.

---

## Current State

Phase 1 is no longer a scoring-math problem. It is now an operator workflow problem. The core scoring foundation is in place (engine, anomaly detection, state machine, 97 tests). What's missing is the control layer: explicit state transitions, dancer status handling, tabulation preview, audit logging, correction workflows, publish controls, and failure-safe recovery.

**The test for "done":** A normal operator can do this without touching the database:
1. Import / create competition
2. Advance it into a scoreable state
3. Collect judge scores — either via judge self-service OR tabulator transcription from paper
4. Surface blockers/warnings
5. Tabulate safely
6. Verify / sign off
7. Publish result
8. Inspect audit trail afterward

---

## Gap 1: Tabulator Score Entry Mode (Priority 1)

**Problem:** The current score entry flow assumes every judge uses a phone or tablet at the table. At many feiseanna, judges use paper score sheets — that's the established norm. Some judges have done this for 30 years and aren't changing. One resistant judge or one strict organizer kills adoption. The entire pipeline stalls at step one.

**Why this is P1:** The question is not "what is the coolest product improvement?" — it's "what makes a real local feis say yes fastest?" A tabulator mode means you can walk in and say: "Your judges don't need to change anything. We'll digitize the scoring and results side." That is the single biggest reduction in rollout friction.

**Fix:** Add a tabulator/organizer score entry page on the dashboard where an operator can transcribe paper score sheets into the system on a judge's behalf. This is the same `score_entries` table, the same engine, the same blocker checks — just a second door into the pipeline.

### Schema Changes

Add three columns to `score_entries`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `entered_by_user_id` | `uuid` (FK to `auth.users`) | `null` | Who physically typed the score. `null` = judge self-entry |
| `entry_mode` | `text` CHECK `('judge_self_service', 'tabulator_transcription')` | `'judge_self_service'` | How the score was entered |
| `entered_at` | `timestamptz` | `now()` | When the transcription happened (distinct from `submitted_at` which is the judge's logical submission time) |

**Packet ownership rule:** One judge's scores for one round must have one active entry path. If a tabulator starts entering for Judge Mary on Round 1, Judge Mary cannot also submit scores digitally for the same round. No split-brain. Enforced at the application layer before insert — check if any scores already exist for this judge+round and if so, verify the entry mode matches.

### Tabulator Entry Lifecycle

Tabulator mode preserves the same packet lifecycle as judge self-service:
1. **Enter scores** — Tabulator selects judge, enters scores for each dancer
2. **Complete packet** — All dancers scored, tabulator confirms completeness
3. **Sign off on behalf** — Tabulator signs off the packet (recorded as tabulator sign-off in audit trail, sign-off attributed to the judge in `judge_sign_offs`)
4. **Lock** — Scores locked, same as judge self-service

### Files

- Create migration: `supabase/migrations/009_tabulator_entry.sql` (add columns to `score_entries`)
- Create: `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx` (tabulator entry page)
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx` (tag scores with `entry_mode: 'judge_self_service'`)
- Modify: `src/lib/audit.ts` (add `'sign_off'` and `'tabulate'` to `AuditAction` type)

### Acceptance Criteria

- Tabulator can select a judge from a dropdown and enter scores for all dancers in a competition round
- Scores are written to `score_entries` with `entry_mode = 'tabulator_transcription'` and `entered_by_user_id` set
- Packet ownership is enforced: if scores already exist for a judge+round with a different entry mode, entry is blocked with a clear message
- Tabulator can sign off a completed packet on the judge's behalf
- Sign-off triggers the same downstream flow (all judges signed off → `ready_to_tabulate`)
- Audit trail distinguishes "Judge Mary entered score" from "Organizer Dan entered score on behalf of Judge Mary"
- UI clearly indicates which entry mode is active and who entered what

---

## Gap 2: Competition Advancement Flow (Priority 2)

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

## Gap 3: Error Handling on Scoring/Tabulation (Priority 3)

**Problem:** If Supabase fails mid-tabulation, partial results get written with no rollback and no feedback. Silent failures are poison for trust.

**Fix:**
- Wrap `handleTabulate()`, `handleSignOff()`, `handlePublish()` in try/catch with user-visible error state
- Check `.error` on all Supabase calls in the scoring/tabulation/sign-off paths
- Add error boundaries so React crashes don't white-screen the app
- Fix judge sign-off to use `canTransition()` (closes state machine enforcement gap)

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx` (sign-off error handling + canTransition fix)
- Create: `src/app/error.tsx` (root error boundary)
- Create: `src/app/dashboard/error.tsx` (dashboard error boundary)
- Create: `src/app/judge/error.tsx` (judge error boundary — judges on phones need this too)

**Acceptance criteria:**
- All Supabase responses in the scoring/tabulation flow check `.error`
- User sees a visible error message if any DB call fails
- Tabulation is wrapped in try/catch — partial failure shows error, doesn't silently corrupt
- Judge sign-off uses `canTransition()` before status update
- Root, dashboard, and judge error boundaries catch React rendering failures
- `ScoreEntryForm.handleSave()` wraps `await onSubmit()` in try/catch (fixes latent stuck-saving bug)

---

## Gap 4: Audit Trail Wiring (Priority 4)

**Problem:** `logAudit()` exists with proper types and table, but is called zero times. Phase 1 says "defensible output" — dead code is not a feature.

**Why audit is especially important now:** With two entry modes (judge self-service + tabulator transcription), the audit trail must clearly answer: who entered this score, on whose behalf, and how? Without that, the output is not defensible.

**Fix:** Wire `logAudit()` into the 7 critical actions:
1. Score submission (judge enters/edits a score)
2. Score transcription (tabulator enters a score on behalf of a judge)
3. Sign-off (judge or tabulator locks scores for a round)
4. Status change (competition advances to new state)
5. Tabulation (results calculated)
6. Result publish (results made public)
7. Result unpublish (results pulled back)

**Audit entry attribution fields:**
- `judge_id` — whose score it is
- `user_id` — who performed the action (may differ from judge_id in tabulator mode)
- `entry_mode` — `'judge_self_service'` or `'tabulator_transcription'` (on score-related actions)

**Files:**
- Modify: `src/lib/audit.ts` (add `'sign_off'`, `'tabulate'`, `'score_transcribe'` to `AuditAction`)
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` (status change, tabulation, publish)
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx` (score transcription, sign-off)
- Modify: `src/app/dashboard/events/[eventId]/results/page.tsx` (publish/unpublish)
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx` (score submission, sign-off)

**Acceptance criteria:**
- Every critical action writes to `audit_log` with: action type, entity IDs, actor info, entry mode, timestamp
- After running the full workflow (via either entry mode), `audit_log` contains a complete trail
- Audit trail clearly distinguishes self-service vs. transcription entries
- Audit logging failures do not block the primary action (fire-and-forget, console.error on failure)

---

## Gap 5: Dancer Status Handling (Priority 5)

**Problem:** No UI for organizers to mark dancers as scratched, no-show, DNC, or medical. The anomaly engine detects "registered but no scores and no explanation" — but there's no way to provide the explanation. Operators need to update dancer status before/during a competition.

**Fix:** Add dancer status controls on the competition detail page roster. Dropdown or quick-action buttons for common statuses (scratched, no-show, did_not_complete, medical) with optional reason.

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

**Acceptance criteria:**
- Organizer can change a dancer's registration status from the roster view
- Status changes clear the "unexplained no scores" warnings
- Status changes are audit-logged

---

## Gap 6: Tabulation Preview and Approval (Priority 6)

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

## Gap 7: Correction Workflows (Priority 7)

**Problem:** What happens when a score is wrong after sign-off? Currently no path to correct it. Scores are locked, and there's no unlock mechanism.

**Requires:** Reverse transitions in the state machine. Currently `ready_to_tabulate` and `complete_unpublished` cannot transition back to `awaiting_scores`. The state machine must be updated to allow organizer-initiated corrections.

**Fix:** Add an "Unlock for Correction" flow on the competition detail page. Organizer can unlock a judge's scores for a specific round, which:
1. Reverts sign-off for that judge
2. Transitions competition back to `awaiting_scores`
3. Logs the unlock in the audit trail
4. Judge (or tabulator) can then re-enter/edit and re-sign-off

**Files:**
- Modify: `src/lib/competition-states.ts` (add reverse transitions: `ready_to_tabulate → awaiting_scores`, `complete_unpublished → awaiting_scores`)
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`
- Update: `tests/competition-states.test.ts` (test reverse transitions)

**Acceptance criteria:**
- Organizer can unlock a specific judge's scores for correction
- Unlock reverts sign-off and transitions state back appropriately
- Unlock is audit-logged with reason
- Judge (or tabulator) can re-edit and re-sign-off
- Previously computed results are cleared if scores change
- State machine tests cover the new reverse transitions

---

## Gap 8: Score Entry Responsiveness (Priority 8)

**Problem:** Score entry form is a single horizontal `flex` row with no wrapping. On a 375px phone screen, elements overflow or compress to unusable sizes. Judges who do use phones at the table cannot enter scores.

**Fix:** Add responsive breakpoints to `score-entry-form.tsx` so it stacks properly on narrow screens. Increase touch target sizes for mobile.

**Files:**
- Modify: `src/components/score-entry-form.tsx`

**Acceptance criteria:**
- Score entry form is usable on a 375px-wide phone screen
- Inputs stack vertically on narrow screens
- Touch targets are large enough for reliable tapping (minimum 44px)

---

## Priority Order

1. **Tabulator score entry mode** — the adoption bridge; lets organizers say "your judges don't need to change anything"
2. **Competition advancement flow** — unblocks the operator workflow end-to-end
3. **Error handling / failure safety** — prevents silent corruption, no white screens
4. **Audit trail wiring** — defensible output with clear attribution across both entry modes
5. **Dancer status handling** — closes the "unexplained no scores" loop
6. **Tabulation preview and approval** — review before commit, not after
7. **Correction workflows** — "oops" has a path that doesn't break everything
8. **Score entry responsiveness** — judges who use phones can actually use them (no longer the adoption lifeline since tabulator mode exists)
