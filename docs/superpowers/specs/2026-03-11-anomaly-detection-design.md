# Anomaly Detection Engine — Design Spec

## Problem

The pitch promises "verification checks catch missing data or conflicts" before results are published. Currently the app goes straight from judge sign-off to tabulation to publish with no intermediate check layer. The anomaly detection engine fills that gap.

## Scope

Phase 1 only. Checks are limited to what the current schema supports (score entries, registrations, rounds, judges, competitions, results). Phase 2/3 checks (attendance mismatch, identity verification, stage-flow ordering, timing patterns) are deferred until those data signals exist.

## Workflow Position

Anomaly checks run continuously as scoring data changes, not as a one-time gate.

```
Scores entered
  → anomaly engine runs
  → blockers prevent sign-off
  → sign-off available when blockers clear
  → tabulation available when all signed off + no blockers
  → publish available when results verified + no blockers
```

Warnings and review signals surface alongside blockers but do not prevent workflow progression. The organizer can acknowledge warnings and proceed.

## Anomaly Contract

```ts
type AnomalyType =
  | 'missing_required_score'
  | 'incomplete_judge_packet'
  | 'score_for_non_roster_dancer'
  | 'duplicate_score_entry'
  | 'invalid_scoring_reason'
  | 'recall_mismatch'
  | 'non_reproducible_results'
  | 'unexplained_no_scores'
  | 'large_score_spread'
  | 'judge_flagged_all'
  | 'judge_flat_scores'
  | 'status_score_mismatch'

interface Anomaly {
  type: AnomalyType
  severity: 'blocker' | 'warning' | 'info'
  scope: 'competition' | 'round' | 'judge_packet' | 'dancer'
  entity_ids: Record<string, string>
  message: string
  blocking: boolean
}
```

**`severity`** = display priority (how loud the UI screams).
**`blocking`** = workflow effect (does it gate an action). All blockers block; warnings do not block by default but the fields are independent for future flexibility.

### Required entity_ids per scope

| Scope | Required keys |
|---|---|
| `dancer` | `dancer_id`, `round_id`, `competition_id` |
| `judge_packet` | `judge_id`, `round_id`, `competition_id` |
| `round` | `round_id`, `competition_id` |
| `competition` | `competition_id` |

## Check Pipeline (12 checks, deterministic order)

### Integrity Blockers

**1. `detectDuplicateScoreEntries()`**
Same judge + dancer + round scored more than once. Also enforced at DB level via unique constraint, but engine detection catches legacy data or migration leftovers.

**2. `detectScoresForNonRosterDancers()`**
A score entry exists for a dancer_id that has no registration in the competition. Hard integrity failure.

**3. `detectMissingRequiredScores()`**
A dancer has scores from some judges but not all judges assigned to the round. Scope: dancer. This is the competitor-level view of incomplete data.

**4. `detectIncompleteJudgePackets()`**
A judge has not scored all registered dancers for the round. Scope: judge_packet. This is the packet-level view — the parent to check #3. Both surface in the UI but at different zoom levels (packet queue vs tabulation matrix).

### Rules Blockers

**5. `detectInvalidScoringReason()`**
Score = 0 or flagged = true, but no valid `flag_reason` is set. A zero or flag without explanation is ambiguous — it could be a penalty, a did-not-complete, or a data entry error. The system requires an explicit reason.

**6. `detectRecallMismatch()`**
The generated recall list count does not match the configured `recall_top_percent` rule for the round. Scope: round (recalls are per-round, not per-competition).

**7. `detectNonReproducibleResults()`**
Re-running `tabulate()` on the stored score_entries with the frozen rules snapshot does not produce the same results as stored in the results table. The `calculated_payload` on results will store the `RuleSetConfig` used at tabulation time. This check compares against that snapshot, not current config.

### Warnings

**8. `detectUnexplainedNoScores()`**
A registered dancer has zero score entries and no `status_reason` on their registration. If the dancer is marked withdrawn/absent/etc., the absence is explained. If not, it's suspicious.

**9. `detectStatusScoreMismatch()`**
A dancer is marked withdrawn/absent/disqualified but has score entries, or a dancer has scores but is marked as not having competed. Only buildable after the `status_reason` column is added to registrations.

### Review Signals (info)

**10. `detectLargeScoreSpread()`**
Cross-judge variance for a dancer exceeds a configurable threshold. This is a review signal, not an error. Judges are allowed to disagree. In five-judge systems, high/low dropping exists because spread is expected.

**11. `detectJudgeFlaggedAll()`**
A judge flagged every single dancer in the round. Likely a UI mistake or packet-mode error.

**12. `detectJudgeFlatScores()`**
A judge gave the identical score to every dancer. On small rounds this can happen legitimately, so severity is info, blocking is false.

## Architecture

```
src/lib/engine/anomalies/
  types.ts                          — Anomaly, AnomalyType, AnomalyInput interfaces
  detect-duplicate-entries.ts
  detect-non-roster-scores.ts
  detect-missing-scores.ts
  detect-incomplete-packets.ts
  detect-invalid-scoring-reason.ts
  detect-recall-mismatch.ts
  detect-non-reproducible.ts
  detect-unexplained-no-scores.ts
  detect-status-score-mismatch.ts
  detect-score-spread.ts
  detect-judge-flagged-all.ts
  detect-judge-flat-scores.ts
  index.ts                          — detectAnomalies() orchestrator
```

Every detect function is a pure function. No Supabase imports, no React imports, no side effects. The page fetches all required data and passes it into `detectAnomalies()` as a typed input object.

`detectAnomalies()` calls each check in the order listed above, concatenates results, and returns a flat `Anomaly[]`. Order is deterministic.

## Schema Additions

Three small migrations:

### 1. Timestamps on score_entries
```sql
ALTER TABLE score_entries
  ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN updated_at timestamptz DEFAULT now();
```
Unlocks future audit trails and timing pattern detection.

### 2. Structured status_reason on registrations
```sql
ALTER TABLE registrations
  ADD COLUMN status_reason text
  CHECK (status_reason IN (
    'withdrawn', 'absent', 'disqualified',
    'did_not_complete', 'medical', 'admin_hold', 'other'
  ));
```
Enables checks #8 and #9 to distinguish explained absence from suspicious missing data.

### 3. Unique constraint on score_entries
```sql
ALTER TABLE score_entries
  ADD CONSTRAINT unique_score_per_judge_dancer_round
  UNIQUE (round_id, judge_id, dancer_id);
```
Belt-and-suspenders with check #1. DB prevents future duplicates; engine detects legacy ones.

### 4. Frozen rules in results payload
The `calculated_payload` jsonb column on `results` will include the `RuleSetConfig` snapshot used at tabulation time. No schema change needed — just a code change to include it in the upsert.

## UI Placement

In the competition detail page (`[compId]/page.tsx`), anomaly results surface in a panel between the rounds/scores section and the action buttons.

- **Blockers** show as a red list. While any blocker exists, sign-off and tabulation buttons are disabled.
- **Warnings** show as an amber collapsible section. Organizer can review and proceed.
- **Info signals** show as a subtle expandable section for review.

## Testing

Each check gets its own test file in `tests/engine/anomalies/`. Pure input/output tests. Edge cases per check:

- Empty inputs (no scores, no registrations)
- Clean data (no anomalies returned)
- Single anomaly triggered
- Multiple anomalies of same type
- Boundary conditions (e.g., score spread exactly at threshold)

## What This Does NOT Cover (Phase 2/3)

- Attendance/check-in mismatch (no attendance data yet)
- Competitor number/identity verification (no check-in workflow)
- Stage flow / dance order mismatch (no stage logs)
- Score submission timing patterns (timestamps added now, detection logic deferred)
- Judge-to-competition assignment validation (judges are event-level)

These checks plug into the same pipeline architecture when their data signals become available.
