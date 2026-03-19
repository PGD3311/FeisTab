# Save/Error Feedback — Design Spec

> **Status (2026-03-18):** All items in this spec have been implemented.

**Date:** 2026-03-12
**Goal:** Make every user action produce visible, trustworthy feedback. No silent successes. No swallowed errors. No guessing.
**Truth test questions addressed:** #12 (fail safely), #13 (tabulator speed — no hesitation), #14 (judge usability — clear confirmation)

---

## Problem

FeisTab has inconsistent feedback across pages. Some actions show inline errors. Most successes are silent — the page reloads and the user infers what happened. Several critical paths have no error handling at all. One path actively lies (tabulator score save shows "Saved" on failure).

This undermines micro trust: "Did my action succeed right now?" If a tabulator can't tell whether a score saved, the whole trust-layer story falls apart at the first touchpoint.

---

## Design Principles

### Hybrid feedback model

**Toasts for action feedback.** The user just did something and needs immediate confirmation.

**Inline messages for persistent page-state problems.** The issue is part of the current page state and needs to remain visible.

### When to use toasts

- Action completed successfully
- Action failed (recoverable or critical)
- User needs confirmation that something happened

### When to use inline messages

- Page load failure (data is missing or degraded)
- Blockers preventing workflow progression
- Persistent warning about stale or uncertain state
- Entry mode lock ("this judge is locked to tabulator mode")

### What toasts are NOT

Toasts are supplemental feedback. They do not replace inline persistent UI for load failures, blockers, or row-level error states. The helper is for toast policy. Pages still own persistent state handling.

---

## Section 1: Toast Helper

**File:** `src/lib/feedback.ts`

Thin wrapper over sonner's `toast()` function. No React imports. No Supabase imports.

### API

```ts
showSuccess(message: string, options?: { description?: string })
// Duration: 3 seconds. Auto-dismiss. Green checkmark via richColors.
// Use for: action completed, state updated, data saved.

showError(message: string, options?: { description?: string })
// Duration: 8 seconds. Auto-dismiss. Red styling via richColors.
// Use for: action failed, but state is clear and user can retry.

showCritical(message: string, options?: { description?: string })
// Duration: Infinity. Must be manually dismissed. Red styling.
// Use for: action failed and user may be unsure what persisted or what state the system is in.
```

### Severity decision rule

- `showError` = action failed, but state is still clear and user can retry
- `showCritical` = action failed and user may be unsure what persisted or what state the system is in

### Extension policy

The helper is intentionally minimal. It can be extended later for retry actions (`actionLabel` + `onAction` callback) if needed. Do not build that now.

### Toast timing rule

On success, toasts fire only after the relevant local state/UI has been updated successfully, not before. This prevents the classic failure of showing a success toast while the page still displays stale data.

---

## Section 2: Bug Fix — Tabulator Score Save

**File:** `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx`

### Problem

`handleScoreSubmit()` sets page-level `setError(...)` and returns on upsert failure but does not throw. `ScoreEntryForm` only detects failure via thrown errors. Result: form shows "Saved" checkmark while the score was never persisted. This actively lies to the user.

### Fix

1. On upsert `.error`, throw `new Error(...)` instead of returning silently. Match the judge page pattern.
2. Remove `setError()` from the score save path — `ScoreEntryForm` row-level error state is sufficient.
3. Add `showError('Score save failed')` toast on the error path for supplemental notification.

### After fix, both entry paths behave identically

- Judge page: throws on error → ScoreEntryForm shows "Retry" → error toast
- Tabulator page: throws on error → ScoreEntryForm shows "Retry" → error toast

### Toast dedup note

Score save failures get `showError` (not `showCritical`) because the row-level "Retry" state is the primary indicator. Toast is supplemental. Natural rate-limiting via user flow: user clicks Retry → if it fails again, enough time has passed between attempts that a second toast is not obnoxious. No explicit dedup system needed.

---

## Section 3: Global Wiring

### Changes

1. **`src/app/layout.tsx`** — Import and render the existing `<Toaster>` wrapper from `src/components/ui/sonner.tsx`. Single instance covers all routes (dashboard, judge, results).

2. **`src/components/ui/sonner.tsx`** — Strip `useTheme()` and `next-themes` import. Hardcode light theme. The app does not support dark mode; this is dead machinery cleanup. Configure: position `top-right`, `richColors` enabled.

3. **Verify z-index** — Confirm toasts render above sticky headers, modal dialogs, and dashboard chrome. Sonner defaults are usually fine, but verify once.

---

## Section 4: Action Handler Standardization

Every action path gets a toast. Existing inline error states (`actionError`, `advanceError`) are removed where toasts replace them. Missing `.error` checks are added where they don't exist.

### Competition Detail Page (`[compId]/page.tsx`)

| Action | Success | Failure | Tier | Inline Change |
|--------|---------|---------|------|---------------|
| Status advance | `showSuccess('Status updated to {label}')` | `showCritical(...)` | Critical — state machine move | Remove `advanceError` state |
| Approve & Save results | `showSuccess('Results approved and saved')` | `showCritical(...)` | Critical — writes results | Remove from `actionError` |
| Publish results | `showSuccess('Results published')` | `showCritical(...)` | Critical — public visibility | Remove from `actionError` |
| Generate recalls | `showSuccess('Recalls generated')` | `showCritical(...)` | Critical — writes recall state | Remove from `actionError` |
| Unlock for correction | `showSuccess('Unlocked for correction')` | `showCritical(...)` | Critical — invalidates downstream trust state | Remove from `actionError` |
| ~~Release numbers~~ | ~~`showSuccess('Numbers released')` / `showSuccess('Numbers hidden')`~~ | ~~`showError('Failed to release numbers')` / `showError('Failed to hide numbers')`~~ | ~~Error — clear state~~ | **Removed from Phase 1 scope (2026-03-18).** `numbers_released` DB column exists but is unused. Number visibility gating deferred. |
| Registration status | `showSuccess('Dancer status updated')` | `showError('Failed to update status')` | Error — retryable | Remove from `actionError` |
| Preview tabulation | No toast (UI-only state change — sets `previewResults`) | No toast (silently returns if prerequisites missing) | N/A | No change |
| Cancel preview | No toast (clears `previewResults`) | N/A | N/A | No change |

**Net effect:** Both `actionError` and `advanceError` state variables are removed. All action feedback moves to toasts. Page gets simpler. Roster row refresh after registration status change is the real persistent confirmation (already happens via `loadData()`).

**Status advance messages use human-readable labels** from `getTransitionLabel()` — "Ready for Day-Of", not "ready_for_day_of".

### Tabulator Page (`tabulator/page.tsx`)

| Action | Success | Failure | Tier | Inline Change |
|--------|---------|---------|------|---------------|
| Score save | No toast (ScoreEntryForm checkmark sufficient) | `showError('Score save failed')` + row "Retry" | Error | Remove `setError` from save path |
| Sign-off | `showSuccess('Scores signed off for {judge}')` | `showCritical('Sign-off failed')` | Critical — workflow milestone | Keep green "Signed off" card. Replace `setError` on sign-off path with toast. Page-level `error` state and banner remain for load failures only. |

### Judge Page (`judge/[eventId]/[compId]/page.tsx`)

| Action | Success | Failure | Tier | Inline Change |
|--------|---------|---------|------|---------------|
| Score save | No toast (ScoreEntryForm checkmark sufficient) | `showError('Score save failed')` + row "Retry" | Error | No change |
| Sign-off | `showSuccess('Round signed off')` | `showCritical('Sign-off failed')` | Critical — workflow milestone | Keep green card, remove `actionError` |

### Judge Management Page (`judges/page.tsx`)

| Action | Success | Failure | Tier | Inline Change |
|--------|---------|---------|------|---------------|
| Add judge | `showSuccess('Judge added')` | `showError('Failed to add judge')` | Error | Remove inline `error` state |
| Regenerate code | `showSuccess('Access code regenerated')` | `showError('Failed to regenerate code')` | Error | **Add `.error` check** (currently missing) |
| Remove judge | `showSuccess('Judge removed')` | `showError('Failed to remove judge')` | Error | **Add `.error` check** (currently missing) |

### Results Page (`results/page.tsx`)

| Action | Success | Failure | Tier | Inline Change |
|--------|---------|---------|------|---------------|
| Publish | `showSuccess('Results published')` | `showCritical('Failed to publish results')` | Critical — public visibility | **Add `.error` checks** (currently missing entirely) |
| Unpublish | `showSuccess('Results unpublished')` | `showCritical('Failed to unpublish results')` | Critical — public visibility | **Add `.error` checks** (currently missing entirely) |

---

## Section 5: Load Failure Inline Cleanup

Load failures are persistent page-state problems. They get inline treatment, not toasts.

### Severity hierarchy by context

- **Primary load failure** (the competition/event itself) = hard failure UI. Already handled correctly on most pages.
- **Secondary load failures** (roster, scores, judges, rounds, results) = grouped degraded-state banner.
- **Judge page load failure** = operationally blocking — judge cannot work. Prominent block with retry.

### Competition Detail Page

Currently has 5 silent `console.error` calls for secondary loads. Page renders with empty data and no explanation.

**Fix:** If any secondary load fails, show one grouped banner at the top of the page content:

> "Some competition data could not be loaded. Roster, scores, or judge details may be incomplete. Refresh to try again."

One banner, not five per-section messages. Honest without being noisy. This only appears for secondary load failures — primary competition load failure remains a hard page failure with its own UI.

### Judge Page

Silent `console.error` for registrations and scores. Judge sees empty competition with no explanation.

**Fix:** Prominent blocking state. If registrations or scores fail to load, the judge cannot do their job. Show:

> "Could not load competition data. Check your connection and try again."

With a **Retry button** that re-runs `loadData()`. Large touch targets (this is phone territory). This is not a subtle muted message — it's an operational blocker.

### Results Page

`loadData()` has no `.error` check. On failure, page shows "No competitions with results yet" which is misleading — it looks like there are no results when the load actually failed.

**Fix:** Check `error` on the Supabase response. If truthy, show inline message: "Could not load results. Try refreshing." Distinguish between "no results exist" (valid empty state) and "load failed" (error state).

### Event Layout

Silent failure for competition list load. Currently shows empty list.

**Fix:** Show inline message when `compRes.error` is truthy (not when the list is empty — an empty competition list is valid for a new event). Message: "Could not load competitions." Simple, local, no error state threading to child pages.

### Judge Management Page

No load error handling. Empty page on failure.

**Fix:** Inline message where judge list would appear: "Could not load judges. Try refreshing."

### Tabulator Page

Already has a page-level error banner for load failures. No change needed.

### CSV Import Page

Already has explicit error handling. No change needed.

---

## Implementation Order

1. Wire `<Toaster />` globally + clean up sonner component
2. Add toast helper (`src/lib/feedback.ts`)
3. ~~Fix tabulator error-swallow bug (most critical — stops active lying)~~ (Fixed)
4. Standardize action handlers on competition detail page (most actions, highest impact)
5. Standardize tabulator page actions
6. Standardize judge page actions
7. Standardize judge management page (add missing `.error` checks)
8. Standardize results page (add missing `.error` checks)
9. Add load failure inline messages (competition detail, judge, results, layout, judge management)

---

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/feedback.ts` | **New** — toast helper |
| `src/components/ui/sonner.tsx` | Strip `useTheme()`, hardcode light theme |
| `src/app/layout.tsx` | Add `<Toaster />` |
| `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Add toasts, remove `actionError`/`advanceError`, add load failure banner |
| `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx` | Fix error swallow bug, add toasts, clean up error state |
| `src/app/judge/[eventId]/[compId]/page.tsx` | Add toasts, add load failure blocking state with retry |
| `src/app/dashboard/events/[eventId]/judges/page.tsx` | Add toasts, add `.error` checks, add load failure message |
| `src/app/dashboard/events/[eventId]/results/page.tsx` | Add toasts, add `.error` checks |
| `src/app/dashboard/events/[eventId]/layout.tsx` | Add inline failure for competition list load |

---

## What This Does NOT Include

- No toast for load failures (those are persistent inline)
- No retry action buttons in toasts (intentionally deferred)
- No dark mode support (app doesn't use it)
- No per-section load failure messages on competition detail (grouped banner instead)
- No changes to `ScoreEntryForm` component (its existing feedback is already good)
- No changes to CSV import page (already has good feedback)
- No changes to create event page (redirect is adequate success feedback)
- No changes to judge login page (redirect is adequate)
