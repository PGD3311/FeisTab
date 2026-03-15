# Judge Tablet Polish

**Date:** 2026-03-15
**Goal:** Make the judge scoring page feel like a digital score sheet, not an app. Number-first, zero cognitive drag, tap-score-move-on.

---

## Problem

The current judge scoring page works but feels like software. The judge's real workflow is: see the number → enter the score → move on. The current UI clutters every row with names, flag checkboxes, comment toggles, badges, and state labels. On a tablet at stageside, this creates cognitive drag — the judge has to process UI chrome instead of just scoring.

---

## Design Principle

**The judge should mostly interact with numbers, not with UI chrome.**

The screen should answer only:
1. What competition am I scoring?
2. Which number is in front of me?
3. What score did I just enter?
4. What's next?

---

## Design

### Page Header

**Current:** Card with competition name, badges ("3/5 scored", "Heat 1 of 2"), "Scoring as" label.

**New:** Single compact bar. No card wrapper.

```
B101  Beginner Reel                    Heat 1 · 2 of 5 scored
```

- Competition code in monospace, muted green
- Competition name in semibold
- Heat + progress on the right, small text
- No "Scoring as" label (judge already knows who they are — they logged in)
- Green bottom border as separator

### Score Rows — Number-First

**Current:** Each row shows: `[number] [full name] [score input] [flag checkbox] [Save] [Comments ▾]`

**New:** Each row shows only: `[NUMBER]  [score input]  [Save]`

- **Competitor number** is the dominant element: 28-32px monospace bold, right-aligned, green
- **Score input:** Large (24px font, 48px height minimum), monospace, centered
- **Save button:** Large (48px height), fills remaining width
- **No name, no flag, no comments** in the default row view

### Row States

| State | Visual |
|-------|--------|
| **Current** (next to score) | Green left border, light green background, score input has green border, Save button active |
| **Scored** | Dimmed (opacity 50%), score shown in green-tinted background, small ✓ indicator |
| **Upcoming** | Number dimmed, score input has light border, Save button hidden or disabled |
| **Scratched/No-show** | Number struck through, muted, status label, no score input |

"Current" = the first unscored dancer. Auto-advances after saving.

### Expanded Row (tap to open)

Tapping a row expands it to reveal:
- **Dancer name** (first + last) — secondary text below the number
- **Comment chips** (same expandable UI from ScoreEntryForm)
- **Flag checkbox + reason dropdown**
- **Optional note textarea**

Only one row expanded at a time. Expanding a new row collapses the previous one.

For scored rows: tapping expands to show the name + allows editing score/comments/flag.

### Save Feedback

The save state must be unmistakable:
- **Unsaved:** Score input has neutral border, Save button says "Save"
- **Saving:** Button shows "..." with disabled state
- **Saved:** Brief green flash on the row + ✓ checkmark, row dims and auto-collapses after ~1 second
- **Error:** Red border on input, button says "Retry"

After a successful save, the next unscored row becomes "Current" automatically.

### Heat Grouping

Keep the existing heat grouping logic, but simplified:
- Current heat: visible, active, green header
- Completed heats: collapsed to a single line ("Heat 1 — Complete ✓")
- Upcoming heats: visible but dimmed

### Sign-Off

When all dancers in all heats are scored:
- Show a prominent sign-off bar at the bottom of the page
- Full-width green button: "Sign Off — All [N] Dancers Scored"
- 48px+ height, impossible to miss

### Competition Confirmed State

After sign-off: same behavior as current (locked message + back to competitions link), but styled cleaner.

---

## Implementation Approach

This is a **rewrite of `ScoreEntryForm` and the judge scoring page's rendering logic**. The component signature stays the same (same props, same `onSubmit`), but the visual output changes significantly.

### What changes

**`src/components/score-entry-form.tsx`:**
- Remove name from default row, show on expand
- Remove flag/comments from default row, show on expand
- Larger number (28-32px), larger score input (24px font, 48px height), larger save button
- Add `isCurrentDancer` prop to control highlight state
- Add `onSaved` callback for auto-advance logic

**`src/app/judge/[eventId]/[compId]/page.tsx`:**
- Simplified header (no card, just a bar)
- Track "current dancer" index (first unscored)
- Pass `isCurrentDancer` to each `ScoreEntryForm`
- Auto-advance current after save
- Completed heats collapse
- Sign-off bar at bottom when all scored
- Single-expand behavior (only one row open at a time)

### What stays the same

- `onSubmit` signature (dancerId, score, flagged, flagReason, commentData)
- All data queries (registrations, scores, rounds, heats)
- Polling behavior
- Packet ownership enforcement
- Sign-off logic
- Comment codes and validation

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/components/score-entry-form.tsx` | Number-first layout, expand for name/comments/flag |
| Modify | `src/app/judge/[eventId]/[compId]/page.tsx` | Simplified header, current-dancer tracking, auto-advance, heat collapse, sign-off bar |

Two-file change. No new components, no engine changes.

**Note:** The tabulator page also uses `ScoreEntryForm`. Changes to the form component need to work for both contexts. The `isCurrentDancer` prop should be optional (tabulator doesn't use it). The tabulator may prefer the denser layout — if the new form is too sparse for tabulator use, consider a `variant` prop (`'judge'` | `'tabulator'`).

---

## Testing

No automated tests — UI polish, manually tested.

**Manual test cases:**
1. Number is the dominant visual element on each row
2. Name is only visible when row is expanded
3. Current dancer is clearly highlighted
4. Saving a score auto-advances to next dancer
5. Scored dancers dim and show ✓
6. Expanding a row shows comments chips + flag + name
7. Only one row expanded at a time
8. Completed heats collapse
9. Sign-off button appears when all scored
10. Tabulator page still works with the updated ScoreEntryForm

---

## Acceptance Criteria

1. Competitor number is the dominant element (28-32px monospace)
2. Names are not visible in the default row — only on expand
3. Flag and comments are not visible in the default row — only on expand
4. Current (next unscored) dancer row is visually highlighted
5. Save feedback is unmistakable (saving/saved/error states)
6. Auto-advance to next dancer after save
7. Completed heats collapse to single line
8. Sign-off button is prominent when all dancers scored
9. Touch targets are ≥48px for all interactive elements
10. Tabulator page continues to work

---

## What This Does NOT Include

- Landscape/portrait mode detection
- Offline support
- Haptic feedback
- Custom judge-level settings
- Reordering dancers
- Session lock / screen-lock prevention
