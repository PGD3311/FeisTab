# Irish Points Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw-score-average tabulation with Irish Points scoring, add judge sign-off, score flagging, and teacher tracking.

**Architecture:** Pure engine functions (no DB imports) compute Irish Points from raw scores via rank-then-convert pipeline. UI pages read new schema columns for sign-off/flagging state. All math uses integer thousandths to avoid float bugs.

**Tech Stack:** TypeScript, Vitest, Next.js 15, Supabase, Tailwind CSS, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-10-irish-points-refactor-design.md`

---

## Chunk 1: Engine Core (Tasks 1–5)

These tasks rewrite the tabulation engine using TDD. They are sequential — each builds on the previous.

### Task 1: Update RuleSetConfig interface

**Files:**
- Modify: `src/lib/engine/rules.ts`

- [ ] **Step 1: Rewrite `rules.ts` with new config shape**

Replace the entire file:

```typescript
export interface RuleSetConfig {
  score_min: number
  score_max: number
  scoring_method: 'irish_points'
  tie_breaker: 'countback' | 'none'
  recall_top_percent: number
  drop_high: boolean
  drop_low: boolean
}

export function validateScore(score: number, config: RuleSetConfig): boolean {
  return score >= config.score_min && score <= config.score_max
}

export const DEFAULT_RULES: RuleSetConfig = {
  score_min: 0,
  score_max: 100,
  scoring_method: 'irish_points',
  tie_breaker: 'countback',
  recall_top_percent: 50,
  drop_high: false,
  drop_low: false,
}
```

- [ ] **Step 2: Verify file saves without syntax errors**

Run: `npx tsc --noEmit src/lib/engine/rules.ts 2>&1 || true`

(Will show errors in other files that reference old config — that's expected and fixed in later tasks.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/engine/rules.ts
git commit -m "refactor: update RuleSetConfig for Irish Points scoring"
```

---

### Task 2: Irish Points lookup table + tests

**Files:**
- Create: `src/lib/engine/irish-points.ts`
- Create: `tests/engine/irish-points.test.ts`

- [ ] **Step 1: Write failing tests for Irish Points lookup**

Create `tests/engine/irish-points.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { irishPointsForRank, averagePointsForTiedRanks } from '@/lib/engine/irish-points'

describe('irishPointsForRank', () => {
  it('returns 100 for 1st place', () => {
    expect(irishPointsForRank(1)).toBe(100)
  })

  it('returns 75 for 2nd place', () => {
    expect(irishPointsForRank(2)).toBe(75)
  })

  it('returns 65 for 3rd place', () => {
    expect(irishPointsForRank(3)).toBe(65)
  })

  it('returns 1 for 50th place', () => {
    expect(irishPointsForRank(50)).toBe(1)
  })

  it('returns 0 for ranks beyond 50', () => {
    expect(irishPointsForRank(51)).toBe(0)
    expect(irishPointsForRank(100)).toBe(0)
  })

  it('returns 0 for rank 0 or negative', () => {
    expect(irishPointsForRank(0)).toBe(0)
    expect(irishPointsForRank(-1)).toBe(0)
  })
})

describe('averagePointsForTiedRanks', () => {
  it('averages points for 2-way tie at 2nd/3rd', () => {
    // 2nd=75, 3rd=65 → average = 70
    expect(averagePointsForTiedRanks(2, 2)).toBe(70)
  })

  it('averages points for 3-way tie at 1st/2nd/3rd', () => {
    // 1st=100, 2nd=75, 3rd=65 → average = 80
    expect(averagePointsForTiedRanks(1, 3)).toBe(80)
  })

  it('returns exact points when no tie (count=1)', () => {
    expect(averagePointsForTiedRanks(1, 1)).toBe(100)
    expect(averagePointsForTiedRanks(5, 1)).toBe(56)
  })

  it('handles tie spanning beyond rank 50', () => {
    // Tie at 49th and 50th: 49th=2, 50th=1 → average = 1.5 → rounds to 2
    expect(averagePointsForTiedRanks(49, 2)).toBe(2)
  })

  it('handles tie entirely beyond rank 50', () => {
    expect(averagePointsForTiedRanks(51, 3)).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/irish-points.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Irish Points lookup**

Create `src/lib/engine/irish-points.ts`:

```typescript
// Standard Irish Points table: rank → points
// 1st=100, 2nd=75, 3rd=65, then decreasing pattern down to 50th=1
const IRISH_POINTS_TABLE: number[] = [
  0,   // index 0 (unused — ranks are 1-based)
  100, // 1st
  75,  // 2nd
  65,  // 3rd
  60,  // 4th
  56,  // 5th
  53,  // 6th
  50,  // 7th
  47,  // 8th
  45,  // 9th
  43,  // 10th
  41, 39, 38, 37, 36, 35, 34, 33, 32, 31, // 11th–20th
  30, 29, 28, 27, 26, 25, 24, 23, 22, 21, // 21st–30th
  20, 19, 18, 17, 16, 15, 14, 13, 12, 11, // 31st–40th
  10, 9, 8, 7, 6, 5, 4, 3, 2, 1,          // 41st–50th
]

/**
 * Look up Irish Points for a given rank.
 * Ranks 1–50 return points per the standard table. Ranks beyond 50 return 0.
 */
export function irishPointsForRank(rank: number): number {
  if (rank < 1 || rank > 50) return 0
  return IRISH_POINTS_TABLE[rank]
}

/**
 * When dancers tie for a rank, they share the average of the Irish Points
 * for the positions they span. E.g., 2-way tie at rank 2 averages
 * points for positions 2 and 3.
 *
 * Uses integer math (×1000) internally, rounds to nearest integer.
 */
export function averagePointsForTiedRanks(startRank: number, tiedCount: number): number {
  if (tiedCount <= 0 || startRank < 1) return 0

  let sum = 0
  for (let i = 0; i < tiedCount; i++) {
    sum += irishPointsForRank(startRank + i)
  }

  // Irish Points are integers, so simple rounding suffices
  return Math.round(sum / tiedCount)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/irish-points.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/irish-points.ts tests/engine/irish-points.test.ts
git commit -m "feat: add Irish Points lookup table with tied-rank averaging"
```

---

### Task 3: Per-judge ranking function + tests

**Files:**
- Create: `src/lib/engine/rank-judges.ts`
- Create: `tests/engine/rank-judges.test.ts`

- [ ] **Step 1: Write failing tests for per-judge ranking**

Create `tests/engine/rank-judges.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { rankByJudge, type JudgeRanking } from '@/lib/engine/rank-judges'
import { type ScoreInput } from '@/lib/engine/tabulate'

describe('rankByJudge', () => {
  it('ranks dancers within a single judge by raw score descending', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 85 },
    ]
    const result = rankByJudge(scores)
    const j1 = result.get('j1')!
    expect(j1).toHaveLength(3)

    // b=90 → rank 1, c=85 → rank 2, a=80 → rank 3
    const findDancer = (id: string) => j1.find(r => r.dancer_id === id)!
    expect(findDancer('b').rank).toBe(1)
    expect(findDancer('b').irish_points).toBe(100)
    expect(findDancer('c').rank).toBe(2)
    expect(findDancer('c').irish_points).toBe(75)
    expect(findDancer('a').rank).toBe(3)
    expect(findDancer('a').irish_points).toBe(65)
  })

  it('handles tied raw scores — shared rank, averaged points', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
    ]
    const result = rankByJudge(scores)
    const j1 = result.get('j1')!

    const findDancer = (id: string) => j1.find(r => r.dancer_id === id)!
    // a and b tied for 1st: avg of 1st(100) and 2nd(75) = 88 (rounded)
    expect(findDancer('a').rank).toBe(1)
    expect(findDancer('b').rank).toBe(1)
    expect(findDancer('a').irish_points).toBe(88)
    expect(findDancer('b').irish_points).toBe(88)
    // c is 3rd (rank skips 2nd)
    expect(findDancer('c').rank).toBe(3)
    expect(findDancer('c').irish_points).toBe(65)
  })

  it('handles multiple judges independently', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 70 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 95 },
    ]
    const result = rankByJudge(scores)

    // Judge j1: a=1st, b=2nd
    const j1a = result.get('j1')!.find(r => r.dancer_id === 'a')!
    expect(j1a.rank).toBe(1)
    expect(j1a.irish_points).toBe(100)

    // Judge j2: b=1st, a=2nd
    const j2b = result.get('j2')!.find(r => r.dancer_id === 'b')!
    expect(j2b.rank).toBe(1)
    expect(j2b.irish_points).toBe(100)
  })

  it('assigns 0 points to flagged scores', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 85, flagged: true },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
    ]
    const result = rankByJudge(scores)
    const j1 = result.get('j1')!
    const findDancer = (id: string) => j1.find(r => r.dancer_id === id)!

    // b is flagged → 0 points, ranked last
    expect(findDancer('b').irish_points).toBe(0)
    // a=1st (100), c=2nd (75) — flagged dancer doesn't consume a rank slot
    expect(findDancer('a').rank).toBe(1)
    expect(findDancer('a').irish_points).toBe(100)
    expect(findDancer('c').rank).toBe(2)
    expect(findDancer('c').irish_points).toBe(75)
  })

  it('handles all dancers tied (same score)', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
    ]
    const result = rankByJudge(scores)
    const j1 = result.get('j1')!
    // All tie for 1st: avg of 1st(100), 2nd(75), 3rd(65) = 80
    for (const r of j1) {
      expect(r.rank).toBe(1)
      expect(r.irish_points).toBe(80)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/rank-judges.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Update ScoreInput to add `flagged` field**

In `src/lib/engine/tabulate.ts`, update the `ScoreInput` interface (keep the rest of the file for now — it will be fully rewritten in Task 4):

```typescript
export interface ScoreInput {
  dancer_id: string
  judge_id: string
  raw_score: number
  flagged?: boolean
}
```

- [ ] **Step 4: Implement per-judge ranking**

Create `src/lib/engine/rank-judges.ts`:

```typescript
import { type ScoreInput } from './tabulate'
import { averagePointsForTiedRanks } from './irish-points'

export interface JudgeRanking {
  dancer_id: string
  rank: number
  irish_points: number
}

/**
 * For each judge, rank all dancers by raw_score descending.
 * Tied raw scores share the same rank; Irish Points are averaged
 * across the tied positions. Flagged scores get rank=last and 0 points.
 *
 * Returns a Map of judge_id → JudgeRanking[]
 */
export function rankByJudge(
  scores: ScoreInput[]
): Map<string, JudgeRanking[]> {
  // Group by judge
  const byJudge = new Map<string, ScoreInput[]>()
  for (const s of scores) {
    if (!byJudge.has(s.judge_id)) byJudge.set(s.judge_id, [])
    byJudge.get(s.judge_id)!.push(s)
  }

  const result = new Map<string, JudgeRanking[]>()

  for (const [judgeId, judgeScores] of byJudge) {
    // Separate flagged and unflagged
    const unflagged = judgeScores.filter(s => !s.flagged)
    const flagged = judgeScores.filter(s => s.flagged)

    // Sort unflagged by raw_score descending
    unflagged.sort((a, b) => b.raw_score - a.raw_score)

    const rankings: JudgeRanking[] = []

    // Assign ranks with tie handling
    let i = 0
    while (i < unflagged.length) {
      // Find all dancers tied at this score
      const tiedStart = i
      while (
        i < unflagged.length &&
        unflagged[i].raw_score === unflagged[tiedStart].raw_score
      ) {
        i++
      }
      const tiedCount = i - tiedStart
      const rank = tiedStart + 1 // 1-based rank
      const points = averagePointsForTiedRanks(rank, tiedCount)

      for (let j = tiedStart; j < i; j++) {
        rankings.push({
          dancer_id: unflagged[j].dancer_id,
          rank,
          irish_points: points,
        })
      }
    }

    // Flagged dancers get 0 points
    for (const s of flagged) {
      rankings.push({
        dancer_id: s.dancer_id,
        rank: unflagged.length + 1,
        irish_points: 0,
      })
    }

    result.set(judgeId, rankings)
  }

  return result
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/engine/rank-judges.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/rank-judges.ts tests/engine/rank-judges.test.ts src/lib/engine/tabulate.ts
git commit -m "feat: add per-judge ranking with Irish Points and flag support"
```

---

### Task 4: Rewrite tabulate() to use Irish Points

**Files:**
- Modify: `src/lib/engine/tabulate.ts`
- Modify: `tests/engine/tabulate.test.ts`

- [ ] **Step 1: Write new tests for Irish Points tabulation**

Replace `tests/engine/tabulate.test.ts` entirely:

```typescript
import { describe, it, expect } from 'vitest'
import { tabulate, resolveCountback, type ScoreInput, type TabulationResult } from '@/lib/engine/tabulate'
import { type RuleSetConfig, DEFAULT_RULES } from '@/lib/engine/rules'

describe('tabulate (Irish Points)', () => {
  it('ranks dancers by Irish Points total across judges', () => {
    // j1: a=90(1st=100), b=80(2nd=75). j2: b=95(1st=100), a=85(2nd=75).
    // a=100+75=175. b=75+100=175. Tie (both have one 1st).
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 85 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 95 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].final_rank).toBe(1)
    expect(results[0].total_points).toBe(175)
  })

  it('ranks correctly with single judge', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 85 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 92 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    // c=92→1st(100), a=90→2nd(75), b=85→3rd(65)
    expect(results[0].dancer_id).toBe('c')
    expect(results[0].total_points).toBe(100)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].dancer_id).toBe('a')
    expect(results[1].total_points).toBe(75)
    expect(results[2].dancer_id).toBe('b')
    expect(results[2].total_points).toBe(65)
  })

  it('true tie when countback cannot differentiate (same rank distribution)', () => {
    // 3 judges, 3 dancers. Each gets one 1st, one 2nd, one 3rd → 240 each.
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 95 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j3', raw_score: 88 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 88 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 95 },
      { dancer_id: 'b', judge_id: 'j3', raw_score: 80 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'c', judge_id: 'j2', raw_score: 88 },
      { dancer_id: 'c', judge_id: 'j3', raw_score: 95 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].final_rank).toBe(1)
    expect(results[2].final_rank).toBe(1)
  })

  it('ranks multiple dancers by total (no tie)', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 95 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 85 },
      { dancer_id: 'c', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 70 },
      { dancer_id: 'c', judge_id: 'j2', raw_score: 90 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    // j1: a=1st(100),b=2nd(75),c=3rd(65). j2: c=1st(100),a=2nd(75),b=3rd(65)
    // a=175, c=165, b=140
    expect(results[0].dancer_id).toBe('a')
    expect(results[0].total_points).toBe(175)
    expect(results[0].final_rank).toBe(1)
    expect(results[1].dancer_id).toBe('c')
    expect(results[1].total_points).toBe(165)
    expect(results[1].final_rank).toBe(2)
    expect(results[2].dancer_id).toBe('b')
    expect(results[2].total_points).toBe(140)
    expect(results[2].final_rank).toBe(3)
  })

  it('flagged score gives 0 points from that judge', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'a', judge_id: 'j2', raw_score: 85, flagged: true },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
      { dancer_id: 'b', judge_id: 'j2', raw_score: 95 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    // j1: a=1st(100), b=2nd(75). j2: b=1st(100), a=flagged(0)
    // a=100+0=100. b=75+100=175.
    expect(results[0].dancer_id).toBe('b')
    expect(results[0].total_points).toBe(175)
    expect(results[1].dancer_id).toBe('a')
    expect(results[1].total_points).toBe(100)
  })

  it('resolveCountback differentiates by rank distribution', () => {
    // Crafted TabulationResult objects with same total but different rank counts
    const a: TabulationResult = {
      dancer_id: 'a', final_rank: 0, total_points: 240,
      individual_ranks: [
        { judge_id: 'j1', rank: 1, irish_points: 100 },
        { judge_id: 'j2', rank: 1, irish_points: 100 },
        { judge_id: 'j3', rank: 5, irish_points: 40 },
      ],
    }
    const b: TabulationResult = {
      dancer_id: 'b', final_rank: 0, total_points: 240,
      individual_ranks: [
        { judge_id: 'j1', rank: 2, irish_points: 80 },
        { judge_id: 'j2', rank: 2, irish_points: 80 },
        { judge_id: 'j3', rank: 2, irish_points: 80 },
      ],
    }
    // a has two 1st places, b has zero → a wins
    expect(resolveCountback(a, b)).toBeLessThan(0)
  })

  it('returns individual_ranks breakdown per dancer', () => {
    const scores: ScoreInput[] = [
      { dancer_id: 'a', judge_id: 'j1', raw_score: 90 },
      { dancer_id: 'b', judge_id: 'j1', raw_score: 80 },
    ]
    const results = tabulate(scores, DEFAULT_RULES)
    const dancerA = results.find(r => r.dancer_id === 'a')!
    expect(dancerA.individual_ranks).toHaveLength(1)
    expect(dancerA.individual_ranks[0].judge_id).toBe('j1')
    expect(dancerA.individual_ranks[0].rank).toBe(1)
    expect(dancerA.individual_ranks[0].irish_points).toBe(100)
  })

  it('returns empty array for empty scores', () => {
    expect(tabulate([], DEFAULT_RULES)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/tabulate.test.ts`
Expected: FAIL — old TabulationResult shape doesn't match

- [ ] **Step 3: Rewrite tabulate.ts with Irish Points pipeline**

Replace `src/lib/engine/tabulate.ts` entirely:

```typescript
import { type RuleSetConfig } from './rules'
import { rankByJudge, type JudgeRanking } from './rank-judges'

export interface ScoreInput {
  dancer_id: string
  judge_id: string
  raw_score: number
  flagged?: boolean
}

export interface TabulationResult {
  dancer_id: string
  final_rank: number
  total_points: number
  individual_ranks: { judge_id: string; rank: number; irish_points: number }[]
}

// Precision multiplier for integer comparisons
const PRECISION = 1000

/**
 * Tabulate competition results using Irish Points.
 *
 * Pipeline:
 * 1. Each judge's raw scores → rank dancers → convert to Irish Points
 * 2. Sum Irish Points across all judges per dancer
 * 3. Rank by total; break ties via countback (most 1st places, then 2nd, etc.)
 */
export function tabulate(
  scores: ScoreInput[],
  rules: RuleSetConfig
): TabulationResult[] {
  if (scores.length === 0) return []

  // Step 1: Get per-judge rankings with Irish Points
  const judgeRankings = rankByJudge(scores)

  // Step 2: Aggregate per dancer
  const dancerMap = new Map<string, {
    total: number
    ranks: { judge_id: string; rank: number; irish_points: number }[]
  }>()

  for (const [judgeId, rankings] of judgeRankings) {
    for (const r of rankings) {
      if (!dancerMap.has(r.dancer_id)) {
        dancerMap.set(r.dancer_id, { total: 0, ranks: [] })
      }
      const entry = dancerMap.get(r.dancer_id)!
      entry.total += r.irish_points
      entry.ranks.push({
        judge_id: judgeId,
        rank: r.rank,
        irish_points: r.irish_points,
      })
    }
  }

  // Build result array
  const aggregated: { result: TabulationResult; intTotal: number }[] = []
  for (const [dancer_id, data] of dancerMap) {
    aggregated.push({
      result: {
        dancer_id,
        final_rank: 0,
        total_points: data.total,
        individual_ranks: data.ranks,
      },
      intTotal: Math.round(data.total * PRECISION),
    })
  }

  // Step 3: Sort by total (descending), then countback tie-breaker
  aggregated.sort((a, b) => {
    if (b.intTotal !== a.intTotal) return b.intTotal - a.intTotal

    if (rules.tie_breaker === 'countback') {
      return resolveCountback(a.result, b.result)
    }

    return 0
  })

  // Assign ranks (tied dancers share rank)
  for (let i = 0; i < aggregated.length; i++) {
    if (i === 0) {
      aggregated[i].result.final_rank = 1
    } else {
      const prev = aggregated[i - 1]
      const curr = aggregated[i]

      let tied = curr.intTotal === prev.intTotal
      if (tied && rules.tie_breaker === 'countback') {
        tied = resolveCountback(prev.result, curr.result) === 0
      }

      aggregated[i].result.final_rank = tied
        ? prev.result.final_rank
        : i + 1
    }
  }

  return aggregated.map(a => a.result)
}

/**
 * Countback tie-breaker: compare dancers by number of 1st-place ranks,
 * then 2nd-place ranks, etc. Returns negative if a wins, positive if b wins,
 * 0 if still tied. Exported for direct testing.
 */
export function resolveCountback(a: TabulationResult, b: TabulationResult): number {
  // Find the maximum rank we need to check
  const maxRank = Math.max(
    ...a.individual_ranks.map(r => r.rank),
    ...b.individual_ranks.map(r => r.rank),
    0
  )

  for (let rank = 1; rank <= maxRank; rank++) {
    const aCount = a.individual_ranks.filter(r => r.rank === rank).length
    const bCount = b.individual_ranks.filter(r => r.rank === rank).length
    if (bCount !== aCount) return bCount - aCount // more high placements wins
  }

  return 0 // true tie
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/tabulate.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/tabulate.ts tests/engine/tabulate.test.ts
git commit -m "feat: rewrite tabulation engine to use Irish Points scoring"
```

---

### Task 5: Update recalls to use percentage + tests

**Files:**
- Modify: `src/lib/engine/recalls.ts`
- Modify: `tests/engine/recalls.test.ts`

- [ ] **Step 1: Write new recall tests with percentage-based logic**

Replace `tests/engine/recalls.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { generateRecalls, type TabulationResult } from '@/lib/engine/recalls'

describe('generateRecalls (percentage-based)', () => {
  const results: TabulationResult[] = [
    { dancer_id: 'a', final_rank: 1, total_points: 200, individual_ranks: [] },
    { dancer_id: 'b', final_rank: 2, total_points: 180, individual_ranks: [] },
    { dancer_id: 'c', final_rank: 3, total_points: 160, individual_ranks: [] },
    { dancer_id: 'd', final_rank: 4, total_points: 140, individual_ranks: [] },
    { dancer_id: 'e', final_rank: 5, total_points: 120, individual_ranks: [] },
    { dancer_id: 'f', final_rank: 6, total_points: 100, individual_ranks: [] },
  ]

  it('recalls top 50% of dancers', () => {
    const recalled = generateRecalls(results, 50)
    // 50% of 6 = 3
    expect(recalled).toHaveLength(3)
    expect(recalled.map(r => r.dancer_id)).toEqual(['a', 'b', 'c'])
  })

  it('rounds up recall count (ceil)', () => {
    // 5 dancers at 50% = 2.5 → ceil = 3
    const fiveResults = results.slice(0, 5)
    const recalled = generateRecalls(fiveResults, 50)
    expect(recalled).toHaveLength(3)
  })

  it('returns empty when percent is 0', () => {
    expect(generateRecalls(results, 0)).toEqual([])
  })

  it('includes tied dancers at the cutoff (tie-bubble expansion)', () => {
    const tiedResults: TabulationResult[] = [
      { dancer_id: 'a', final_rank: 1, total_points: 200, individual_ranks: [] },
      { dancer_id: 'b', final_rank: 2, total_points: 180, individual_ranks: [] },
      { dancer_id: 'c', final_rank: 3, total_points: 160, individual_ranks: [] },
      { dancer_id: 'd', final_rank: 3, total_points: 160, individual_ranks: [] },
      { dancer_id: 'e', final_rank: 5, total_points: 120, individual_ranks: [] },
      { dancer_id: 'f', final_rank: 6, total_points: 100, individual_ranks: [] },
    ]
    // 50% of 6 = 3. Top 3 by rank → ranks 1,2,3. But c and d are both rank 3.
    const recalled = generateRecalls(tiedResults, 50)
    expect(recalled).toHaveLength(4)
    expect(recalled.map(r => r.dancer_id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns all dancers when percent is 100', () => {
    const recalled = generateRecalls(results, 100)
    expect(recalled).toHaveLength(6)
  })

  it('handles empty results', () => {
    expect(generateRecalls([], 50)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/recalls.test.ts`
Expected: FAIL — old signature and TabulationResult shape

- [ ] **Step 3: Rewrite recalls.ts with percentage-based logic**

Replace `src/lib/engine/recalls.ts`:

```typescript
import { type TabulationResult } from './tabulate'
export type { TabulationResult } from './tabulate'

/**
 * Generate recalls for the top N% of dancers.
 * Includes tie-bubble expansion: if dancers are tied at the cutoff rank,
 * all tied dancers are recalled.
 *
 * @param results - Tabulation results (must have final_rank assigned)
 * @param recallTopPercent - Percentage of dancers to recall (0-100)
 */
export function generateRecalls(
  results: TabulationResult[],
  recallTopPercent: number
): TabulationResult[] {
  if (recallTopPercent <= 0 || results.length === 0) return []

  const recallCount = Math.ceil(results.length * recallTopPercent / 100)

  const sorted = [...results].sort((a, b) => a.final_rank - b.final_rank)
  const cutoffRank = sorted[Math.min(recallCount - 1, sorted.length - 1)].final_rank

  return sorted.filter(r => r.final_rank <= cutoffRank)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/recalls.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Run all engine tests together**

Run: `npx vitest run tests/engine/`
Expected: All tests PASS (irish-points, rank-judges, tabulate, recalls)

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/recalls.ts tests/engine/recalls.test.ts
git commit -m "feat: update recalls to use percentage-based threshold"
```

---

## Chunk 2: Schema + UI Updates (Tasks 6–12)

These tasks update the database schema and UI components. Tasks 7–11 are independent of each other and can be parallelized.

### Task 6: Schema migration SQL

**Files:**
- Create: `supabase/migrations/002_irish_points.sql`
- Modify: `supabase/migrations/combined.sql` (append)

- [ ] **Step 1: Write migration SQL**

Create `supabase/migrations/002_irish_points.sql`:

```sql
-- Irish Points refactor: new columns for flagging, sign-off, teacher tracking (number release column exists but unused in Phase 1)

ALTER TABLE dancers ADD COLUMN IF NOT EXISTS teacher_name text;

ALTER TABLE score_entries ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false;
ALTER TABLE score_entries ADD COLUMN IF NOT EXISTS flag_reason text;

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS numbers_released boolean NOT NULL DEFAULT false;  -- NOTE: Column exists but is unused in Phase 1. Number release deferred (2026-03-18).

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS judge_sign_offs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Update default rule_set config
UPDATE rule_sets
SET config = '{
  "score_min": 0,
  "score_max": 100,
  "scoring_method": "irish_points",
  "tie_breaker": "countback",
  "recall_top_percent": 50,
  "drop_high": false,
  "drop_low": false
}'::jsonb,
scoring_method = 'irish_points'
WHERE name = 'Default - Raw Score Average';

UPDATE rule_sets
SET name = 'Default - Irish Points'
WHERE name = 'Default - Raw Score Average';
```

- [ ] **Step 2: Append to combined.sql**

Append the new ALTER statements to the end of `supabase/migrations/combined.sql` (after the existing content) so both files stay in sync.

- [ ] **Step 3: Copy migration SQL to clipboard for user to run in Supabase SQL Editor**

Run: `cat supabase/migrations/002_irish_points.sql | pbcopy`

Tell user: "Migration SQL copied to clipboard. Paste it into the Supabase SQL Editor and run it."

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/002_irish_points.sql supabase/migrations/combined.sql
git commit -m "feat: add schema migration for Irish Points refactor"
```

---

### Task 7: Update score entry form with flagging

**Files:**
- Modify: `src/components/score-entry-form.tsx`

- [ ] **Step 1: Update ScoreEntryFormProps and add flag UI**

Update `src/components/score-entry-form.tsx`. Add to props:

```typescript
interface ScoreEntryFormProps {
  dancerId: string
  dancerName: string
  competitorNumber: string
  existingScore?: number | null
  existingFlagged?: boolean
  existingFlagReason?: string | null
  scoreMin: number
  scoreMax: number
  onSubmit: (dancerId: string, score: number, flagged: boolean, flagReason: string | null) => Promise<void>
  locked?: boolean
}
```

Add state variables for flag:

```typescript
const [flagged, setFlagged] = useState(existingFlagged ?? false)
const [flagReason, setFlagReason] = useState(existingFlagReason ?? '')
```

Update `handleSave` to pass flag data:

```typescript
await onSubmit(dancerId, num, flagged, flagged ? flagReason || null : null)
```

Add flag checkbox and reason dropdown after the score input, before the Save button:

```tsx
<label className="flex items-center gap-1.5 cursor-pointer">
  <input
    type="checkbox"
    checked={flagged}
    onChange={e => setFlagged(e.target.checked)}
    disabled={locked}
    className="accent-feis-orange"
  />
  <span className="text-xs text-muted-foreground">Flag</span>
</label>
{flagged && (
  <select
    value={flagReason}
    onChange={e => setFlagReason(e.target.value)}
    disabled={locked}
    className="text-xs border rounded px-1 py-0.5"
  >
    <option value="">Reason...</option>
    <option value="early_start">Early Start</option>
    <option value="did_not_complete">Did Not Complete</option>
    <option value="other">Other</option>
  </select>
)}
```

When flagged, add visual indicator — the row border turns orange:

```tsx
className={`flex items-center gap-3 p-3 rounded-md border transition-colors ${
  flagged
    ? 'border-feis-orange/60 bg-feis-orange/5'
    : 'hover:bg-feis-green-light/50'
}`}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
(May show errors in pages that call ScoreEntryForm with old props — these are fixed in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add src/components/score-entry-form.tsx
git commit -m "feat: add infraction flagging to score entry form"
```

---

### Task 8: Update judge scoring page with sign-off

**Files:**
- Modify: `src/app/dashboard/judge/[eventId]/[compId]/page.tsx`

- [ ] **Step 1: Update handleScoreSubmit to pass flag data**

Update the `handleScoreSubmit` function to accept and save flag data:

```typescript
async function handleScoreSubmit(dancerId: string, score: number, flagged: boolean, flagReason: string | null) {
  if (!judgeId || !round) return

  await supabase.from('score_entries').upsert(
    {
      round_id: round.id,
      competition_id: compId,
      dancer_id: dancerId,
      judge_id: judgeId,
      raw_score: score,
      flagged,
      flag_reason: flagReason,
    },
    { onConflict: 'round_id,dancer_id,judge_id' }
  )

  loadData()
}
```

- [ ] **Step 2: Update ScoreEntryForm calls to pass existing flag data**

```tsx
<ScoreEntryForm
  key={reg.id}
  dancerId={reg.dancer_id}
  dancerName={`${reg.dancers?.first_name} ${reg.dancers?.last_name}`}
  competitorNumber={reg.competitor_number}
  existingScore={existing?.raw_score}
  existingFlagged={existing?.flagged ?? false}
  existingFlagReason={existing?.flag_reason}
  scoreMin={scoreMin}
  scoreMax={scoreMax}
  onSubmit={handleScoreSubmit}
  locked={submitted}
/>
```

- [ ] **Step 3: Replace "Submit All Scores" with "Sign Off Round"**

Replace `handleFinalSubmit` with `handleSignOff`:

```typescript
async function handleSignOff() {
  if (!judgeId || !round) return

  // Lock all scores for this judge/round
  await supabase
    .from('score_entries')
    .update({ locked_at: new Date().toISOString() })
    .eq('round_id', round.id)
    .eq('judge_id', judgeId)

  // Record sign-off in round's judge_sign_offs jsonb
  const currentSignOffs = round.judge_sign_offs || {}
  const updatedSignOffs = {
    ...currentSignOffs,
    [judgeId]: new Date().toISOString(),
  }
  await supabase
    .from('rounds')
    .update({ judge_sign_offs: updatedSignOffs })
    .eq('id', round.id)

  // Check if all judges have now signed off — if so, advance competition to ready_to_tabulate
  const { data: allJudges } = await supabase
    .from('judges')
    .select('id')
    .eq('event_id', eventId)
  const allJudgeIds = allJudges?.map(j => j.id) ?? []
  const allDone = allJudgeIds.length > 0 && allJudgeIds.every(id => updatedSignOffs[id])

  if (allDone) {
    const { data: currentComp } = await supabase
      .from('competitions')
      .select('status')
      .eq('id', compId)
      .single()
    if (currentComp?.status === 'awaiting_scores') {
      await supabase
        .from('competitions')
        .update({ status: 'ready_to_tabulate' })
        .eq('id', compId)
    }
  }

  setSubmitted(true)
}
```

Update the button text:

```tsx
<Button
  onClick={handleSignOff}
  disabled={scoredCount < totalDancers}
  className="w-full text-lg font-semibold"
  size="lg"
>
  {scoredCount < totalDancers
    ? `Score all dancers to sign off (${scoredCount}/${totalDancers})`
    : 'Sign Off Round'}
</Button>
```

Update the submitted confirmation message:

```tsx
<p className="text-lg font-medium text-feis-green">Round signed off. Scores locked.</p>
```

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/judge/[eventId]/[compId]/page.tsx
git commit -m "feat: add judge sign-off workflow and flag support to scoring page"
```

---

### Task 9: Update competition detail page

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx`

This task updates: (a) sign-off gate before tabulation, (b) Irish Points display in results, (c) recall percentage-based generation.

> **Number release toggle removed from Phase 1 scope (2026-03-18).** The `numbers_released` DB column exists but is unused. Number visibility gating is deferred until it can be implemented as a real cross-surface feature.

- [ ] ~~**Step 1: Add number release toggle**~~ — **SKIPPED (removed from scope 2026-03-18)**

- [ ] **Step 2: Add sign-off status display and gate tabulation**

In the Rounds section, show sign-off status per judge for each round. Add after the round info badges:

```tsx
{judges.map((j: any) => {
  const signedOff = round.judge_sign_offs?.[j.id]
  return (
    <span key={j.id} className={`text-xs px-2 py-0.5 rounded ${signedOff ? 'bg-feis-green-light text-feis-green' : 'bg-gray-100 text-gray-500'}`}>
      {j.first_name}: {signedOff ? 'Signed off' : 'Pending'}
    </span>
  )
})}
```

Add state for judges (load them in `loadData`):

```typescript
const [judges, setJudges] = useState<any[]>([])

// In loadData, add:
const judgesRes = await supabase.from('judges').select('*').eq('event_id', eventId)
setJudges(judgesRes.data ?? [])
```

Gate the tabulate button: disable unless all judges have signed off for the latest round:

```typescript
const latestRound = rounds[rounds.length - 1]
const allSignedOff = latestRound && judges.length > 0 &&
  judges.every((j: any) => latestRound.judge_sign_offs?.[j.id])
```

```tsx
<Button onClick={handleTabulate} variant="default" disabled={!allSignedOff}>
  {allSignedOff ? 'Run Tabulation' : 'Waiting for judge sign-offs...'}
</Button>
```

- [ ] **Step 3: Update handleTabulate to use Irish Points**

The tabulate function signature hasn't changed (still takes `ScoreInput[]` and `RuleSetConfig`), but need to pass `flagged` field and use new `TabulationResult` shape:

```typescript
const roundScores: ScoreInput[] = scores
  .filter(s => s.round_id === latestRound.id)
  .map(s => ({
    dancer_id: s.dancer_id,
    judge_id: s.judge_id,
    raw_score: Number(s.raw_score),
    flagged: s.flagged ?? false,
  }))

const tabulationResults = tabulate(roundScores, ruleset)

for (const r of tabulationResults) {
  await supabase.from('results').upsert(
    {
      competition_id: compId,
      dancer_id: r.dancer_id,
      final_rank: r.final_rank,
      display_place: String(r.final_rank),
      calculated_payload: {
        total_points: r.total_points,
        individual_ranks: r.individual_ranks,
      },
    },
    { onConflict: 'competition_id,dancer_id' }
  )
}
```

- [ ] **Step 4: Update handleGenerateRecalls to use percentage**

```typescript
async function handleGenerateRecalls() {
  if (!ruleset || !comp) return
  if (!ruleset.recall_top_percent) return

  const currentStatus = comp.status as CompetitionStatus
  if (!canTransition(currentStatus, 'recalled_round_pending')) return

  const latestRound = rounds[rounds.length - 1]
  if (!latestRound) return

  const roundScores: ScoreInput[] = scores
    .filter(s => s.round_id === latestRound.id)
    .map(s => ({
      dancer_id: s.dancer_id,
      judge_id: s.judge_id,
      raw_score: Number(s.raw_score),
      flagged: s.flagged ?? false,
    }))

  const tabulationResults = tabulate(roundScores, ruleset)
  const recalled = generateRecalls(tabulationResults, ruleset.recall_top_percent)

  // ... rest stays the same (upsert recalls, create next round, update status)
}
```

Update the recall button label:

```tsx
{ruleset && ruleset.recall_top_percent > 0 && (
  <Button onClick={handleGenerateRecalls} variant="outline">
    Generate Recalls (Top {ruleset.recall_top_percent}%)
  </Button>
)}
```

- [ ] **Step 5: Update results display to show Irish Points**

Change the Score column header to "Points" and display `total_points`:

```tsx
<th className="px-4 py-2 text-right">Points</th>
```

```tsx
<td className="px-4 py-2 text-right">
  {r.calculated_payload?.total_points ?? '—'}
</td>
```

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx
git commit -m "feat: add sign-off gate and Irish Points display"
```

---

### Task 10: Update registration page with teacher name

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/register/page.tsx`

- [ ] **Step 1: Add teacher name state and field**

Add state:

```typescript
const [teacherName, setTeacherName] = useState('')
```

Add field in the Dancer Information card, after the school field (make it a 2-col grid row):

```tsx
<div>
  <Label htmlFor="teacherName" className="font-medium text-sm text-feis-charcoal">Teacher Name</Label>
  <Input id="teacherName" value={teacherName} onChange={e => setTeacherName(e.target.value)} />
</div>
```

- [ ] **Step 2: Pass teacher name in dancer insert**

Update both the dancer insert (new dancers) and the existing dancer path to include `teacher_name`:

For existing dancers, add an update after finding the match:

```typescript
if (existingDancers && existingDancers.length > 0) {
  dancerId = existingDancers[0].id
  // Update teacher_name if provided
  if (teacherName) {
    await supabase.from('dancers').update({ teacher_name: teacherName }).eq('id', dancerId)
  }
}
```

For new dancers:

```typescript
const { data: newDancer, error: dancerErr } = await supabase
  .from('dancers')
  .insert({
    first_name: firstName,
    last_name: lastName,
    school_name: school || null,
    teacher_name: teacherName || null,
  })
  .select()
  .single()
```

Reset teacher name on success:

```typescript
setTeacherName('')
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/events/[eventId]/register/page.tsx
git commit -m "feat: add teacher name field to registration"
```

---

### Task 11: Update results table and public results to show Irish Points

**Files:**
- Modify: `src/components/results-table.tsx`
- Modify: `src/app/results/[eventId]/page.tsx`

- [ ] **Step 1: Update ResultsTable component**

Update `src/components/results-table.tsx`:

```typescript
interface ResultRow {
  final_rank: number
  dancers: { first_name: string; last_name: string } | null
  calculated_payload: { total_points?: number } | null
}
```

Change the header and data cell:

```tsx
<th className="px-4 py-2 text-right">Points</th>
```

```tsx
<td className="px-4 py-2 text-right">
  {r.calculated_payload?.total_points ?? '—'}
</td>
```

- [ ] **Step 2: Update public results page NormalizedResult**

In `src/app/results/[eventId]/page.tsx`, update the `NormalizedResult` interface:

```typescript
interface NormalizedResult {
  final_rank: number
  calculated_payload: { total_points?: number } | null
  published_at: string | null
  dancers: { first_name: string; last_name: string } | null
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/results-table.tsx src/app/results/[eventId]/page.tsx
git commit -m "feat: display Irish Points totals in results tables"
```

---

### Task 12: Update seed data and CLAUDE.md

**Files:**
- Modify: `supabase/seed.sql`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update seed data**

Add `teacher_name` to dancer inserts. Update score_entries to include `flagged` defaults. No structural changes needed since ALTER TABLE adds defaults.

Add to seed.sql after the existing content, or update dancer inserts to include teacher_name:

```sql
-- Update dancers with teacher names
UPDATE dancers SET teacher_name = 'Colm Murphy' WHERE school_name = 'Scoil Rince Ni Bhriain';
UPDATE dancers SET teacher_name = 'Fiona McGrath' WHERE school_name = 'McGrath Academy';
UPDATE dancers SET teacher_name = 'Sean Claddagh' WHERE school_name = 'Claddagh School of Dance';
```

- [ ] **Step 2: Update CLAUDE.md**

In the Architecture Rules section, update:

- Change "Integer math for scores" to reference Irish Points:

```markdown
### Irish Points scoring is the standard
The tabulation engine converts raw scores to ranks per judge, then to Irish Points
via the standard lookup table (1st=100, 2nd=75, 3rd=65... 50th=1).
Tied ranks get averaged points. All comparisons use integer math (×1000).
```

- Add new rule:

```markdown
### Judge sign-off before tabulation
Tabulation cannot run until all judges have signed off their scores for the round.
Sign-offs are stored in `rounds.judge_sign_offs` as a JSON map of judge_id → timestamp.
```

- Remove references to `raw_score_average` and `highest_individual` tie-breaking.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Run full build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql CLAUDE.md
git commit -m "chore: update seed data and CLAUDE.md for Irish Points refactor"
```
