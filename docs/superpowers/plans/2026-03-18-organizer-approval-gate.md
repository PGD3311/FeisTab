# Organizer Approval Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make result publication a deliberate, named, auditable ceremony with checklist acknowledgment and reason-required unpublish.

**Architecture:** Add 4 governance columns to `competitions` via migration. Build two reusable dialog components (`ApprovalDialog`, `UnpublishDialog`). Wire them into both publish entry points (competition detail page + results hub). Update audit formatters for richer payloads.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase, shadcn/ui Dialog, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-18-organizer-approval-gate.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/015_approval_gate.sql` | Create | Add 4 columns to competitions |
| `src/lib/unpublish-reasons.ts` | Create | Shared reason constants + validation set |
| `src/components/approval-dialog.tsx` | Create | Publish approval modal (name + checklist) |
| `src/components/unpublish-dialog.tsx` | Create | Unpublish reason modal (name + reason + note) |
| `src/lib/audit-format.ts` | Modify | Enrich result_publish/result_unpublish formatters |
| `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Modify | Wire ApprovalDialog, add unpublish button + UnpublishDialog |
| `src/app/dashboard/events/[eventId]/results/page.tsx` | Modify | Wire both dialogs, add audit logging + anomaly check |

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/015_approval_gate.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Organizer approval gate: governance metadata for publish/unpublish ceremonies
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS approved_by text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unpublished_by text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unpublished_at timestamptz DEFAULT NULL;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/015_approval_gate.sql
git commit -m "feat: add approval gate columns to competitions"
```

---

### Task 2: Unpublish Reasons Constant

**Files:**
- Create: `src/lib/unpublish-reasons.ts`

- [ ] **Step 1: Create the shared constant file**

```typescript
export const UNPUBLISH_REASONS = [
  { value: 'score_correction_needed', label: 'Score correction needed' },
  { value: 'wrong_competition_published', label: 'Wrong competition published' },
  { value: 'premature_publish', label: 'Premature publish' },
  { value: 'other', label: 'Other' },
] as const

export type UnpublishReason = (typeof UNPUBLISH_REASONS)[number]['value']

export const VALID_UNPUBLISH_REASON_VALUES = new Set(
  UNPUBLISH_REASONS.map((r) => r.value)
)
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (no consumers yet, just verifying the file compiles)

- [ ] **Step 3: Commit**

```bash
git add src/lib/unpublish-reasons.ts
git commit -m "feat: add unpublish reason constants"
```

---

### Task 3: Approval Dialog Component

**Files:**
- Create: `src/components/approval-dialog.tsx`

- [ ] **Step 1: Build the ApprovalDialog component**

Props:
- `open: boolean`
- `onOpenChange: (open: boolean) => void`
- `compCode: string` — competition code for subtitle
- `compName: string` — competition name for subtitle
- `onApprove: (approvedBy: string, checks: { reviewed_preview: boolean; judge_signoffs_complete: boolean; anomalies_reviewed: boolean }) => void`

Component structure:
- Uses `Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogFooter` from `@/components/ui/dialog`
- State: `approvedBy` (string), 3 checkbox booleans
- "Approved by" text input — required, trimmed
- 3 checkboxes with labels (use raw `<input type="checkbox" />` — no shadcn checkbox component exists)
- "Approve & Publish" button — disabled until name entered (trimmed non-empty) + all 3 checked
- Cancel via DialogClose
- On submit: calls `onApprove(approvedBy.trim(), { reviewed_preview, judge_signoffs_complete, anomalies_reviewed })`, then resets state

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/approval-dialog.tsx
git commit -m "feat: add ApprovalDialog component"
```

---

### Task 4: Unpublish Dialog Component

**Files:**
- Create: `src/components/unpublish-dialog.tsx`

- [ ] **Step 1: Build the UnpublishDialog component**

Props:
- `open: boolean`
- `onOpenChange: (open: boolean) => void`
- `compCode: string`
- `compName: string`
- `onUnpublish: (unpublishedBy: string, reason: string, note: string | null) => void`

Component structure:
- Uses same Dialog components as ApprovalDialog
- Warning text: "Published results will be removed from the public page. Parents and teachers may have already seen them."
- Reason dropdown using `UNPUBLISH_REASONS` from `@/lib/unpublish-reasons`
- If reason === 'other': show required note textarea
- "Unpublished by" text input — required, trimmed
- "Unpublish Results" button — disabled until reason selected + name entered (+ note if other)
- On submit: calls `onUnpublish(unpublishedBy.trim(), reason, note?.trim() || null)`, resets state

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/unpublish-dialog.tsx
git commit -m "feat: add UnpublishDialog component"
```

---

### Task 5: Update Audit Formatters

**Files:**
- Modify: `src/lib/audit-format.ts:169-175`
- Modify: `tests/audit-format.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for enriched formatters. Use the existing `makeEntry(overrides: Partial<AuditEntry>)` helper and `names` variable:

```typescript
it('formats result_publish with approver', () => {
  const entry = makeEntry({
    action: 'result_publish',
    after_data: {
      approved_by: 'Bridget',
      checks: { reviewed_preview: true, judge_signoffs_complete: true, anomalies_reviewed: true },
    },
  })
  const result = formatAuditEntry(entry, names)
  expect(result.summary).toContain('Bridget')
  expect(result.summary).toContain('published')
})

it('formats result_publish without approver (legacy)', () => {
  const entry = makeEntry({ action: 'result_publish', after_data: { published_at: '2026-03-18' } })
  const result = formatAuditEntry(entry, names)
  expect(result.summary).toBe('Results published')
})

it('formats result_unpublish with reason', () => {
  const entry = makeEntry({
    action: 'result_unpublish',
    after_data: { unpublished_by: 'Bridget', reason: 'score_correction_needed', note: null },
  })
  const result = formatAuditEntry(entry, names)
  expect(result.summary).toContain('Score correction needed')
})

it('formats result_unpublish with other reason and note', () => {
  const entry = makeEntry({
    action: 'result_unpublish',
    after_data: { unpublished_by: 'Bridget', reason: 'other', note: 'Judge 2 was incorrect' },
  })
  const result = formatAuditEntry(entry, names)
  expect(result.summary).toContain('Judge 2 was incorrect')
})

it('formats result_unpublish with null after_data', () => {
  const entry = makeEntry({ action: 'result_unpublish', after_data: null })
  const result = formatAuditEntry(entry, names)
  expect(result.summary).toBe('Results unpublished')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/audit-format.test.ts`
Expected: FAIL (formatters still return generic strings)

- [ ] **Step 3: Update formatters**

In `src/lib/audit-format.ts`, update the `result_publish` formatter (around line 169). The `Formatter` type is `(entry: AuditEntry, names: NameMaps) => { summary: string; actor: string }` — extract `after_data` from `entry`:

```typescript
result_publish(entry) {
  const d = entry.after_data
  const approver = d?.approved_by ? String(d.approved_by) : null
  return {
    summary: approver ? `Results published — approved by ${approver}` : 'Results published',
    actor: approver ?? 'Organizer',
  }
},
```

Update the `result_unpublish` formatter (around line 173):

```typescript
result_unpublish(entry) {
  const d = entry.after_data
  const who = d?.unpublished_by ? String(d.unpublished_by) : null
  const reason = d?.reason ? String(d.reason) : null
  const note = d?.note ? String(d.note) : null
  const reasonLabel = reason === 'other' && note
    ? note
    : UNPUBLISH_REASONS.find(r => r.value === reason)?.label ?? reason
  return {
    summary: reasonLabel ? `Results unpublished — ${reasonLabel}` : 'Results unpublished',
    actor: who ?? 'Organizer',
  }
},
```

Import `UNPUBLISH_REASONS` from `@/lib/unpublish-reasons` at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/audit-format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit-format.ts tests/audit-format.test.ts
git commit -m "feat: enrich audit formatters for approval/unpublish"
```

---

### Task 6: Wire Dialogs into Competition Detail Page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

- [ ] **Step 1: Add state and imports**

Add imports:
```typescript
import { ApprovalDialog } from '@/components/approval-dialog'
import { UnpublishDialog } from '@/components/unpublish-dialog'
```

Add state:
```typescript
const [showApprovalDialog, setShowApprovalDialog] = useState(false)
const [showUnpublishDialog, setShowUnpublishDialog] = useState(false)
```

- [ ] **Step 2: Refactor handlePublish to accept approval metadata**

Update `handlePublish` (line 417) to accept and use approval data:

```typescript
async function handlePublish(approvedBy: string, checks: Record<string, boolean>) {
  if (!comp) return
  if (anomalies.some(a => a.blocking)) {
    showError('Cannot publish with unresolved anomaly blockers')
    return
  }
  const currentStatus = comp.status as CompetitionStatus
  if (!canTransition(currentStatus, 'published')) return

  try {
    const now = new Date().toISOString()
    // Update results first, then competition status (preserving existing order —
    // results without status change is a less broken state than status without results)
    const { error: pubErr } = await supabase
      .from('results')
      .update({ published_at: now })
      .eq('competition_id', compId)
    if (pubErr) throw pubErr

    const { error: compErr } = await supabase
      .from('competitions')
      .update({
        status: 'published',
        approved_by: approvedBy,
        approved_at: now,
        unpublished_by: null,
        unpublished_at: null,
      })
      .eq('id', compId)
    if (compErr) throw compErr

    void logAudit(supabase, {
      userId: null,
      entityType: 'competition',
      entityId: compId,
      action: 'result_publish',
      afterData: { approved_by: approvedBy, checks, competition_id: compId },
    })
    showSuccess('Results published')
    void reload()
    loadData()
  } catch (err) {
    showCritical('Failed to publish results', { description: err instanceof Error ? err.message : 'Unknown error' })
  }
}
```

- [ ] **Step 3: Replace publish button with dialog trigger**

Replace the current publish button (around line 849) with:

```tsx
{showPublish && (
  <Button
    onClick={() => setShowApprovalDialog(true)}
    disabled={anomalies.some(a => a.blocking)}
    className="w-full justify-start text-left"
    size="lg"
  >
    {anomalies.some(a => a.blocking)
      ? 'Resolve blockers before publishing'
      : 'Publish Results'}
  </Button>
)}
```

- [ ] **Step 4: Add unpublish button for published competitions**

After the "Results published." text (around line 851), add:

```tsx
{(currentStatus === 'published') && (
  <Button
    onClick={() => setShowUnpublishDialog(true)}
    variant="outline"
    className="w-full justify-start text-left"
    size="lg"
  >
    Unpublish Results
  </Button>
)}
```

- [ ] **Step 5: Add handleUnpublish function**

```typescript
async function handleUnpublish(unpublishedBy: string, reason: string, note: string | null) {
  if (!comp) return
  const currentStatus = comp.status as CompetitionStatus
  if (!canTransition(currentStatus, 'complete_unpublished')) return

  try {
    const now = new Date().toISOString()
    const { error: compErr } = await supabase
      .from('competitions')
      .update({
        status: 'complete_unpublished',
        unpublished_by: unpublishedBy,
        unpublished_at: now,
        approved_by: null,
        approved_at: null,
      })
      .eq('id', compId)
    if (compErr) throw compErr

    const { error: pubErr } = await supabase
      .from('results')
      .update({ published_at: null })
      .eq('competition_id', compId)
    if (pubErr) throw pubErr

    void logAudit(supabase, {
      userId: null,
      entityType: 'competition',
      entityId: compId,
      action: 'result_unpublish',
      afterData: { unpublished_by: unpublishedBy, reason, note, competition_id: compId },
    })
    showSuccess('Results unpublished')
    void reload()
    loadData()
  } catch (err) {
    showCritical('Failed to unpublish results', { description: err instanceof Error ? err.message : 'Unknown error' })
  }
}
```

- [ ] **Step 6: Render both dialogs at the end of the component**

Add before the closing `</div>`:

```tsx
<ApprovalDialog
  open={showApprovalDialog}
  onOpenChange={setShowApprovalDialog}
  compCode={comp?.code ?? ''}
  compName={comp?.name ?? ''}
  onApprove={handlePublish}
/>
<UnpublishDialog
  open={showUnpublishDialog}
  onOpenChange={setShowUnpublishDialog}
  compCode={comp?.code ?? ''}
  compName={comp?.name ?? ''}
  onUnpublish={handleUnpublish}
/>
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx
git commit -m "feat: wire approval/unpublish dialogs into competition detail page"
```

---

### Task 7: Wire Dialogs into Results Hub Page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/results/page.tsx`

- [ ] **Step 1: Add imports and state**

```typescript
import { logAudit } from '@/lib/audit'
import { ApprovalDialog } from '@/components/approval-dialog'
import { UnpublishDialog } from '@/components/unpublish-dialog'
```

Add state for which competition is being approved/unpublished:
```typescript
const [approvalTarget, setApprovalTarget] = useState<{ id: string; code: string; name: string; status: string } | null>(null)
const [unpublishTarget, setUnpublishTarget] = useState<{ id: string; code: string; name: string; status: string } | null>(null)
```

- [ ] **Step 2: Refactor handlePublish to accept approval metadata**

Update `handlePublish` signature to: `(compId: string, currentStatus: string, approvedBy: string, checks: Record<string, boolean>)`. The results hub handles multiple competitions so `compId` and `currentStatus` are parameters (unlike the comp detail page which gets them from outer scope). Add the same logic as Task 6: results update first, then competition update with governance fields, then audit log via `logAudit`.

- [ ] **Step 3: Refactor handleUnpublish to accept reason metadata**

Update `handleUnpublish` signature to: `(compId: string, currentStatus: string, unpublishedBy: string, reason: string, note: string | null)`. Same pattern: clear publish fields, set unpublish governance fields, audit log with reason/note.

- [ ] **Step 4: Replace publish/unpublish buttons with dialog triggers**

Replace the direct `onClick` handlers on publish buttons (line 228) with `() => setApprovalTarget(comp)`. Note: the results hub currently has no anomaly blocker check on publish. Since anomaly data is not loaded on this page and loading it per-competition would be expensive, add a note in the UI: the competition detail page is the primary publish path with full anomaly gating. The results hub is a convenience view. If full anomaly gating is needed here later, it can be added as a follow-up.

Replace unpublish buttons (line 241) with `() => setUnpublishTarget(comp)`.

- [ ] **Step 5: Render both dialogs**

Add at end of component:
```tsx
<ApprovalDialog
  open={!!approvalTarget}
  onOpenChange={(open) => !open && setApprovalTarget(null)}
  compCode={approvalTarget?.code ?? ''}
  compName={approvalTarget?.name ?? ''}
  onApprove={(approvedBy, checks) => {
    if (approvalTarget) handlePublish(approvalTarget.id, approvalTarget.status, approvedBy, checks)
    setApprovalTarget(null)
  }}
/>
<UnpublishDialog
  open={!!unpublishTarget}
  onOpenChange={(open) => !open && setUnpublishTarget(null)}
  compCode={unpublishTarget?.code ?? ''}
  compName={unpublishTarget?.name ?? ''}
  onUnpublish={(unpublishedBy, reason, note) => {
    if (unpublishTarget) handleUnpublish(unpublishTarget.id, unpublishTarget.status, unpublishedBy, reason, note)
    setUnpublishTarget(null)
  }}
/>
```

- [ ] **Step 6: Verify build + full test suite**

Run: `npm run build && npm test`
Expected: Both PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/events/[eventId]/results/page.tsx
git commit -m "feat: wire approval/unpublish dialogs into results hub"
```

---

### Task 8: Manual Testing

- [ ] **Step 1: Run through all test cases from spec**

1. Publish with full approval ceremony — verify `approved_by`/`approved_at` set, audit logged, results visible on public page
2. Unpublish with reason — verify governance fields, audit with reason code, results removed from public page
3. Re-publish after unpublish — full ceremony required again
4. Legacy published competition — `approved_at` is null, still shows as published
5. Attempt publish when anomaly blockers exist — modal cannot be opened
6. Unpublish with "Other" reason — note field appears and is required
7. Publish button disabled until all checkboxes checked + name entered
8. Unpublish button disabled until reason selected + name entered

- [ ] **Step 2: Apply migration to Supabase**

Copy and paste `015_approval_gate.sql` contents into Supabase SQL editor and run.

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "fix: approval gate cleanup from manual testing"
```
