# FeisTab Irish Points Refactor — Design Spec

## Goal

Replace raw-score-average tabulation with Irish Points, the standard scoring system used across all major Irish dance organizations (CLRG, WIDA, NAFC). Add lightweight operational controls: judge sign-off, number release gates, score flagging, and teacher tracking.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scoring method | Irish Points only (replace raw average) | Industry standard across all orgs. Single code path. |
| Judge panel | 1-3 judges (local feis). Drop high/low config preserved for future championship support. | Friend's dad runs local events. |
| Teacher tracking | `teacher_name` text field on dancers | Captures data without building a teacher portal. |
| Number release | `numbers_released` boolean on competitions, default false | Anti-bias control without workflow complexity. Organizer flips when ready. |
| Judge sign-off | `judge_sign_offs` jsonb on rounds, mapping judge_id to timestamp | Prevents premature tabulation. Lightweight. |
| Infractions | `flagged` boolean + `flag_reason` text on score_entries | Covers early start, did not complete, etc. without a separate table. |

## Irish Points Tabulation Engine

### Algorithm

For each round of a competition:

1. **Per judge**: sort dancers by `raw_score` descending → assign ranks
2. **Tied raw scores**: dancers share the same rank (next rank skips). E.g., two dancers tied for 2nd → both rank 2, next dancer is rank 4.
3. **Rank to Irish Points**: lookup table. 1st=100, 2nd=75, 3rd=65, 4th=60, 5th=56, 6th=53, 7th=50, 8th=47, 9th=45, 10th=43... down to 50th=1.
4. **Tied ranks get averaged points**: tie for 2nd/3rd → each gets (75+65)/2 = 70.
5. **Flagged scores**: if `flagged=true`, dancer gets 0 Irish Points from that judge.
6. **Sum** Irish Points across all judges for that round → `round_total`.
7. **Multi-round**: sum `round_total` across rounds → `grand_total`.
8. **Final ranking**: highest `grand_total` = 1st place.
9. **Tie-breaker**: most individual 1st-place rankings across judges; if still tied, most 2nd-place rankings; etc.

### Integer Math

All Irish Points multiplied by 1000 internally. Averaged tied-rank points computed as integer division of (sum_of_points * 1000) / count_of_tied. No floating point comparisons.

### Irish Points Table

Standard table (ranks 1-50):

```
1:100, 2:75, 3:65, 4:60, 5:56, 6:53, 7:50, 8:47, 9:45, 10:43,
11:41, 12:39, 13:38, 14:37, 15:36, 16:35, 17:34, 18:33, 19:32, 20:31,
21:30, 22:29, 23:28, 24:27, 25:26, 26:25, 27:24, 28:23, 29:22, 30:21,
31:20, 32:19, 33:18, 34:17, 35:16, 36:15, 37:14, 38:13, 39:12, 40:11,
41:10, 42:9, 43:8, 44:7, 45:6, 46:5, 47:4, 48:3, 49:2, 50:1
```

Ranks beyond 50 get 0 points (extended Irish Points deferred to future).

### Drop High/Low (Future)

Config fields `drop_high` and `drop_low` remain in `RuleSetConfig` but default to `false`. When enabled (championship mode with 5+ judges), the highest and lowest Irish Points per dancer per round are dropped before summing. Not implemented in this phase — config is preserved so the engine interface doesn't change later.

## Schema Changes

### New columns

```sql
ALTER TABLE dancers ADD COLUMN teacher_name text;
ALTER TABLE score_entries ADD COLUMN flagged boolean NOT NULL DEFAULT false;
ALTER TABLE score_entries ADD COLUMN flag_reason text;
ALTER TABLE competitions ADD COLUMN numbers_released boolean NOT NULL DEFAULT false;
ALTER TABLE rounds ADD COLUMN judge_sign_offs jsonb NOT NULL DEFAULT '{}'::jsonb;
```

### Updated rule_sets default config

```json
{
  "score_min": 0,
  "score_max": 100,
  "scoring_method": "irish_points",
  "tie_breaker": "countback",
  "recall_top_percent": 50,
  "drop_high": false,
  "drop_low": false
}
```

Changes from current:
- `scoring_method`: `raw_score_average` → `irish_points`
- `tie_breaker`: `highest_individual` → `countback` (most 1st places, then most 2nd places, etc.)
- `recall_top_n` → `recall_top_percent` (50% is the standard recall rule)
- `aggregation` field removed (Irish Points are always summed)

## Engine File Changes

### `src/lib/engine/tabulate.ts`

- Remove `average_score` from `TabulationResult`
- Add `total_points: number` to `TabulationResult`
- Add `individual_ranks: { judge_id: string, rank: number, irish_points: number }[]` to `TabulationResult`
- New function: `rankByJudge(scores: ScoreInput[]): Map<string, { dancer_id: string, rank: number, irish_points: number }[]>`
- New function: `irishPointsForRank(rank: number): number` — lookup table
- New function: `resolveCountbackTie(a: TabulationResult, b: TabulationResult): number`
- Update `tabulate()` to use Irish Points pipeline
- Add `flagged` to `ScoreInput` interface

### `src/lib/engine/rules.ts`

- Update `RuleSetConfig` interface to match new config shape
- Remove `aggregation` field
- Add `scoring_method`, `recall_top_percent`

### `src/lib/engine/recalls.ts`

- Update to use `recall_top_percent` instead of `recall_top_n`
- Calculate recall count as `ceil(total_dancers * recall_top_percent / 100)`
- Keep tie-bubble expansion logic

## UI Changes

### Score entry form (`src/components/score-entry-form.tsx`)
- Add flag checkbox
- When flagged, show reason dropdown (Early Start, Did Not Complete, Other)
- Flagged scores visually distinct (strikethrough or red border)

### Judge scoring page (`src/app/dashboard/judge/[eventId]/[compId]/page.tsx`)
- Add "Sign Off Round" button at bottom
- After sign-off, scores become read-only for that judge
- Show sign-off status per judge

### Competition detail page (`src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`)
- Add "Release Numbers" toggle in header area
- Tabulate button disabled until all assigned judges have signed off
- Results display shows Irish Points totals, not raw averages

### Registration page (`src/app/dashboard/events/[eventId]/register/page.tsx`)
- Add teacher name field

### Results table (`src/components/results-table.tsx`)
- Show Irish Points total instead of average score
- Column header: "Points" not "Score"

### Public results (`src/app/results/[eventId]/page.tsx`)
- Show Irish Points totals

## What Gets Removed

- `scoring_method: 'raw_score_average'` concept
- `average_score` field from TabulationResult
- `highest_individual` tie-breaker logic
- `aggregation` field from RuleSetConfig
- Raw average calculation in `tabulate()`

## What Stays

- Competition state machine (unchanged)
- CSV import pipeline (unchanged)
- Audit logging (unchanged)
- All routes and navigation (unchanged)
- Irish design system (unchanged)
- Integer math approach (kept, applied to Irish Points)

## Tests

Update all engine tests to verify Irish Points:
- Single judge: rank order matches raw score order, points assigned correctly
- Multi-judge (2-3): Irish Points summed, correct final ranking
- Tied raw scores: averaged Irish Points assigned
- Flagged score: 0 points for that judge
- Countback tie-breaker: most 1st places wins
- Recall at 50% with tie-bubble expansion
- Edge case: all dancers tied for a judge (all get same points)
