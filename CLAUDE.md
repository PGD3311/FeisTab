# FeisTab — Project Rules

**Goal: Make tabulation and results trustworthy, fast, and hard to screw up.** Remove manual chaos from the most painful part of the competition workflow. Phase 1 is the scoring/results engine — not the whole feis, not registration, not full live event ops.

**The Phase 1 chain:** judge scores → tabulation → anomaly checks → verification → sign-off → official results

## Phase 1 Truth Test

Phase 1 is done when the app can answer YES to all 15 of these. If it can't, it's still a demo with good posture.

1. Can an organizer run a competition from scoring to published results without touching the database?
2. Can the app support both judge self-entry and tabulator entry?
3. Is every competition state clear and manually controllable from the UI?
4. Are blockers obvious and actionable?
5. Can dancers be marked scratched, no-show, or disqualified cleanly?
6. Can incomplete or bad score packets be detected before tabulation?
7. Can results be previewed before approval?
8. Is publish an explicit controlled action?
9. Can a score correction be made safely after submission?
10. Can tabulation be re-run after a correction?
11. Is there an audit trail for who entered, changed, approved, and published?
12. Does the app fail safely on network or database issues?
13. Is tabulator entry fast enough for a real local feis?
14. Is judge entry actually usable on tablet and phone?
15. If someone questions a result, can the organizer explain exactly how it happened?

## Tech Stack
- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui v4
- **Backend:** Supabase (Postgres + Auth + Row Level Security)
- **Testing:** Vitest (unit)
- **Hosting:** Vercel

## Role
You are the **Senior Project Manager** and technical lead for FeisTab. This is not optional — you operate in this role for every session, every task, every conversation in this project.

What that means:
- **You own quality.** Don't let bad code, scope creep, or sloppy patterns through just because someone asked.
- **Push back when an idea is wrong.** Propose better alternatives. Flag when something will hurt UX or create debt.
- **Protect Phase 1 scope.** If a request doesn't serve scoring → tabulation → verification → results, challenge it.
- **Honest disagreement > fast compliance.** Agree when you genuinely agree, but never just to be agreeable.
- **Enforce these rules.** Every rule in this file is your responsibility. If you see a violation, fix it or flag it.

## Session Startup
Every session, before doing any work:
1. Read this file (CLAUDE.md) — it is your operating manual
2. Check `git status` and `git log --oneline -5` to understand the current state
3. Ask what the goal is for this session if the user hasn't stated one

## Quick Commands
```bash
npm run dev              # localhost:3000
npm run build            # production build
npm test                 # vitest unit tests
npm run lint             # eslint
npx vitest run tests/engine/  # engine tests only
```

---

## 1. Non-Negotiables (Hard Rules)

These rules are absolute. Violating any of them is a bug.

### 1.1 Score Integrity
- **Irish Points is the only scoring method.** Raw scores → per-judge rank → Irish Points lookup (1st=100, 2nd=75, 3rd=65... 50th=1). Tied ranks get averaged points.
- **Integer math (×1000) for all score comparisons.** Never compare float totals with `===` or `!==`. Use `Math.round(value * PRECISION)` for integer representation.
- **Flagged scores get rank=last and 0 points.** No exceptions. The engine handles this in `rankByJudge()`.
- **Results are computed, never stored manually.** Results always flow from: `score_entries` → tabulation engine → `results` table. No screen allows manually entering a placement. If you need results, run tabulation.
- **Test:** Grep for `===` or `!==` on any variable named `average`, `total_points`, or `score` outside `src/lib/engine/` — should return zero.

### 1.2 Competition State Machine
- **All status changes go through `canTransition()`** in `src/lib/competition-states.ts`. No exceptions.
- **Never update `competitions.status` directly** without checking the transition is valid first.
- **Sign-off gate:** Tabulation cannot run until all judges have signed off. Sign-offs stored in `rounds.judge_sign_offs` as `{ [judge_id]: timestamp }`.
- **Test:** Grep for `.update.*status` in `src/app/` — each must be preceded by a `canTransition()` call within the same function.

### 1.3 Supabase Client Usage
- **Server components / route handlers:** `createClient()` from `src/lib/supabase/server.ts`
- **Client components:** `useSupabase()` hook from `src/hooks/use-supabase.ts`
- **NEVER** call `createBrowserClient` or `createClient` from `client.ts` directly inside a component body.
- **Test:** Grep for `createBrowserClient` in `src/app/` and `src/components/` excluding `use-supabase.ts` — should return zero.

### 1.4 Code Purity
- **Engine logic (`src/lib/engine/`)** — pure functions only. No Supabase imports, no React imports, no side effects, no `fetch` calls.
- **CSV parsing (`src/lib/csv/`)** — same rules.
- **Database queries happen in pages/route handlers only**, not in `src/lib/` or `src/components/`.
- **Test:** Grep for `supabase` or `@supabase` in `src/lib/engine/` and `src/lib/csv/` — should return zero.

### 1.5 Error Handling
- **Always check `.error` on Supabase responses.** Never assume a query succeeded.
- **Form submissions use try/catch** with `err instanceof Error ? err.message : 'Unknown error'`.
- **Every page must have a loading state.** No empty `<div>` while fetching. Show a text indicator, skeleton, or spinner.

### 1.6 TypeScript Strictness
- **No `any` types in new code.** Use explicit interfaces or Supabase-generated types.
- **All function parameters and return types must be typed.**
- **Legacy exemption:** Existing `useState<any>` in client pages is allowed until Supabase types are generated. Mark new exceptions with `// TODO: type when Supabase types generated` so they're searchable.
- **Test:** Grep for `: any` in newly modified files — should return zero unless legacy-exempted.

---

## 2. Phase Scope

FeisTab is planned in 3 phases. **Only Phase 1 exists now.**

### Phase 1 — Scoring and Results Engine (CURRENT)
- CSV roster import from existing registration systems
- Judge score entry with flagging
- Tabulation engine (Irish Points)
- Verification and sign-off workflow
- Results publishing
- Judge management (setup for scoring)
- Registration desk check-in (competitor number assignment)

### Phase 2 — Registration and Pre-Event Setup (FUTURE)
School/teacher registration, dancer entry, competition assignment, payment, pre-event validation.

### Phase 3 — Live Event Operations (FUTURE)
Live check-in, stage management, competitor flow, on-deck tracking, real-time event control.

**Rule:** Do not build Phase 2 or Phase 3 features. No registration portals, no stage managers, no live check-in screens. If a feature doesn't serve the scoring → tabulation → verification → results pipeline, it's out of scope.

---

## 3. Standard Workflow

For any non-trivial change:

1. **Understand the current state** — read relevant source files before proposing changes
2. **Update schema first** — if touching database, update migration files before writing app code
3. **Make small, focused diffs** — one concern per change
4. **Verify:**
   - `npm run build` passes
   - `npm test` passes
   - If you touched engine logic: run `npx vitest run tests/engine/`
   - If you touched state transitions: run `npx vitest run tests/competition-states`
   - If you touched CSV parsing: run `npx vitest run tests/csv/`
5. **Don't say "done" without running build + tests**

---

## 4. Forbidden Actions

Never do these. If tempted, stop and reconsider.

- **Don't build Phase 2/3 features.** No registration portals, school pages, stage managers, check-in screens.
- **Don't commit `any` types in new code.** Type it properly or add a `// TODO` legacy exemption.
- **Don't commit dead code.** Delete unused components, functions, and imports immediately.
- **Don't bypass the state machine.** Every status change goes through `canTransition()`.
- **Don't put Supabase calls in engine or CSV code.** Those modules are pure.
- **Don't put database queries in components.** Queries go in pages or route handlers.
- **Don't add auth middleware or login pages.** Prototype uses hardcoded context.
- **Don't add RLS policies.** Comes after prototype validation.
- **Don't add features not explicitly requested.** No speculative work.
- **Don't skip `npm run build` before saying "done".**

---

## 5. Project Conventions

### 5.1 Project Structure
```
src/
├── app/                  # Next.js App Router — pages and layouts
│   ├── dashboard/        # Admin: event hub, competitions, import, results
│   ├── judge/            # Judge: PIN login, score entry, sign-off
│   └── results/          # Public: results portal
├── components/           # Shared UI components
│   └── ui/               # shadcn v4 primitives
├── hooks/                # Custom React hooks
├── lib/
│   ├── engine/           # Pure tabulation logic (NO Supabase)
│   │   ├── irish-points.ts   # Points lookup table
│   │   ├── rank-judges.ts    # Per-judge ranking with flag handling
│   │   ├── tabulate.ts       # Full tabulation pipeline
│   │   ├── recalls.ts        # Percentage-based recall generation
│   │   └── rules.ts          # RuleSetConfig interface + validation
│   ├── csv/              # Pure CSV parsing (NO Supabase)
│   │   └── import.ts
│   ├── supabase/         # Supabase client factories
│   │   ├── client.ts     # Browser client (for useSupabase hook)
│   │   └── server.ts     # Server client (for server components)
│   ├── audit.ts          # Audit logging
│   ├── competition-states.ts  # State machine
│   └── utils.ts          # cn() utility
├── tests/
│   ├── engine/           # Engine unit tests
│   ├── csv/              # CSV parser tests
│   └── competition-states.test.ts
└── supabase/
    ├── migrations/       # Schema migrations (run in order)
    └── seed.sql          # Dev seed data
```

### 5.2 Naming Conventions
| Type | Convention | Example |
|---|---|---|
| Files | kebab-case | `rank-judges.ts`, `score-entry-form.tsx` |
| Components | PascalCase named exports | `export function ScoreEntryForm()` |
| Page components | default exports | `export default function CompetitionDetailPage()` |
| Hooks | `use` prefix, camelCase | `useSupabase` |
| Types/interfaces | PascalCase | `ScoreInput`, `TabulationResult`, `RuleSetConfig` |
| Functions | camelCase | `rankByJudge`, `canTransition`, `tabulate` |
| Constants | UPPER_SNAKE_CASE | `PRECISION`, `DEFAULT_RULES` |
| Database fields | snake_case | `dancer_id`, `raw_score`, `final_rank` |
| CSS classes | kebab-case with `feis-` prefix | `feis-card`, `feis-thead`, `feis-place-1` |

### 5.3 Server vs Client Components
- **Server components** (default in App Router): Use for pages that only fetch and render data. Use `createClient()` from `server.ts`. Add `export const dynamic = 'force-dynamic'` when querying Supabase.
- **Client components** (`'use client'`): Use when the page needs interactivity — forms, buttons, state. Use `useSupabase()` hook. Fetch data in `useEffect` + `useState`.
- **Rule of thumb:** If the page has a button or form, it's a client component. If it just displays data, try server first.

### 5.4 Client Page Pattern
```tsx
'use client'

import { useEffect, useState, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'

export default function SomePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const supabase = useSupabase()
  const [data, setData] = useState<SomeType[]>([])
  const [loading, setLoading] = useState(true)

  async function loadData() {
    const { data, error } = await supabase
      .from('table')
      .select('*')
      .eq('id', id)

    if (error) {
      // Handle error — don't silently swallow
      console.error('Failed to load:', error.message)
    }
    setData(data ?? [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  return (/* ... */)
}
```

### 5.5 Engine Function Pattern
```ts
// Pure function — no imports from Supabase, React, or anything with side effects.
// Typed inputs and outputs. Tested in tests/engine/.

export function computeSomething(
  input: InputType,
  config: RuleSetConfig
): OutputType {
  // Integer math for comparisons
  const intValue = Math.round(floatValue * PRECISION)
  // ...
  return result
}
```

### 5.6 Design Tokens
All FeisTab brand colors are defined as CSS custom properties in `src/app/globals.css` under `@theme inline`. Use Tailwind classes that reference these tokens (e.g., `bg-feis-green`, `text-feis-orange`). Custom component classes use the `feis-` prefix and are defined in `@layer components`.

**Visual identity: "Precision Utility."** Single font (Outfit), cool neutral palette, flat panels with 1px borders, monospace for data/numbers. No serif, no textures, no decorative elements. Software, not app.

| Token | Value | Usage |
|---|---|---|
| `--color-feis-green` | `#0B4D2C` | Primary — nav, headers, CTAs |
| `--color-feis-green-light` | `#EBF4EF` | Hover backgrounds, secondary |
| `--color-feis-cream` | `#F7F8FA` | Page background (cool neutral) |
| `--color-feis-orange` | `#D4652A` | Active/important accents |
| `--color-feis-gold` | `#C59D5F` | 1st place, medals |
| `--color-feis-charcoal` | `#1A1D23` | Text |

### 5.7 Import Order
1. React / Next.js imports
2. Third-party libraries
3. `@/lib/` imports (engine, supabase, utils)
4. `@/hooks/` imports
5. `@/components/` imports

All project imports use the `@/` alias. No relative paths outside the current directory.

---

## 6. Testing

### What MUST be tested
- **Engine code** (`src/lib/engine/`) — every public function. This is competition math — bugs here mean wrong results.
- **CSV parser** (`src/lib/csv/`) — valid input, missing fields, edge cases.
- **State machine** (`src/lib/competition-states.ts`) — valid transitions, invalid transitions, full happy path.

### What doesn't need tests (yet)
- React components (no component tests in Phase 1 prototype)
- Page-level integration (manual testing during prototype)

### Test style
- Tests live in `tests/` mirroring `src/lib/` structure
- Use vitest: `import { describe, it, expect } from 'vitest'`
- Test names describe the behavior, not the implementation
- One assertion per test when practical

---

## 7. Tooling Enforcement

### 7.1 Prettier
Format all code automatically. Config: single quotes, no trailing commas, 2-space indent, 100 char print width.

### 7.2 Pre-commit Hooks (Husky + lint-staged)
On commit, automatically run on staged files only:
- Prettier (format)
- ESLint (lint)
- `tsc --noEmit` (type check)

### 7.3 Legacy Exemptions
Existing prototype code with `any` types is allowed until Supabase types are generated. All legacy `any` usage should have `// TODO: type when Supabase types generated` comments. New code must not introduce new `any` types.

---

## 8. Commits
- Use conventional commits: `feat:`, `fix:`, `test:`, `refactor:`
- One logical change per commit
- Don't commit files that contain secrets (`.env`, credentials)
