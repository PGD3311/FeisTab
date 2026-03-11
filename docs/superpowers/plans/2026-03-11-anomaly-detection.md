# Anomaly Detection Engine — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 12-check anomaly detection pipeline that recomputes on page load / data refresh, gates sign-off and tabulation when blockers exist, and surfaces warnings for organizer review.

**Architecture:** Pure engine functions in `src/lib/engine/anomalies/`, one file per check, orchestrated by `detectAnomalies()`. Checks are split into competition-wide (run once) and round-scoped (run per round) to avoid duplicate emissions. Each check takes typed input, returns `Anomaly[]`. No Supabase imports — the page fetches data and passes it in. TDD: tests first, then implementation.

**Detection model:** This is recompute-on-load detection, not true continuous detection. Anomalies recompute when `loadData()` runs (page load, after mutations). True continuous detection (recompute after every score keystroke) is a future enhancement.

**Tech Stack:** TypeScript, Vitest, existing engine types from `src/lib/engine/`

**Spec:** `docs/superpowers/specs/2026-03-11-anomaly-detection-design.md`

---

## Chunk 1: Foundation — Types, Schema, Input Contract

### Task 1: Create anomaly type definitions

**Files:**
- Create: `src/lib/engine/anomalies/types.ts`

- [ ] **Step 1: Create types file**

```ts
// src/lib/engine/anomalies/types.ts

import { type RuleSetConfig } from '../rules'
import { type TabulationResult } from '../tabulate'

export type AnomalyType =
  | 'duplicate_score_entry'
  | 'score_for_non_roster_dancer'
  | 'missing_required_score'
  | 'incomplete_judge_packet'
  | 'invalid_scoring_reason'
  | 'recall_mismatch'
  | 'non_reproducible_results'
  | 'unexplained_no_scores'
  | 'status_score_mismatch'
  | 'large_score_spread'
  | 'judge_flagged_all'
  | 'judge_flat_scores'

export interface Anomaly {
  type: AnomalyType
  severity: 'blocker' | 'warning' | 'info'
  scope: 'competition' | 'round' | 'judge_packet' | 'dancer'
  entity_ids: Record<string, string>
  message: string
  blocking: boolean
  dedupe_key: string  // e.g. 'duplicate_score_entry|r1|j1|d1' — prevents duplicate UI rendering
}

export interface ScoreEntry {
  id: string
  round_id: string
  competition_id: string
  dancer_id: string
  judge_id: string
  raw_score: number
  flagged: boolean
  flag_reason: string | null
}

export type RegistrationStatus =
  | 'registered' | 'checked_in' | 'present' | 'scratched'
  | 'no_show' | 'danced' | 'recalled' | 'disqualified'
  | 'finalized' | 'did_not_complete' | 'medical'

export type StatusReason =
  | 'withdrawn' | 'absent' | 'disqualified' | 'did_not_complete'
  | 'medical' | 'admin_hold' | 'other'

/** Statuses that mean the dancer should NOT have scores */
export const NON_ACTIVE_STATUSES: RegistrationStatus[] = [
  'scratched', 'no_show', 'disqualified', 'did_not_complete', 'medical',
]

export interface Registration {
  id: string
  dancer_id: string
  competition_id: string
  competitor_number: string | null
  status: RegistrationStatus
  status_reason: StatusReason | null  // explanatory code, separate from workflow status
}

export interface Round {
  id: string
  competition_id: string
  round_number: number
  round_type: string
  judge_sign_offs: Record<string, string>
}

export interface StoredResult {
  dancer_id: string
  final_rank: number
  calculated_payload: {
    total_points: number
    individual_ranks: { judge_id: string; rank: number; irish_points: number }[]
    rules_snapshot?: RuleSetConfig
  }
}

export interface AnomalyInput {
  competition_id: string
  scores: ScoreEntry[]
  registrations: Registration[]
  rounds: Round[]
  judge_ids: string[]
  results: StoredResult[]
  rules: RuleSetConfig
  recalls: { dancer_id: string; round_id: string }[]
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/lib/engine/anomalies/types.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/engine/anomalies/types.ts
git commit -m "feat: add anomaly detection type definitions"
```

### Task 2: Schema migration — add updated_at and extend registration status

**Files:**
- Create: `supabase/migrations/005_anomaly_support.sql`

Note: `score_entries` already has `submitted_at` and `unique(round_id, dancer_id, judge_id)`. `registrations.status` already includes `scratched`, `no_show`, `disqualified`. We need: (1) `updated_at` on score_entries for edit tracking, (2) extend status enum with `did_not_complete` and `medical`, (3) add `status_reason` as a separate column from `status` — status is workflow state, status_reason is explanatory exception code.

- [ ] **Step 1: Create migration file**

```sql
-- Anomaly detection support: edit tracking, extended status, status_reason

-- Track score edits for audit trail
ALTER TABLE score_entries
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE TRIGGER score_entries_updated_at
  BEFORE UPDATE ON score_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Extend registration status to cover did_not_complete and medical
ALTER TABLE registrations
  DROP CONSTRAINT IF EXISTS registrations_status_check;

ALTER TABLE registrations
  ADD CONSTRAINT registrations_status_check
  CHECK (status IN (
    'registered', 'checked_in', 'present', 'scratched',
    'no_show', 'danced', 'recalled', 'disqualified', 'finalized',
    'did_not_complete', 'medical'
  ));

-- Separate explanatory reason from workflow status
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS status_reason text
  CHECK (status_reason IS NULL OR status_reason IN (
    'withdrawn', 'absent', 'disqualified',
    'did_not_complete', 'medical', 'admin_hold', 'other'
  ));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/005_anomaly_support.sql
git commit -m "feat: add schema support for anomaly detection"
```

---

## Chunk 2: Integrity Blocker Checks (1–4)

### Task 3: detectDuplicateScoreEntries

**Files:**
- Create: `tests/engine/anomalies/detect-duplicate-entries.test.ts`
- Create: `src/lib/engine/anomalies/detect-duplicate-entries.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-duplicate-entries.test.ts
import { describe, it, expect } from 'vitest'
import { detectDuplicateScoreEntries } from '@/lib/engine/anomalies/detect-duplicate-entries'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const base: ScoreEntry = {
  id: '1', round_id: 'r1', competition_id: 'c1',
  dancer_id: 'd1', judge_id: 'j1', raw_score: 80,
  flagged: false, flag_reason: null,
}

describe('detectDuplicateScoreEntries', () => {
  it('returns empty for no duplicates', () => {
    const scores = [
      { ...base, id: '1', dancer_id: 'd1', judge_id: 'j1' },
      { ...base, id: '2', dancer_id: 'd1', judge_id: 'j2' },
      { ...base, id: '3', dancer_id: 'd2', judge_id: 'j1' },
    ]
    expect(detectDuplicateScoreEntries(scores, 'c1')).toEqual([])
  })

  it('detects duplicate judge+dancer+round', () => {
    const scores = [
      { ...base, id: '1', dancer_id: 'd1', judge_id: 'j1' },
      { ...base, id: '2', dancer_id: 'd1', judge_id: 'j1' },
    ]
    const result = detectDuplicateScoreEntries(scores, 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('duplicate_score_entry')
    expect(result[0].severity).toBe('blocker')
    expect(result[0].blocking).toBe(true)
    expect(result[0].entity_ids.dancer_id).toBe('d1')
    expect(result[0].entity_ids.judge_id).toBe('j1')
  })

  it('returns empty for empty input', () => {
    expect(detectDuplicateScoreEntries([], 'c1')).toEqual([])
  })

  it('detects multiple duplicate groups', () => {
    const scores = [
      { ...base, id: '1', dancer_id: 'd1', judge_id: 'j1' },
      { ...base, id: '2', dancer_id: 'd1', judge_id: 'j1' },
      { ...base, id: '3', dancer_id: 'd2', judge_id: 'j2' },
      { ...base, id: '4', dancer_id: 'd2', judge_id: 'j2' },
    ]
    expect(detectDuplicateScoreEntries(scores, 'c1')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run tests/engine/anomalies/detect-duplicate-entries.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-duplicate-entries.ts
import { type Anomaly, type ScoreEntry } from './types'

export function detectDuplicateScoreEntries(
  scores: ScoreEntry[],
  competition_id: string
): Anomaly[] {
  const seen = new Map<string, ScoreEntry>()
  const anomalies: Anomaly[] = []
  const reported = new Set<string>()

  for (const s of scores) {
    const key = `${s.round_id}|${s.judge_id}|${s.dancer_id}`
    if (seen.has(key) && !reported.has(key)) {
      reported.add(key)
      anomalies.push({
        type: 'duplicate_score_entry',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: {
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          round_id: s.round_id,
          competition_id,
        },
        message: `Duplicate score entry for dancer ${s.dancer_id} by judge ${s.judge_id} in round ${s.round_id}`,
        blocking: true,
        dedupe_key: `duplicate_score_entry|${s.round_id}|${s.judge_id}|${s.dancer_id}`,
      })
    }
    seen.set(key, s)
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run tests/engine/anomalies/detect-duplicate-entries.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-duplicate-entries.ts tests/engine/anomalies/detect-duplicate-entries.test.ts
git commit -m "feat: add duplicate score entry detection"
```

### Task 4: detectScoresForNonRosterDancers

**Files:**
- Create: `tests/engine/anomalies/detect-non-roster-scores.test.ts`
- Create: `src/lib/engine/anomalies/detect-non-roster-scores.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-non-roster-scores.test.ts
import { describe, it, expect } from 'vitest'
import { detectScoresForNonRosterDancers } from '@/lib/engine/anomalies/detect-non-roster-scores'
import { type ScoreEntry, type Registration } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string): ScoreEntry => ({
  id: '1', round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id: 'j1', raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string): Registration => ({
  id: '1', dancer_id, competition_id: 'c1',
  competitor_number: '100', status: 'registered', status_reason: null,
})

describe('detectScoresForNonRosterDancers', () => {
  it('returns empty when all scored dancers are registered', () => {
    expect(detectScoresForNonRosterDancers(
      [score('d1'), score('d2')],
      [reg('d1'), reg('d2')],
      'c1'
    )).toEqual([])
  })

  it('detects score for unregistered dancer', () => {
    const result = detectScoresForNonRosterDancers(
      [score('d1'), score('d999')],
      [reg('d1')],
      'c1'
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('score_for_non_roster_dancer')
    expect(result[0].severity).toBe('blocker')
    expect(result[0].entity_ids.dancer_id).toBe('d999')
  })

  it('returns empty for empty scores', () => {
    expect(detectScoresForNonRosterDancers([], [reg('d1')], 'c1')).toEqual([])
  })

  it('reports each non-roster dancer once', () => {
    const result = detectScoresForNonRosterDancers(
      [score('d999'), { ...score('d999'), id: '2', judge_id: 'j2' }],
      [reg('d1')],
      'c1'
    )
    expect(result).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run tests/engine/anomalies/detect-non-roster-scores.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-non-roster-scores.ts
import { type Anomaly, type ScoreEntry, type Registration } from './types'

export function detectScoresForNonRosterDancers(
  scores: ScoreEntry[],
  registrations: Registration[],
  competition_id: string
): Anomaly[] {
  const registeredDancerIds = new Set(registrations.map(r => r.dancer_id))
  const reported = new Set<string>()
  const anomalies: Anomaly[] = []

  for (const s of scores) {
    if (!registeredDancerIds.has(s.dancer_id) && !reported.has(s.dancer_id)) {
      reported.add(s.dancer_id)
      anomalies.push({
        type: 'score_for_non_roster_dancer',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: {
          dancer_id: s.dancer_id,
          round_id: s.round_id,
          competition_id,
        },
        message: `Score exists for dancer ${s.dancer_id} who is not registered in this competition`,
        blocking: true,
        dedupe_key: `score_for_non_roster_dancer|${s.round_id}|${s.dancer_id}`,
      })
    }
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/engine/anomalies/detect-non-roster-scores.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-non-roster-scores.ts tests/engine/anomalies/detect-non-roster-scores.test.ts
git commit -m "feat: add non-roster dancer score detection"
```

### Task 5: detectMissingRequiredScores

**Files:**
- Create: `tests/engine/anomalies/detect-missing-scores.test.ts`
- Create: `src/lib/engine/anomalies/detect-missing-scores.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-missing-scores.test.ts
import { describe, it, expect } from 'vitest'
import { detectMissingRequiredScores } from '@/lib/engine/anomalies/detect-missing-scores'
import { type ScoreEntry, type Registration } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string, round_id = 'r1'): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id, competition_id: 'c1',
  dancer_id, judge_id, raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string): Registration => ({
  id: dancer_id, dancer_id, competition_id: 'c1',
  competitor_number: '100', status: 'registered', status_reason: null,
})

describe('detectMissingRequiredScores', () => {
  it('returns empty when all dancers have scores from all judges', () => {
    const scores = [
      score('d1', 'j1'), score('d1', 'j2'),
      score('d2', 'j1'), score('d2', 'j2'),
    ]
    expect(detectMissingRequiredScores(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')).toEqual([])
  })

  it('detects dancer scored by some judges but not all', () => {
    const scores = [
      score('d1', 'j1'), score('d1', 'j2'),
      score('d2', 'j1'), // d2 missing j2
    ]
    const result = detectMissingRequiredScores(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('missing_required_score')
    expect(result[0].severity).toBe('blocker')
    expect(result[0].entity_ids.dancer_id).toBe('d2')
  })

  it('ignores dancers with zero scores (handled by other check)', () => {
    const scores = [score('d1', 'j1'), score('d1', 'j2')]
    // d2 has zero scores — not a "missing required" issue, it's an "unexplained no scores" issue
    expect(detectMissingRequiredScores(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')).toEqual([])
  })

  it('returns empty for empty inputs', () => {
    expect(detectMissingRequiredScores([], [], [], 'r1', 'c1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run tests/engine/anomalies/detect-missing-scores.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-missing-scores.ts
import { type Anomaly, type ScoreEntry, type Registration } from './types'

export function detectMissingRequiredScores(
  scores: ScoreEntry[],
  registrations: Registration[],
  judge_ids: string[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  if (judge_ids.length === 0) return []

  const roundScores = scores.filter(s => s.round_id === round_id)
  const anomalies: Anomaly[] = []

  // Build map: dancer_id → set of judge_ids who scored them
  const dancerJudges = new Map<string, Set<string>>()
  for (const s of roundScores) {
    if (!dancerJudges.has(s.dancer_id)) dancerJudges.set(s.dancer_id, new Set())
    dancerJudges.get(s.dancer_id)!.add(s.judge_id)
  }

  // Only check dancers who have at least one score (partially scored)
  const registeredIds = new Set(registrations.map(r => r.dancer_id))
  for (const [dancer_id, judges] of dancerJudges) {
    if (!registeredIds.has(dancer_id)) continue // handled by non-roster check
    if (judges.size > 0 && judges.size < judge_ids.length) {
      const missing = judge_ids.filter(j => !judges.has(j))
      anomalies.push({
        type: 'missing_required_score',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: { dancer_id, round_id, competition_id },
        message: `Dancer ${dancer_id} is missing scores from ${missing.length} judge(s): ${missing.join(', ')}`,
        blocking: true,
        dedupe_key: `missing_required_score|${round_id}|${dancer_id}`,
      })
    }
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/engine/anomalies/detect-missing-scores.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-missing-scores.ts tests/engine/anomalies/detect-missing-scores.test.ts
git commit -m "feat: add missing required score detection"
```

### Task 6: detectIncompleteJudgePackets

**Files:**
- Create: `tests/engine/anomalies/detect-incomplete-packets.test.ts`
- Create: `src/lib/engine/anomalies/detect-incomplete-packets.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-incomplete-packets.test.ts
import { describe, it, expect } from 'vitest'
import { detectIncompleteJudgePackets } from '@/lib/engine/anomalies/detect-incomplete-packets'
import { type ScoreEntry, type Registration } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string): Registration => ({
  id: dancer_id, dancer_id, competition_id: 'c1',
  competitor_number: '100', status: 'registered', status_reason: null,
})

describe('detectIncompleteJudgePackets', () => {
  it('returns empty when all judges scored all dancers', () => {
    const scores = [
      score('d1', 'j1'), score('d1', 'j2'),
      score('d2', 'j1'), score('d2', 'j2'),
    ]
    expect(detectIncompleteJudgePackets(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')).toEqual([])
  })

  it('detects judge who has not scored all dancers', () => {
    const scores = [
      score('d1', 'j1'), score('d1', 'j2'),
      score('d2', 'j1'), // j2 missing d2
    ]
    const result = detectIncompleteJudgePackets(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('incomplete_judge_packet')
    expect(result[0].scope).toBe('judge_packet')
    expect(result[0].entity_ids.judge_id).toBe('j2')
  })

  it('returns empty for empty inputs', () => {
    expect(detectIncompleteJudgePackets([], [], [], 'r1', 'c1')).toEqual([])
  })

  it('detects multiple incomplete judges', () => {
    const scores = [score('d1', 'j1')] // j2 scored nobody
    const result = detectIncompleteJudgePackets(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')
    expect(result).toHaveLength(2) // j1 missing d2, j2 missing both
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run tests/engine/anomalies/detect-incomplete-packets.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-incomplete-packets.ts
import { type Anomaly, type ScoreEntry, type Registration, NON_ACTIVE_STATUSES } from './types'

export function detectIncompleteJudgePackets(
  scores: ScoreEntry[],
  registrations: Registration[],
  judge_ids: string[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  if (judge_ids.length === 0 || registrations.length === 0) return []

  const roundScores = scores.filter(s => s.round_id === round_id)
  // Only count active/score-eligible dancers — exclude scratched, no_show, etc.
  const activeDancerIds = new Set(
    registrations
      .filter(r => !NON_ACTIVE_STATUSES.includes(r.status))
      .map(r => r.dancer_id)
  )
  if (activeDancerIds.size === 0) return []
  const anomalies: Anomaly[] = []

  // Build map: judge_id → set of dancer_ids they scored
  const judgeDancers = new Map<string, Set<string>>()
  for (const jid of judge_ids) judgeDancers.set(jid, new Set())
  for (const s of roundScores) {
    judgeDancers.get(s.judge_id)?.add(s.dancer_id)
  }

  for (const [judge_id, scoredDancers] of judgeDancers) {
    const missing = [...activeDancerIds].filter(d => !scoredDancers.has(d))
    if (missing.length > 0) {
      anomalies.push({
        type: 'incomplete_judge_packet',
        severity: 'blocker',
        scope: 'judge_packet',
        entity_ids: { judge_id, round_id, competition_id },
        message: `Judge ${judge_id} has not scored ${missing.length} of ${activeDancerIds.size} active dancers`,
        blocking: true,
        dedupe_key: `incomplete_judge_packet|${round_id}|${judge_id}`,
      })
    }
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/engine/anomalies/detect-incomplete-packets.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-incomplete-packets.ts tests/engine/anomalies/detect-incomplete-packets.test.ts
git commit -m "feat: add incomplete judge packet detection"
```

---

## Chunk 3: Rules Blocker Checks (5–7)

### Task 7: detectInvalidScoringReason

**Files:**
- Create: `tests/engine/anomalies/detect-invalid-scoring-reason.test.ts`
- Create: `src/lib/engine/anomalies/detect-invalid-scoring-reason.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-invalid-scoring-reason.test.ts
import { describe, it, expect } from 'vitest'
import { detectInvalidScoringReason } from '@/lib/engine/anomalies/detect-invalid-scoring-reason'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const base: ScoreEntry = {
  id: '1', round_id: 'r1', competition_id: 'c1',
  dancer_id: 'd1', judge_id: 'j1', raw_score: 80,
  flagged: false, flag_reason: null,
}

describe('detectInvalidScoringReason', () => {
  it('returns empty for normal scores', () => {
    expect(detectInvalidScoringReason([base], 'c1')).toEqual([])
  })

  it('detects flagged score without flag_reason', () => {
    const scores = [{ ...base, flagged: true, flag_reason: null }]
    const result = detectInvalidScoringReason(scores, 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('invalid_scoring_reason')
    expect(result[0].severity).toBe('blocker')
  })

  it('allows flagged score with valid flag_reason', () => {
    const scores = [{ ...base, flagged: true, flag_reason: 'Early Start' }]
    expect(detectInvalidScoringReason(scores, 'c1')).toEqual([])
  })

  it('detects zero score without flag', () => {
    const scores = [{ ...base, raw_score: 0, flagged: false }]
    const result = detectInvalidScoringReason(scores, 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('invalid_scoring_reason')
  })

  it('allows zero score when flagged with reason', () => {
    const scores = [{ ...base, raw_score: 0, flagged: true, flag_reason: 'Did Not Complete' }]
    expect(detectInvalidScoringReason(scores, 'c1')).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(detectInvalidScoringReason([], 'c1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npx vitest run tests/engine/anomalies/detect-invalid-scoring-reason.test.ts`

- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-invalid-scoring-reason.ts
import { type Anomaly, type ScoreEntry } from './types'

export function detectInvalidScoringReason(
  scores: ScoreEntry[],
  competition_id: string
): Anomaly[] {
  const anomalies: Anomaly[] = []

  for (const s of scores) {
    const hasFlag = s.flagged
    const hasReason = s.flag_reason !== null && s.flag_reason.trim() !== ''
    const isZero = s.raw_score === 0

    // Flagged without reason
    if (hasFlag && !hasReason) {
      anomalies.push({
        type: 'invalid_scoring_reason',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: {
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          round_id: s.round_id,
          competition_id,
        },
        message: `Score for dancer ${s.dancer_id} is flagged but has no reason specified`,
        blocking: true,
        dedupe_key: `invalid_scoring_reason|${s.round_id}|${s.judge_id}|${s.dancer_id}|flagged`,
      })
    }

    // Zero score without flag+reason
    if (isZero && !hasFlag) {
      anomalies.push({
        type: 'invalid_scoring_reason',
        severity: 'blocker',
        scope: 'dancer',
        entity_ids: {
          dancer_id: s.dancer_id,
          judge_id: s.judge_id,
          round_id: s.round_id,
          competition_id,
        },
        message: `Score of 0 for dancer ${s.dancer_id} without a flag or reason — is this a penalty, error, or did-not-complete?`,
        blocking: true,
        dedupe_key: `invalid_scoring_reason|${s.round_id}|${s.judge_id}|${s.dancer_id}|zero`,
      })
    }
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/engine/anomalies/detect-invalid-scoring-reason.test.ts`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-invalid-scoring-reason.ts tests/engine/anomalies/detect-invalid-scoring-reason.test.ts
git commit -m "feat: add invalid scoring reason detection"
```

### Task 8: detectRecallMismatch

**Files:**
- Create: `tests/engine/anomalies/detect-recall-mismatch.test.ts`
- Create: `src/lib/engine/anomalies/detect-recall-mismatch.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-recall-mismatch.test.ts
import { describe, it, expect } from 'vitest'
import { detectRecallMismatch } from '@/lib/engine/anomalies/detect-recall-mismatch'

describe('detectRecallMismatch', () => {
  it('returns empty when recall count matches rule', () => {
    // 10 active dancers, 50% recall = 5 expected. 5 recalled = match.
    const recalls = ['d1', 'd2', 'd3', 'd4', 'd5'].map(d => ({ dancer_id: d, round_id: 'r1' }))
    expect(detectRecallMismatch(recalls, 10, 50, 'r1', 'c1')).toEqual([])
  })

  it('detects recall count mismatch', () => {
    // 10 active dancers, 50% = 5 expected. Only 3 recalled.
    const recalls = ['d1', 'd2', 'd3'].map(d => ({ dancer_id: d, round_id: 'r1' }))
    const result = detectRecallMismatch(recalls, 10, 50, 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('recall_mismatch')
    expect(result[0].severity).toBe('blocker')
    expect(result[0].scope).toBe('round')
  })

  it('allows tie-bubble expansion (more than expected)', () => {
    // 10 active dancers, 50% = 5. 6 recalled (tie bubble) = allowed.
    const recalls = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map(d => ({ dancer_id: d, round_id: 'r1' }))
    expect(detectRecallMismatch(recalls, 10, 50, 'r1', 'c1')).toEqual([])
  })

  it('returns empty when recall_top_percent is 0', () => {
    expect(detectRecallMismatch([], 10, 0, 'r1', 'c1')).toEqual([])
  })

  it('returns empty when no recalls and no recall rule', () => {
    expect(detectRecallMismatch([], 0, 0, 'r1', 'c1')).toEqual([])
  })
})

// Note: activeDancerCount is passed by the orchestrator, which filters out
// non-active statuses (scratched, no_show, disqualified, etc.) before
// passing the count. This is NOT registrations.length.
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npx vitest run tests/engine/anomalies/detect-recall-mismatch.test.ts`

- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-recall-mismatch.ts
import { type Anomaly } from './types'

export function detectRecallMismatch(
  recalls: { dancer_id: string; round_id: string }[],
  totalDancers: number,
  recallTopPercent: number,
  round_id: string,
  competition_id: string
): Anomaly[] {
  if (recallTopPercent <= 0) return []
  if (recalls.length === 0 && totalDancers === 0) return []

  const expectedCount = Math.ceil(totalDancers * recallTopPercent / 100)
  const actualCount = recalls.length

  // Allow tie-bubble expansion: actual >= expected is fine
  // Only flag if actual < expected (too few recalled)
  if (actualCount < expectedCount) {
    return [{
      type: 'recall_mismatch',
      severity: 'blocker',
      scope: 'round',
      entity_ids: { round_id, competition_id },
      message: `Recall count mismatch: ${actualCount} recalled but rule expects at least ${expectedCount} (${recallTopPercent}% of ${totalDancers})`,
      blocking: true,
      dedupe_key: `recall_mismatch|${round_id}`,
    }]
  }

  return []
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/engine/anomalies/detect-recall-mismatch.test.ts`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-recall-mismatch.ts tests/engine/anomalies/detect-recall-mismatch.test.ts
git commit -m "feat: add recall count mismatch detection"
```

### Task 9: detectNonReproducibleResults

**Files:**
- Create: `tests/engine/anomalies/detect-non-reproducible.test.ts`
- Create: `src/lib/engine/anomalies/detect-non-reproducible.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-non-reproducible.test.ts
import { describe, it, expect } from 'vitest'
import { detectNonReproducibleResults } from '@/lib/engine/anomalies/detect-non-reproducible'
import { type ScoreEntry, type StoredResult } from '@/lib/engine/anomalies/types'
import { type RuleSetConfig, DEFAULT_RULES } from '@/lib/engine/rules'

const score = (dancer_id: string, judge_id: string, raw_score: number): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score,
  flagged: false, flag_reason: null,
})

describe('detectNonReproducibleResults', () => {
  it('returns empty when results match re-tabulation', () => {
    const scores = [
      score('d1', 'j1', 90), score('d1', 'j2', 85),
      score('d2', 'j1', 70), score('d2', 'j2', 75),
    ]
    // d1 should be rank 1, d2 rank 2 when tabulated
    const results: StoredResult[] = [
      { dancer_id: 'd1', final_rank: 1, calculated_payload: { total_points: 200, individual_ranks: [], rules_snapshot: DEFAULT_RULES } },
      { dancer_id: 'd2', final_rank: 2, calculated_payload: { total_points: 150, individual_ranks: [], rules_snapshot: DEFAULT_RULES } },
    ]
    expect(detectNonReproducibleResults(scores, results, 'r1', 'c1')).toEqual([])
  })

  it('detects rank mismatch', () => {
    const scores = [
      score('d1', 'j1', 90), score('d1', 'j2', 85),
      score('d2', 'j1', 70), score('d2', 'j2', 75),
    ]
    // Stored results have d2 ranked first — wrong
    const results: StoredResult[] = [
      { dancer_id: 'd1', final_rank: 2, calculated_payload: { total_points: 200, individual_ranks: [], rules_snapshot: DEFAULT_RULES } },
      { dancer_id: 'd2', final_rank: 1, calculated_payload: { total_points: 150, individual_ranks: [], rules_snapshot: DEFAULT_RULES } },
    ]
    const anomalies = detectNonReproducibleResults(scores, results, 'r1', 'c1')
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].type).toBe('non_reproducible_results')
    expect(anomalies[0].severity).toBe('blocker')
  })

  it('returns empty when no stored results', () => {
    const scores = [score('d1', 'j1', 90)]
    expect(detectNonReproducibleResults(scores, [], 'r1', 'c1')).toEqual([])
  })

  it('uses frozen rules snapshot from stored results', () => {
    const scores = [
      score('d1', 'j1', 90), score('d2', 'j1', 80),
    ]
    const frozenRules: RuleSetConfig = { ...DEFAULT_RULES, tie_breaker: 'none' }
    const results: StoredResult[] = [
      { dancer_id: 'd1', final_rank: 1, calculated_payload: { total_points: 100, individual_ranks: [], rules_snapshot: frozenRules } },
      { dancer_id: 'd2', final_rank: 2, calculated_payload: { total_points: 75, individual_ranks: [], rules_snapshot: frozenRules } },
    ]
    expect(detectNonReproducibleResults(scores, results, 'r1', 'c1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npx vitest run tests/engine/anomalies/detect-non-reproducible.test.ts`

- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-non-reproducible.ts
import { type Anomaly, type ScoreEntry, type StoredResult } from './types'
import { tabulate, type ScoreInput } from '../tabulate'
import { DEFAULT_RULES } from '../rules'

export function detectNonReproducibleResults(
  scores: ScoreEntry[],
  storedResults: StoredResult[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  if (storedResults.length === 0) return []

  // Use frozen rules from the first stored result, or default
  const frozenRules = storedResults[0]?.calculated_payload?.rules_snapshot ?? DEFAULT_RULES

  const roundScores = scores.filter(s => s.round_id === round_id)
  const scoreInputs: ScoreInput[] = roundScores.map(s => ({
    dancer_id: s.dancer_id,
    judge_id: s.judge_id,
    raw_score: s.raw_score,
    flagged: s.flagged,
  }))

  const recomputed = tabulate(scoreInputs, frozenRules)

  // Compare rank assignments
  const storedRanks = new Map(storedResults.map(r => [r.dancer_id, r.final_rank]))
  const recomputedRanks = new Map(recomputed.map(r => [r.dancer_id, r.final_rank]))

  for (const [dancer_id, storedRank] of storedRanks) {
    const recomputedRank = recomputedRanks.get(dancer_id)
    if (recomputedRank !== undefined && recomputedRank !== storedRank) {
      return [{
        type: 'non_reproducible_results',
        severity: 'blocker',
        scope: 'competition',
        entity_ids: { competition_id },
        message: `Stored results do not match re-tabulation. Example: dancer ${dancer_id} stored as rank ${storedRank} but recomputes as rank ${recomputedRank}`,
        blocking: true,
        dedupe_key: `non_reproducible_results|${competition_id}`,
      }]
    }
  }

  return []
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/engine/anomalies/detect-non-reproducible.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-non-reproducible.ts tests/engine/anomalies/detect-non-reproducible.test.ts
git commit -m "feat: add non-reproducible results detection"
```

---

## Chunk 4: Warning and Info Checks (8–12)

### Task 10: detectUnexplainedNoScores

**Files:**
- Create: `tests/engine/anomalies/detect-unexplained-no-scores.test.ts`
- Create: `src/lib/engine/anomalies/detect-unexplained-no-scores.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-unexplained-no-scores.test.ts
import { describe, it, expect } from 'vitest'
import { detectUnexplainedNoScores } from '@/lib/engine/anomalies/detect-unexplained-no-scores'
import { type ScoreEntry, type Registration } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string): ScoreEntry => ({
  id: '1', round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id: 'j1', raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string, status = 'registered'): Registration => ({
  id: dancer_id, dancer_id, competition_id: 'c1',
  competitor_number: '100', status, status_reason: null,
})

describe('detectUnexplainedNoScores', () => {
  it('returns empty when all registered dancers have scores', () => {
    expect(detectUnexplainedNoScores([score('d1')], [reg('d1')], 'r1', 'c1')).toEqual([])
  })

  it('detects registered dancer with no scores and no status explanation', () => {
    const result = detectUnexplainedNoScores([], [reg('d1')], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('unexplained_no_scores')
    expect(result[0].severity).toBe('warning')
    expect(result[0].blocking).toBe(false)
  })

  it('ignores dancer with explained status', () => {
    expect(detectUnexplainedNoScores([], [reg('d1', 'scratched')], 'r1', 'c1')).toEqual([])
    expect(detectUnexplainedNoScores([], [reg('d1', 'no_show')], 'r1', 'c1')).toEqual([])
    expect(detectUnexplainedNoScores([], [reg('d1', 'disqualified')], 'r1', 'c1')).toEqual([])
    expect(detectUnexplainedNoScores([], [reg('d1', 'did_not_complete')], 'r1', 'c1')).toEqual([])
    expect(detectUnexplainedNoScores([], [reg('d1', 'medical')], 'r1', 'c1')).toEqual([])
  })

  it('returns empty for empty inputs', () => {
    expect(detectUnexplainedNoScores([], [], 'r1', 'c1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify fail**
- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-unexplained-no-scores.ts
import { type Anomaly, type ScoreEntry, type Registration } from './types'

const EXPLAINED_STATUSES = new Set([
  'scratched', 'no_show', 'disqualified', 'did_not_complete', 'medical',
])

export function detectUnexplainedNoScores(
  scores: ScoreEntry[],
  registrations: Registration[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const scoredDancerIds = new Set(roundScores.map(s => s.dancer_id))
  const anomalies: Anomaly[] = []

  for (const reg of registrations) {
    if (!scoredDancerIds.has(reg.dancer_id) && !EXPLAINED_STATUSES.has(reg.status)) {
      anomalies.push({
        type: 'unexplained_no_scores',
        severity: 'warning',
        scope: 'dancer',
        entity_ids: { dancer_id: reg.dancer_id, round_id, competition_id },
        message: `Dancer ${reg.dancer_id} is registered (status: ${reg.status}) but has no scores and no explanation`,
        blocking: false,
        dedupe_key: `unexplained_no_scores|${round_id}|${reg.dancer_id}`,
      })
    }
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-unexplained-no-scores.ts tests/engine/anomalies/detect-unexplained-no-scores.test.ts
git commit -m "feat: add unexplained no-scores detection"
```

### Task 11: detectStatusScoreMismatch

**Files:**
- Create: `tests/engine/anomalies/detect-status-score-mismatch.test.ts`
- Create: `src/lib/engine/anomalies/detect-status-score-mismatch.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-status-score-mismatch.test.ts
import { describe, it, expect } from 'vitest'
import { detectStatusScoreMismatch } from '@/lib/engine/anomalies/detect-status-score-mismatch'
import { type ScoreEntry, type Registration } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string): ScoreEntry => ({
  id: '1', round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id: 'j1', raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string, status: string): Registration => ({
  id: dancer_id, dancer_id, competition_id: 'c1',
  competitor_number: '100', status, status_reason: null,
})

describe('detectStatusScoreMismatch', () => {
  it('returns empty for normal case', () => {
    expect(detectStatusScoreMismatch([score('d1')], [reg('d1', 'danced')], 'r1', 'c1')).toEqual([])
  })

  it('detects withdrawn dancer with scores', () => {
    const result = detectStatusScoreMismatch([score('d1')], [reg('d1', 'scratched')], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('status_score_mismatch')
    expect(result[0].severity).toBe('warning')
  })

  it('detects no_show dancer with scores', () => {
    const result = detectStatusScoreMismatch([score('d1')], [reg('d1', 'no_show')], 'r1', 'c1')
    expect(result).toHaveLength(1)
  })

  it('detects disqualified dancer with scores', () => {
    const result = detectStatusScoreMismatch([score('d1')], [reg('d1', 'disqualified')], 'r1', 'c1')
    expect(result).toHaveLength(1)
  })

  it('returns empty for empty inputs', () => {
    expect(detectStatusScoreMismatch([], [], 'r1', 'c1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify fail**
- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-status-score-mismatch.ts
import { type Anomaly, type ScoreEntry, type Registration } from './types'

const SHOULD_NOT_HAVE_SCORES = new Set([
  'scratched', 'no_show', 'disqualified',
])

export function detectStatusScoreMismatch(
  scores: ScoreEntry[],
  registrations: Registration[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const scoredDancerIds = new Set(roundScores.map(s => s.dancer_id))
  const anomalies: Anomaly[] = []

  for (const reg of registrations) {
    if (scoredDancerIds.has(reg.dancer_id) && SHOULD_NOT_HAVE_SCORES.has(reg.status)) {
      anomalies.push({
        type: 'status_score_mismatch',
        severity: 'warning',
        scope: 'dancer',
        entity_ids: { dancer_id: reg.dancer_id, round_id, competition_id },
        message: `Dancer ${reg.dancer_id} is marked "${reg.status}" but has score entries`,
        blocking: false,
        dedupe_key: `status_score_mismatch|${round_id}|${reg.dancer_id}`,
      })
    }
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-status-score-mismatch.ts tests/engine/anomalies/detect-status-score-mismatch.test.ts
git commit -m "feat: add status/score mismatch detection"
```

### Task 12: detectLargeScoreSpread

**Files:**
- Create: `tests/engine/anomalies/detect-score-spread.test.ts`
- Create: `src/lib/engine/anomalies/detect-score-spread.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-score-spread.test.ts
import { describe, it, expect } from 'vitest'
import { detectLargeScoreSpread } from '@/lib/engine/anomalies/detect-score-spread'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string, raw_score: number): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score,
  flagged: false, flag_reason: null,
})

describe('detectLargeScoreSpread', () => {
  it('returns empty for small spread', () => {
    const scores = [score('d1', 'j1', 80), score('d1', 'j2', 82)]
    expect(detectLargeScoreSpread(scores, 'r1', 'c1', 30)).toEqual([])
  })

  it('detects spread exceeding threshold', () => {
    const scores = [score('d1', 'j1', 90), score('d1', 'j2', 50)]
    const result = detectLargeScoreSpread(scores, 'r1', 'c1', 30)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('large_score_spread')
    expect(result[0].severity).toBe('info')
    expect(result[0].blocking).toBe(false)
  })

  it('returns empty for single judge', () => {
    const scores = [score('d1', 'j1', 80)]
    expect(detectLargeScoreSpread(scores, 'r1', 'c1', 30)).toEqual([])
  })

  it('checks each dancer independently', () => {
    const scores = [
      score('d1', 'j1', 90), score('d1', 'j2', 50), // 40 spread
      score('d2', 'j1', 80), score('d2', 'j2', 82), // 2 spread
    ]
    expect(detectLargeScoreSpread(scores, 'r1', 'c1', 30)).toHaveLength(1)
  })

  it('returns empty for empty input', () => {
    expect(detectLargeScoreSpread([], 'r1', 'c1', 30)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify fail**
- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-score-spread.ts
import { type Anomaly, type ScoreEntry } from './types'

export function detectLargeScoreSpread(
  scores: ScoreEntry[],
  round_id: string,
  competition_id: string,
  threshold: number
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const anomalies: Anomaly[] = []

  // Group scores by dancer
  const byDancer = new Map<string, number[]>()
  for (const s of roundScores) {
    if (!byDancer.has(s.dancer_id)) byDancer.set(s.dancer_id, [])
    byDancer.get(s.dancer_id)!.push(s.raw_score)
  }

  for (const [dancer_id, dancerScores] of byDancer) {
    if (dancerScores.length < 2) continue
    const spread = Math.max(...dancerScores) - Math.min(...dancerScores)
    if (spread > threshold) {
      anomalies.push({
        type: 'large_score_spread',
        severity: 'info',
        scope: 'dancer',
        entity_ids: { dancer_id, round_id, competition_id },
        message: `Score spread of ${spread} points across judges for dancer ${dancer_id} (threshold: ${threshold})`,
        blocking: false,
        dedupe_key: `large_score_spread|${round_id}|${dancer_id}`,
      })
    }
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-score-spread.ts tests/engine/anomalies/detect-score-spread.test.ts
git commit -m "feat: add large score spread detection"
```

### Task 13: detectJudgeFlaggedAll

**Files:**
- Create: `tests/engine/anomalies/detect-judge-flagged-all.test.ts`
- Create: `src/lib/engine/anomalies/detect-judge-flagged-all.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-judge-flagged-all.test.ts
import { describe, it, expect } from 'vitest'
import { detectJudgeFlaggedAll } from '@/lib/engine/anomalies/detect-judge-flagged-all'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string, flagged = false): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score: 80,
  flagged, flag_reason: flagged ? 'Early Start' : null,
})

describe('detectJudgeFlaggedAll', () => {
  it('returns empty when no judge flagged all dancers', () => {
    const scores = [
      score('d1', 'j1', true), score('d2', 'j1', false),
    ]
    expect(detectJudgeFlaggedAll(scores, 'r1', 'c1')).toEqual([])
  })

  it('detects judge who flagged every dancer', () => {
    const scores = [
      score('d1', 'j1', true), score('d2', 'j1', true),
    ]
    const result = detectJudgeFlaggedAll(scores, 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('judge_flagged_all')
    expect(result[0].severity).toBe('info')
    expect(result[0].entity_ids.judge_id).toBe('j1')
  })

  it('ignores judge with only one dancer (single entry is not suspicious)', () => {
    const scores = [score('d1', 'j1', true)]
    expect(detectJudgeFlaggedAll(scores, 'r1', 'c1')).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(detectJudgeFlaggedAll([], 'r1', 'c1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify fail**
- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-judge-flagged-all.ts
import { type Anomaly, type ScoreEntry } from './types'

export function detectJudgeFlaggedAll(
  scores: ScoreEntry[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const anomalies: Anomaly[] = []

  // Group by judge
  const byJudge = new Map<string, ScoreEntry[]>()
  for (const s of roundScores) {
    if (!byJudge.has(s.judge_id)) byJudge.set(s.judge_id, [])
    byJudge.get(s.judge_id)!.push(s)
  }

  for (const [judge_id, judgeScores] of byJudge) {
    if (judgeScores.length < 2) continue
    if (judgeScores.every(s => s.flagged)) {
      anomalies.push({
        type: 'judge_flagged_all',
        severity: 'info',
        scope: 'judge_packet',
        entity_ids: { judge_id, round_id, competition_id },
        message: `Judge ${judge_id} flagged all ${judgeScores.length} dancers in this round`,
        blocking: false,
        dedupe_key: `judge_flagged_all|${round_id}|${judge_id}`,
      })
    }
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-judge-flagged-all.ts tests/engine/anomalies/detect-judge-flagged-all.test.ts
git commit -m "feat: add judge-flagged-all detection"
```

### Task 14: detectJudgeFlatScores

**Files:**
- Create: `tests/engine/anomalies/detect-judge-flat-scores.test.ts`
- Create: `src/lib/engine/anomalies/detect-judge-flat-scores.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/detect-judge-flat-scores.test.ts
import { describe, it, expect } from 'vitest'
import { detectJudgeFlatScores } from '@/lib/engine/anomalies/detect-judge-flat-scores'
import { type ScoreEntry } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string, raw_score: number): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score,
  flagged: false, flag_reason: null,
})

describe('detectJudgeFlatScores', () => {
  it('returns empty for varied scores', () => {
    const scores = [score('d1', 'j1', 80), score('d2', 'j1', 75)]
    expect(detectJudgeFlatScores(scores, 'r1', 'c1')).toEqual([])
  })

  it('detects judge giving identical scores to all dancers', () => {
    const scores = [score('d1', 'j1', 80), score('d2', 'j1', 80), score('d3', 'j1', 80)]
    const result = detectJudgeFlatScores(scores, 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('judge_flat_scores')
    expect(result[0].severity).toBe('info')
    expect(result[0].entity_ids.judge_id).toBe('j1')
  })

  it('ignores judge with only one dancer', () => {
    const scores = [score('d1', 'j1', 80)]
    expect(detectJudgeFlatScores(scores, 'r1', 'c1')).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(detectJudgeFlatScores([], 'r1', 'c1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify fail**
- [ ] **Step 3: Write implementation**

```ts
// src/lib/engine/anomalies/detect-judge-flat-scores.ts
import { type Anomaly, type ScoreEntry } from './types'

export function detectJudgeFlatScores(
  scores: ScoreEntry[],
  round_id: string,
  competition_id: string
): Anomaly[] {
  const roundScores = scores.filter(s => s.round_id === round_id)
  const anomalies: Anomaly[] = []

  // Group by judge
  const byJudge = new Map<string, number[]>()
  for (const s of roundScores) {
    if (!byJudge.has(s.judge_id)) byJudge.set(s.judge_id, [])
    byJudge.get(s.judge_id)!.push(s.raw_score)
  }

  for (const [judge_id, judgeScores] of byJudge) {
    if (judgeScores.length < 2) continue
    const unique = new Set(judgeScores)
    if (unique.size === 1) {
      anomalies.push({
        type: 'judge_flat_scores',
        severity: 'info',
        scope: 'judge_packet',
        entity_ids: { judge_id, round_id, competition_id },
        message: `Judge ${judge_id} gave identical score (${judgeScores[0]}) to all ${judgeScores.length} dancers`,
        blocking: false,
        dedupe_key: `judge_flat_scores|${round_id}|${judge_id}`,
      })
    }
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/anomalies/detect-judge-flat-scores.ts tests/engine/anomalies/detect-judge-flat-scores.test.ts
git commit -m "feat: add judge flat scores detection"
```

---

## Chunk 5: Orchestrator, Tabulation Fix, and UI Integration

### Task 15: Create detectAnomalies orchestrator

**Files:**
- Create: `tests/engine/anomalies/index.test.ts`
- Create: `src/lib/engine/anomalies/index.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/engine/anomalies/index.test.ts
import { describe, it, expect } from 'vitest'
import { detectAnomalies } from '@/lib/engine/anomalies'
import { type AnomalyInput } from '@/lib/engine/anomalies/types'
import { DEFAULT_RULES } from '@/lib/engine/rules'

const cleanInput: AnomalyInput = {
  competition_id: 'c1',
  scores: [
    { id: '1', round_id: 'r1', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j1', raw_score: 80, flagged: false, flag_reason: null },
    { id: '2', round_id: 'r1', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j2', raw_score: 85, flagged: false, flag_reason: null },
    { id: '3', round_id: 'r1', competition_id: 'c1', dancer_id: 'd2', judge_id: 'j1', raw_score: 70, flagged: false, flag_reason: null },
    { id: '4', round_id: 'r1', competition_id: 'c1', dancer_id: 'd2', judge_id: 'j2', raw_score: 75, flagged: false, flag_reason: null },
  ],
  registrations: [
    { id: 'r1', dancer_id: 'd1', competition_id: 'c1', competitor_number: '101', status: 'registered', status_reason: null },
    { id: 'r2', dancer_id: 'd2', competition_id: 'c1', competitor_number: '102', status: 'registered', status_reason: null },
  ],
  rounds: [{ id: 'r1', competition_id: 'c1', round_number: 1, round_type: 'standard', judge_sign_offs: {} }],
  judge_ids: ['j1', 'j2'],
  results: [],
  rules: DEFAULT_RULES,
  recalls: [],
}

describe('detectAnomalies', () => {
  it('returns empty array for clean data', () => {
    expect(detectAnomalies(cleanInput)).toEqual([])
  })

  it('returns anomalies in deterministic order', () => {
    const input: AnomalyInput = {
      ...cleanInput,
      scores: [
        ...cleanInput.scores,
        // Duplicate entry
        { id: '5', round_id: 'r1', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j1', raw_score: 80, flagged: false, flag_reason: null },
        // Non-roster dancer
        { id: '6', round_id: 'r1', competition_id: 'c1', dancer_id: 'd999', judge_id: 'j1', raw_score: 50, flagged: false, flag_reason: null },
      ],
    }
    const result = detectAnomalies(input)
    expect(result.length).toBeGreaterThanOrEqual(2)
    // Duplicates come before non-roster (deterministic order)
    const types = result.map(a => a.type)
    const dupIdx = types.indexOf('duplicate_score_entry')
    const nonRosterIdx = types.indexOf('score_for_non_roster_dancer')
    expect(dupIdx).toBeLessThan(nonRosterIdx)
  })

  it('separates blockers from warnings', () => {
    const input: AnomalyInput = {
      ...cleanInput,
      scores: [
        { id: '1', round_id: 'r1', competition_id: 'c1', dancer_id: 'd1', judge_id: 'j1', raw_score: 80, flagged: false, flag_reason: null },
        // d1 missing j2 score — blocker
      ],
    }
    const result = detectAnomalies(input)
    const blockers = result.filter(a => a.blocking)
    const warnings = result.filter(a => !a.blocking)
    expect(blockers.length).toBeGreaterThan(0)
    // d2 has no scores — warning
    expect(warnings.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npx vitest run tests/engine/anomalies/index.test.ts`

- [ ] **Step 3: Write orchestrator**

**IMPORTANT: Checks are split into competition-wide (run once) and round-scoped (run per round) to avoid duplicate anomaly emissions.**

```ts
// src/lib/engine/anomalies/index.ts
export type { Anomaly, AnomalyType, AnomalyInput, ScoreEntry, Registration, Round, StoredResult } from './types'

import { type Anomaly, type AnomalyInput, NON_ACTIVE_STATUSES } from './types'
import { detectDuplicateScoreEntries } from './detect-duplicate-entries'
import { detectScoresForNonRosterDancers } from './detect-non-roster-scores'
import { detectMissingRequiredScores } from './detect-missing-scores'
import { detectIncompleteJudgePackets } from './detect-incomplete-packets'
import { detectInvalidScoringReason } from './detect-invalid-scoring-reason'
import { detectRecallMismatch } from './detect-recall-mismatch'
import { detectNonReproducibleResults } from './detect-non-reproducible'
import { detectUnexplainedNoScores } from './detect-unexplained-no-scores'
import { detectStatusScoreMismatch } from './detect-status-score-mismatch'
import { detectLargeScoreSpread } from './detect-score-spread'
import { detectJudgeFlaggedAll } from './detect-judge-flagged-all'
import { detectJudgeFlatScores } from './detect-judge-flat-scores'

const SCORE_SPREAD_THRESHOLD = 30

export function detectAnomalies(input: AnomalyInput): Anomaly[] {
  const { competition_id, scores, registrations, rounds, judge_ids, results, rules, recalls } = input
  const anomalies: Anomaly[] = []

  // === COMPETITION-WIDE CHECKS (run once, not per round) ===
  anomalies.push(...detectDuplicateScoreEntries(scores, competition_id))
  anomalies.push(...detectScoresForNonRosterDancers(scores, registrations, competition_id))
  anomalies.push(...detectInvalidScoringReason(scores, competition_id))
  anomalies.push(...detectNonReproducibleResults(scores, results, rounds[rounds.length - 1]?.id ?? '', competition_id))

  // === ROUND-SCOPED CHECKS (run per round) ===
  for (const round of rounds) {
    // Count active dancers for this round (exclude scratched/no_show/etc.)
    const activeDancerCount = registrations.filter(
      r => !NON_ACTIVE_STATUSES.includes(r.status)
    ).length
    const roundRecalls = recalls.filter(rc => rc.round_id === round.id)

    // Integrity blockers
    anomalies.push(...detectMissingRequiredScores(scores, registrations, judge_ids, round.id, competition_id))
    anomalies.push(...detectIncompleteJudgePackets(scores, registrations, judge_ids, round.id, competition_id))

    // Rules blockers
    anomalies.push(...detectRecallMismatch(roundRecalls, activeDancerCount, rules.recall_top_percent, round.id, competition_id))

    // Warnings
    anomalies.push(...detectUnexplainedNoScores(scores, registrations, round.id, competition_id))
    anomalies.push(...detectStatusScoreMismatch(scores, registrations, round.id, competition_id))

    // Review signals
    anomalies.push(...detectLargeScoreSpread(scores, round.id, competition_id, SCORE_SPREAD_THRESHOLD))
    anomalies.push(...detectJudgeFlaggedAll(scores, round.id, competition_id))
    anomalies.push(...detectJudgeFlatScores(scores, round.id, competition_id))
  }

  return anomalies
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/engine/anomalies/index.test.ts`
Expected: 3 PASS

- [ ] **Step 5: Run ALL tests**

Run: `npm test`
Expected: All existing + new tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/anomalies/index.ts tests/engine/anomalies/index.test.ts
git commit -m "feat: add anomaly detection orchestrator"
```

### Task 16: Update tabulation to store frozen rules snapshot

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

The `handleTabulate` function must include `rules_snapshot` in `calculated_payload` when upserting results. This is required for `detectNonReproducibleResults()` to work.

- [ ] **Step 1: Update handleTabulate in competition detail page**

In `[compId]/page.tsx`, find the `handleTabulate` function. In the `calculated_payload` object being upserted, add `rules_snapshot: ruleset`:

```ts
// Change this in handleTabulate():
calculated_payload: {
  total_points: r.total_points,
  individual_ranks: r.individual_ranks,
},

// To:
calculated_payload: {
  total_points: r.total_points,
  individual_ranks: r.individual_ranks,
  rules_snapshot: ruleset,
},
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add "src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx"
git commit -m "feat: store frozen rules snapshot in results payload"
```

### Task 17: Wire anomaly panel into competition detail page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

- [ ] **Step 1: Add anomaly detection to the page**

Add import and state at top of component:
```ts
import { detectAnomalies, type Anomaly, type AnomalyInput } from '@/lib/engine/anomalies'
```

Add state:
```ts
const [anomalies, setAnomalies] = useState<Anomaly[]>([])
```

After `loadData()` sets all state, compute anomalies:
```ts
// Inside loadData(), after all setX calls and before setLoading(false):
const latestRound = roundRes.data?.[roundRes.data.length - 1]
if (latestRound && judgesRes.data) {
  const anomalyInput: AnomalyInput = {
    competition_id: compId,
    scores: (scoreRes.data ?? []).map(s => ({
      id: s.id,
      round_id: s.round_id,
      competition_id: s.competition_id,
      dancer_id: s.dancer_id,
      judge_id: s.judge_id,
      raw_score: Number(s.raw_score),
      flagged: s.flagged ?? false,
      flag_reason: s.flag_reason ?? null,
    })),
    registrations: (regRes.data ?? []).map(r => ({
      id: r.id,
      dancer_id: r.dancer_id,
      competition_id: r.competition_id,
      competitor_number: r.competitor_number,
      status: r.status,
      status_reason: r.status_reason ?? null,
    })),
    rounds: [{ id: latestRound.id, competition_id: compId, round_number: latestRound.round_number, round_type: latestRound.round_type, judge_sign_offs: latestRound.judge_sign_offs ?? {} }],
    judge_ids: judgesRes.data.map((j: { id: string }) => j.id),
    results: (resultRes.data ?? []).map(r => ({
      dancer_id: r.dancer_id,
      final_rank: r.final_rank,
      calculated_payload: r.calculated_payload ?? { total_points: 0, individual_ranks: [] },
    })),
    rules: compRes.data?.rule_sets?.config as RuleSetConfig ?? DEFAULT_RULES,
    recalls: [],
  }
  setAnomalies(detectAnomalies(anomalyInput))
} else {
  setAnomalies([])
}
```

- [ ] **Step 2: Add anomaly panel UI between rounds and actions**

```tsx
{/* Anomaly Panel — between Rounds and Actions */}
{anomalies.length > 0 && (
  <Card className="feis-card">
    <CardHeader>
      <CardTitle className="text-lg">
        Pre-Tabulation Checks ({anomalies.length})
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      {anomalies.filter(a => a.blocking).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-destructive">Blockers — must resolve before tabulation</p>
          {anomalies.filter(a => a.blocking).map((a, i) => (
            <div key={i} className="text-sm p-2 rounded bg-red-50 border border-red-200 text-red-800">
              {a.message}
            </div>
          ))}
        </div>
      )}
      {anomalies.filter(a => a.severity === 'warning').length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-feis-orange">Warnings — review recommended</p>
          {anomalies.filter(a => a.severity === 'warning').map((a, i) => (
            <div key={i} className="text-sm p-2 rounded bg-orange-50 border border-orange-200 text-orange-800">
              {a.message}
            </div>
          ))}
        </div>
      )}
      {anomalies.filter(a => a.severity === 'info').length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground font-medium">
            Review signals ({anomalies.filter(a => a.severity === 'info').length})
          </summary>
          <div className="mt-2 space-y-2">
            {anomalies.filter(a => a.severity === 'info').map((a, i) => (
              <div key={i} className="p-2 rounded bg-muted text-muted-foreground">
                {a.message}
              </div>
            ))}
          </div>
        </details>
      )}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 3: Gate tabulation button on blockers**

Update the `disabled` condition on the "Run Tabulation" button:
```tsx
<Button
  onClick={handleTabulate}
  variant="default"
  disabled={!allSignedOff || anomalies.some(a => a.blocking)}
>
  {anomalies.some(a => a.blocking)
    ? 'Resolve blockers before tabulation'
    : !allSignedOff
      ? 'Waiting for judge sign-offs...'
      : 'Run Tabulation'}
</Button>
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build`

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add "src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx"
git commit -m "feat: wire anomaly detection into competition detail page"
```

### Task 18: Final integration verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (41 existing + ~48 new anomaly tests)

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git status
# If clean, done. If not, commit cleanup.
```
