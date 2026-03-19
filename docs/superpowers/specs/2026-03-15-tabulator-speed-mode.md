# Tabulator Speed Mode

> **Superseded (2026-03-18):** This spec has been superseded by the Tabulator Speed Optimization spec (`docs/superpowers/specs/2026-03-18-tabulator-speed-optimization.md`), which expands on the keyboard-first approach with batch entry, auto-advance, and additional performance improvements.

**Date:** 2026-03-15
**Goal:** Make tabulator score entry keyboard-first. Type score, hit Enter, advance to next dancer. No mouse required.

---

## Problem

The tabulator sits at a computer typing scores from paper. The current form requires clicking "Save" for each dancer — that means mouse → button → click → mouse → next input → repeat. For 500+ scores in a day, this is a significant speed tax.

---

## Design

### Keyboard Flow

In the tabulator variant of `ScoreEntryForm`:

1. **Focus starts** in the first unsaved dancer's score input on page load
2. **Enter key** in a score input → save that score → on success, move focus to next dancer's score input
3. **Tab key** → same behavior as Enter (save + advance)
4. **Only advance on successful save** — if save fails, keep focus on current row, show error
5. **Mouse remains optional** — everything still works with clicks, but keyboard is the fast path

### What Changes

**`src/components/score-entry-form.tsx` (tabulator variant only):**
- Add `onKeyDown` handler to the score input
- On Enter or Tab: prevent default, trigger save, call `onSaved()` on success
- Add `inputRef` prop or `autoFocus` prop so the parent can control initial focus
- Add `onSaved` callback (already exists from judge tablet work) — tabulator page uses it to advance focus

**`src/app/dashboard/.../tabulator/page.tsx`:**
- Track which dancer should have focus (`focusDancerId`)
- Initial focus: first dancer without a score
- After save success: advance `focusDancerId` to next unscored dancer
- Pass `autoFocus={reg.dancer_id === focusDancerId}` to each `ScoreEntryForm`
- Active input highlight: the focused row gets a subtle left border or background to show where you are

### Save Feedback in Speed Mode

The save feedback needs to be fast and unambiguous without interrupting the flow:
- **Saving:** Input border turns to a subtle pulse/loading state
- **Saved:** Brief green flash on the row (same as current ✓), focus already moved to next
- **Error:** Red border on input, focus stays, "Retry" on save button. Enter retries.

### What Does NOT Change

- Comments/flag expand behavior (still available via toggle, not in the keyboard fast path)
- Score validation rules
- Packet ownership enforcement
- Sign-off logic
- Judge variant behavior (Enter/Tab behavior only applies to tabulator variant)
- Row layout (names visible inline, existing tabulator layout preserved)

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/components/score-entry-form.tsx` | Add Enter/Tab save + onSaved callback for tabulator variant |
| Modify | `src/app/dashboard/.../tabulator/page.tsx` | Focus tracking, auto-advance, initial focus on first unscored |

Two-file change. No new components, no engine changes.

---

## Testing

No automated tests — keyboard behavior is manually tested.

**Manual test cases:**
1. Tab to first score input on page load → input is focused
2. Type score, press Enter → saves, focus moves to next dancer
3. Type score, press Tab → same as Enter
4. Save fails → focus stays on current row, error shown, Enter retries
5. Score all dancers → no more advance (focus stays on last)
6. Comments/flag still accessible via expand toggle
7. Judge variant is NOT affected (no Enter/Tab auto-save on judge page)
8. Mouse clicking Save still works as before

---

## Acceptance Criteria

1. Enter key in score input saves and advances to next dancer
2. Tab key does the same
3. Focus starts on first unscored dancer on page load
4. Failed save keeps focus on current row
5. Judge variant is unaffected
6. Mouse-based flow continues to work
7. Active row has visible focus indicator
