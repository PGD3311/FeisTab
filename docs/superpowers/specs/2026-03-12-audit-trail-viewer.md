# Audit Trail Viewer

**Date:** 2026-03-12
**Goal:** Make audit data visible and useful to an organizer without turning the page into an engineer dump.
**Truth test questions addressed:** #11 (audit trail viewable), #15 (result explainability)

---

## What We're Building

Two components:

1. **Inline summary panel** on the competition detail page — compact table, last 5 entries, link to full page
2. **Full audit page** at `/dashboard/events/[eventId]/competitions/[compId]/audit` — filterable, all entries, expandable raw data

Both surfaces render the same `audit_log` data with human-readable summaries and optional raw data inspection.

---

## Design Rules

### Audit payload convention (non-negotiable)

All audit events relevant to competition-level inspection **must** include `competition_id` in `after_data` (or `before_data` for deletions), regardless of what `entity_type`/`entity_id` are set to.

This is the query contract. If an audit action omits `competition_id`, it silently disappears from the competition audit view. This convention must be enforced in code reviews and treated as a bug when violated.

Current audit calls that need checking/fixing:
- `sign_off` entries use `entity_id = round.id` — must include `competition_id` in `afterData`
- `score_submit` entries use `entity_id = compId` — already correct
- `score_transcribe` entries use `entity_id = compId` — already correct
- `status_change` entries use `entity_id = compId` — already correct
- Registration `status_change` entries use `entity_id = reg.id` with `entityType: 'registration'` — must include `competition_id` in `afterData` (currently only has `dancer_id`)

### Fallback rules (non-negotiable)

1. **Unknown action type** → show action name as badge text + raw `after_data` key-value pairs + raw data toggle. Page never breaks.
2. **Unresolved actor** → fallback hierarchy: resolved name > role-based label (`Judge`, `Organizer`, `System`) > `Unknown`. No blank cells.
3. **Missing raw payload** → no "View raw data" toggle. Don't show a useless button.
4. **Formatter failure** → catch, show generic fallback. A broken formatter must never break table rendering.

### Time display

- Inline summary: relative time (`2 min ago`) with absolute timestamp in `title` attribute (tooltip on hover)
- Full page: absolute timestamp (`Mar 12, 10:48 AM`)

### Empty states

Both surfaces must have an intentional empty state:
- "No audit entries yet. Entries appear as scores are entered, sign-offs recorded, and actions taken."
- Concise, not alarming.

---

## Data Source

Query strategy for competition-level audit:

```sql
SELECT DISTINCT ON (id) * FROM audit_log
WHERE entity_id = :compId
   OR (after_data->>'competition_id') = :compId
   OR (before_data->>'competition_id') = :compId
ORDER BY id, created_at DESC
```

**Dedup rule:** The same audit row can match multiple branches (e.g., `entity_id = compId` AND `after_data.competition_id = compId`). Query must return unique rows by `id`. In Supabase client code, deduplicate in the application layer if the ORM doesn't support `DISTINCT ON`.

This catches:
- Actions where `entity_id` is the competition (status changes, tabulation, publish, score entries)
- Actions where `entity_id` is a round or other entity but `competition_id` is in the payload (sign-offs)

**Index note:** The existing `idx_audit_log_entity` is a composite index on `(entity_type, entity_id)`. Querying on `entity_id` alone without `entity_type` does not get a clean index seek. The JSON `after_data->>'competition_id'` branch has no index. Both are acceptable at Phase 1 volumes (dozens of entries per competition, not thousands). If performance becomes an issue later, add a top-level `competition_id` column to `audit_log`.

---

## Inline Summary Panel

**Location:** Competition detail page, after Anomaly Checks section, before Corrections section.

**Behavior:**
- Shows last 5 entries, newest first (not hard-locked — easy to bump to 8 later)
- 3 columns: When (relative + tooltip), Action (badge with text label), Details (human-readable summary). Intentionally omits Actor column for compactness — actor info is folded into the summary where relevant.
- "View full audit trail →" link to the full page
- Fetched as part of `loadData()` — single additional query with `LIMIT 5`
- Collapsible card, default open

**Empty state:** "No audit entries yet." with muted styling.

---

## Full Audit Page

**Route:** `src/app/dashboard/events/[eventId]/competitions/[compId]/audit/page.tsx`

**Header:**
- Title: "Audit Trail — {comp.code} {comp.name}"
- Subtitle: "Shows score entry, sign-off, correction, and publish history for this competition."
- Back link: "← Back to Competition"

**Filter:**
- Single dropdown: All actions | Score entries | Sign-offs | Status changes | Corrections | Tabulation | Publish/unpublish | Recalls | Other
- Filter maps to action type groups (see badge table below)
- "Other" captures import, scratch, disqualify, and any unknown action types
- Actions not matching a named filter category are only visible via "All actions" or "Other"

**Table:**
- 4 columns: Time (absolute), Action (badge), Actor, Details
- Newest first
- 25 entries per page, "Load more" button for pagination
- Correction rows: warm background highlight (`bg-orange-50`)
- Publish/unpublish rows: visually distinct badge language (not just color)

**Each row:**
- Default: human-readable summary sentence
- Secondary: "View raw data" toggle (only if payload exists)
- Expanded: formatted JSON block of `before_data` and/or `after_data`, inline

---

## Action Badge Colors & Labels

Badges carry both color AND clear text label. Color alone is not sufficient for meaning.

| Category | Actions | Badge text | Badge color |
|----------|---------|-----------|-------------|
| Score | `score_submit`, `score_transcribe`, `score_edit`* | Score | Blue (`bg-blue-50 text-blue-700`) |
| Sign-off | `sign_off` | Sign-off | Green (`bg-feis-green-light text-feis-green`) |
| Status | `status_change` | Status | Gray (`bg-gray-100 text-gray-600`) |
| Tabulation | `tabulate` | Tabulation | Green |
| Correction | `unlock_for_correction` | Correction | Orange (`bg-orange-50 text-orange-700`) |
| Publish | `result_publish` | Published | Green |
| Unpublish | `result_unpublish` | Unpublished | Gray |
| Recall | `recall_generate` | Recall | Green |
| Import | `import` | Import | Gray |
| Status (dancer) | `scratch`, `disqualify` | Status | Gray |
| Other | `competition_update`, unknown | {action_name} | Gray |

*`score_edit` is not currently emitted — included for forward compatibility. `competition_update` exists in the `AuditAction` type but is not currently emitted.

---

## Formatter Layer

**File:** `src/lib/audit-format.ts`

Pure functions. No Supabase, no React. Takes an audit entry + name lookup maps, returns structured output.

### Interface

```ts
interface AuditEntry {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  created_at: string
}

interface NameMaps {
  judges: Map<string, string>       // judge_id → "First Last"
  dancers: Map<string, string>      // dancer_id → "First Last (#number)"
}

interface FormattedAudit {
  summary: string       // human-readable sentence
  actor: string         // resolved name, role label, or "Unknown"
  badgeText: string     // "Score", "Sign-off", etc.
  badgeColor: string    // tailwind class string
  isCorrection: boolean // highlight flag
  hasRawData: boolean   // show toggle?
}

function formatAuditEntry(entry: AuditEntry, names: NameMaps): FormattedAudit
```

### Actor resolution (Phase 1)

In Phase 1 (no auth), `user_id` is always `null` on all audit entries. Actor is resolved from payload fields instead:

- **Score/sign-off actions:** resolve `after_data.judge_id` via `NameMaps.judges`. If not found, fall back to role label (`"Judge"` for self-service, `"Tabulator"` for transcription).
- **Status/tabulate/publish/correction actions:** literal `"Organizer"` (no user identity to resolve).
- **Auto-triggered status changes:** literal `"System"` (identified by `after_data.trigger` field).
- **Unknown or unresolvable:** literal `"Unknown"`.

When auth is added later, `user_id` becomes the primary resolution path. `NameMaps` can be extended with a `users` map at that point.

### Formatters by action

| Action | Summary format | Actor |
|--------|---------------|-------|
| `score_submit` | "Score: {score} for {dancer} · {entry_mode}" | Judge name or "Judge" |
| `score_transcribe` | "Transcribed {score} for {dancer} · Judge: {judge}" | "Tabulator" |
| `sign_off` | "{judge} signed off · {entry_mode}{all_judges_done ? ' · all judges done' : ''}" | Judge name or "Judge" |
| `status_change` | "{from_label} → {to_label}{trigger ? ' · ' + trigger : ''}" (humanize snake_case to Title Case) | "System" if auto, "Organizer" otherwise |
| `tabulate` | "{result_count} results saved" | "Organizer" |
| `result_publish` | "Results published" | "Organizer" |
| `result_unpublish` | "Results unpublished" | "Organizer" |
| `unlock_for_correction` | "Unlocked {judge} · {reason}{note ? ' · ' + note : ''}" | "Organizer" |
| `recall_generate` | "{recalled_count} dancers recalled" | "Organizer" |
| `import` | "Data imported" | "Organizer" |
| Unknown | "{action}: {key-value pairs from after_data}" | "Unknown" |

**Rule:** Only reference payload fields that actually exist. Don't fake context (e.g., don't say "Round 1" unless `round_number` is in the payload). Be precise based on actual data.

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/lib/audit-format.ts` | Pure formatter functions + types |
| Create | `src/app/dashboard/events/[eventId]/competitions/[compId]/audit/page.tsx` | Full audit page |
| Modify | `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Add inline audit summary panel + audit query |
| Modify | `src/app/judge/[eventId]/[compId]/page.tsx` | Ensure `competition_id` in sign-off audit payload |
| Modify | `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx` | Ensure `competition_id` in sign-off audit payload |
| Modify | `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Ensure `competition_id` in registration status_change audit payload |

---

## Acceptance Criteria

1. Competition detail page shows last 5 audit entries in a compact table with relative timestamps
2. "View full audit trail" link navigates to full audit page
3. Full audit page shows all entries for the competition, newest first, with absolute timestamps
4. Dropdown filter narrows entries by action category
5. Each row shows human-readable summary with action badge (color + text label)
6. Actor column shows resolved name or role fallback — never blank
7. "View raw data" toggle expands to show formatted JSON — only shown when payload exists
8. Correction rows are visually highlighted
9. Unknown action types render gracefully with generic summary + raw data
10. Empty state shown on both surfaces when no entries exist
11. All existing audit calls include `competition_id` in payload (convention enforced)
12. Formatter failures are caught and never break table rendering
13. Audit rows never crash rendering due to malformed payloads; invalid or unexpected payload shapes degrade to generic fallback rendering

---

## What This Does NOT Include

- Event-level audit view (across all competitions)
- User identity resolution (no auth yet)
- Audit log for non-competition entities
- Real-time/live updates (page refresh to see new entries)
