# Organizer Approval Gate

**Date:** 2026-03-18
**Goal:** Make result publication a deliberate, named, auditable ceremony — not a casual button click. Require a named approver and checklist acknowledgment before results go public, and a named reason before results are pulled.

---

## Why This Matters

Post-2022-scandal context: organizers must be able to defend when results were published, who approved them, and why results were pulled if unpublished. A bare "Publish" button creates no governance trail. This feature adds the minimum ceremony needed for defensible results without slowing down operations.

---

## Data Model

### Migration

Add 4 columns to `competitions`:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `approved_by` | `text` | `null` | Name of person who most recently approved publish |
| `approved_at` | `timestamptz` | `null` | When results were most recently approved for publish |
| `unpublished_by` | `text` | `null` | Name of person who most recently unpublished |
| `unpublished_at` | `timestamptz` | `null` | When results were most recently unpublished |

These fields represent the latest approval/unpublish state only. Full history lives in the audit log.

### State Logic

- **Published** = `status === 'published'`. Status is the source of truth.
- Approval fields record the governance ceremony, not the state itself.
- Legacy competitions published before this feature may have `approved_at = null` — treat them as pre-approval-era, not invalid. The organizer UI should omit approval metadata when null rather than showing empty/broken fields.
- **On publish:** set `approved_by`, `approved_at`; clear `unpublished_by`, `unpublished_at`.
- **On unpublish:** set `unpublished_by`, `unpublished_at`; clear `approved_by`, `approved_at`. Required reason stored in audit log.
- **On re-publish:** full approval ceremony again, fresh `approved_by`/`approved_at`.

---

## Publish Approval Modal

### Component: `ApprovalDialog`

New reusable dialog component used by both publish entry points.

### Trigger

Replaces the current direct "Publish Results" button. The button that opens the modal still respects the existing anomaly blocker check — if blockers exist, the button stays disabled with "Resolve blockers before publishing" text. The modal is only reachable when blockers are clear.

### Modal Contents

1. **Title:** "Approve & Publish Results"
2. **Subtitle:** competition code + name
3. **Text field:** "Approved by" — required, no empty/whitespace
4. **3 required checkboxes:**
   - "I reviewed the results preview"
   - "All judge sign-offs are complete"
   - "Any anomalies or warnings were reviewed"
5. **Button:** "Approve & Publish" — disabled until name entered + all 3 boxes checked
6. **Cancel:** standard dialog close

### On Submit

1. Validate `canTransition()` — reject if transition is invalid
2. Trim `approved_by` — whitespace-only is invalid, save trimmed value only
3. Update competition governance fields and publish-state fields as one logical operation: set `approved_by`, `approved_at`; clear `unpublished_by`, `unpublished_at`; update status to `published`
4. Update results publication fields (`results.published_at`)
5. Audit log with action `result_publish`:
   ```json
   {
     "approved_by": "Bridget",
     "checks": {
       "reviewed_preview": true,
       "judge_signoffs_complete": true,
       "anomalies_reviewed": true
     }
   }
   ```
6. Toast: "Results published"
7. Call `reload()` on event context to refresh dashboard state immediately

---

## Unpublish Reason Modal

### Component: `UnpublishDialog`

New dialog component used by both unpublish entry points.

### Modal Contents

1. **Title:** "Unpublish Results"
2. **Subtitle:** competition code + name
3. **Warning text:** "Published results will be removed from the public page. Parents and teachers may have already seen them."
4. **Required reason dropdown** (stable internal codes):
   - `score_correction_needed` — "Score correction needed"
   - `wrong_competition_published` — "Wrong competition published"
   - `premature_publish` — "Premature publish"
   - `other` — "Other"
5. **If "Other" selected:** required free-text note field
6. **Text field:** "Unpublished by" — required, no empty/whitespace
7. **Button:** "Unpublish Results" — disabled until reason selected + name entered (+ note if Other)

### Shared Constants

```ts
// src/lib/unpublish-reasons.ts
export const UNPUBLISH_REASONS = [
  { value: 'score_correction_needed', label: 'Score correction needed' },
  { value: 'wrong_competition_published', label: 'Wrong competition published' },
  { value: 'premature_publish', label: 'Premature publish' },
  { value: 'other', label: 'Other' },
] as const

export type UnpublishReason = (typeof UNPUBLISH_REASONS)[number]['value']

export const VALID_UNPUBLISH_REASON_VALUES = new Set(UNPUBLISH_REASONS.map(r => r.value))
```

Same pattern as `src/lib/engine/flag-reasons.ts` — shared constant drives both the UI dropdown and audit payload validation.

### On Submit

1. Validate `canTransition()` — reject if transition is invalid
2. Trim `unpublished_by` — whitespace-only is invalid, save trimmed value only
3. Update competition governance fields and unpublish-state fields as one logical operation: set `unpublished_by`, `unpublished_at`; clear `approved_by`, `approved_at`; update status to `complete_unpublished`
4. Clear results publication fields (`results.published_at = null`)
5. Audit log with action `result_unpublish`:
   ```json
   {
     "unpublished_by": "Bridget",
     "reason": "score_correction_needed",
     "note": null
   }
   ```
6. Toast: "Results unpublished"
7. Call `reload()` on event context

---

## Integration Points

### Both publish paths updated

- **Competition detail page** (`[compId]/page.tsx`) — "Publish Results" button opens `ApprovalDialog`. Add an "Unpublish" button (currently missing) when `status === 'published'` that opens `UnpublishDialog`.
- **Results hub page** (`results/page.tsx`) — "Publish" button opens `ApprovalDialog`. "Unpublish" button opens `UnpublishDialog`. Add audit logging to publish/unpublish handlers (currently missing from results hub).

Approval/unpublish dialogs are orchestration-only wrappers around the existing publish/unpublish handlers. They do not bypass existing state-machine or anomaly checks.

### Existing guards preserved

- Anomaly blocker check gates the publish button on both pages — modal is unreachable when blockers exist. The results hub currently lacks this check and must add it.
- `canTransition()` validates state machine transitions inside the handlers

### What doesn't change

- State machine transitions (no new statuses)
- Tabulation flow
- Judge sign-off flow
- Public results page (reads `status === 'published'`, unaware of approval fields)
- Anomaly detection engine

---

## Testing

### Manual test cases

- Publish with full approval ceremony — verify `approved_by`/`approved_at` set, audit logged, results visible on public page
- Unpublish with reason — verify `unpublished_by`/`unpublished_at` set, `approved_by`/`approved_at` cleared, audit logged with reason code, results removed from public page
- Re-publish after unpublish — full ceremony required again, fresh approval metadata
- Legacy published competition — still shows as published, `approved_at` is null (pre-approval-era, not invalid)
- Attempt publish when anomaly blockers exist — verify modal cannot be opened, publish remains blocked
- Unpublish with "Other" reason — verify note field appears and is required
- Publish button disabled until all checkboxes checked + name entered
- Unpublish button disabled until reason selected + name entered

### Audit payload shapes (canonical)

These are the expected `after_data` shapes. Formatters in `audit-format.ts` should handle these explicitly.

**`result_publish`:**
```json
{
  "approved_by": "Bridget",
  "checks": {
    "reviewed_preview": true,
    "judge_signoffs_complete": true,
    "anomalies_reviewed": true
  }
}
```

**`result_unpublish`:**
```json
{
  "unpublished_by": "Bridget",
  "reason": "score_correction_needed",
  "note": null
}
```

### No new engine tests needed

This is a pure UI/workflow ceremony change. The tabulation engine, anomaly detection, and state machine are unaffected.

---

## Key Files

| File | Role |
|------|------|
| `supabase/migrations/015_approval_gate.sql` | Add 4 columns to competitions |
| `src/lib/unpublish-reasons.ts` | Shared reason constants + validation set |
| `src/components/approval-dialog.tsx` | Publish approval modal |
| `src/components/unpublish-dialog.tsx` | Unpublish reason modal |
| `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Wire up dialogs, add unpublish button |
| `src/app/dashboard/events/[eventId]/results/page.tsx` | Wire up dialogs, add audit logging + anomaly check |
| `src/lib/audit-format.ts` | Update `result_publish`/`result_unpublish` formatters for richer payloads |
