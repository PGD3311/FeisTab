# FeisTab — Project Rules

**Goal: Kill the envelope. Replace paper chaos with a connected digital flow from registration desk to published results.**

**The Phase 1 chain:** check-in → side-stage → judge scores → tabulation → anomaly checks → verification → sign-off → official results

## Tech Stack
- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui v4
- **Backend:** Supabase (Postgres + Auth + RLS)
- **Testing:** Vitest (unit)
- **Hosting:** Vercel

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

### 1.1 Score Integrity
- **Irish Points is the only scoring method.** Raw scores → per-judge rank → Irish Points lookup. Tied ranks get averaged points.
- **Integer math (×1000) for all score comparisons.** Never compare float totals with `===`. Use `Math.round(value * PRECISION)`.
- **Flagged scores get rank=last and 0 points.**
- **Results are computed, never stored manually.** `score_entries` → tabulation engine → `results` table.

### 1.2 Competition State Machine
- **All status changes go through `canTransition()`** in `src/lib/competition-states.ts`.
- **Sign-off gate:** Tabulation cannot run until all judges have signed off.

### 1.3 Supabase Client Usage
- **Server components / route handlers:** `createClient()` from `src/lib/supabase/server.ts`
- **Client components:** `useSupabase()` hook from `src/hooks/use-supabase.ts`
- **NEVER** call `createBrowserClient` directly inside a component body.

### 1.4 Code Purity
- **Engine logic (`src/lib/engine/`)** — pure functions only. No Supabase, no React, no side effects.
- **CSV parsing (`src/lib/csv/`)** — same rules.
- **Database queries happen in pages/route handlers only**, not in `src/lib/` or `src/components/`.

### 1.5 Error Handling
- **Always check `.error` on Supabase responses.**
- **Form submissions use try/catch.**
- **Every page must have a loading state.**

### 1.6 TypeScript Strictness
- **No `any` types in new code.** Legacy exemptions marked with `// TODO: type when Supabase types generated`.

---

## 2. Scope

**Only Phase 1 exists now** — everything needed to run one feis day from door to results.

**Do not build Phase 2/3 features:** no registration portals, school pages, payment, SMS, live streaming. If it doesn't serve check-in → scoring → tabulation → results, it's out of scope.

---

## 3. Forbidden Actions

- Don't bypass the state machine — every status change goes through `canTransition()`
- Don't put Supabase calls in engine or CSV code
- Don't put database queries in components — queries go in pages/route handlers
- Don't add auth middleware, login pages, or RLS policies (prototype uses hardcoded context)
- Don't add features not explicitly requested
- Don't skip `npm run build` before saying "done"
- Don't commit `any` types in new code or dead code

---

## 4. Conventions

### Naming
| Type | Convention | Example |
|---|---|---|
| Files | kebab-case | `rank-judges.ts` |
| Components | PascalCase named exports | `export function ScoreEntryForm()` |
| Hooks | `use` prefix, camelCase | `useSupabase` |
| Types | PascalCase | `ScoreInput`, `RuleSetConfig` |
| Functions | camelCase | `rankByJudge`, `canTransition` |
| Constants | UPPER_SNAKE_CASE | `PRECISION` |
| DB fields | snake_case | `dancer_id`, `raw_score` |
| CSS classes | `feis-` prefix | `feis-card`, `feis-place-1` |

### Server vs Client
- **Server** (default): pages that only fetch/render. Use `createClient()` from `server.ts`. Add `export const dynamic = 'force-dynamic'` for Supabase queries.
- **Client** (`'use client'`): pages with interactivity. Use `useSupabase()` hook. Fetch in `useEffect`.

### Design Tokens
All brand colors defined as CSS custom properties in `src/app/globals.css` under `@theme inline`. Use Tailwind classes (e.g., `bg-feis-green`, `text-feis-orange`). Visual identity: "Precision Utility" — Outfit font, cool neutral palette, flat panels, monospace for data.

### Import Order
1. React / Next.js → 2. Third-party → 3. `@/lib/` → 4. `@/hooks/` → 5. `@/components/`

All project imports use the `@/` alias.

---

## 5. Testing

### Must be tested
- **Engine code** (`src/lib/engine/`) — every public function
- **CSV parser** (`src/lib/csv/`) — valid input, missing fields, edge cases
- **State machine** — valid transitions, invalid transitions, happy path

### Doesn't need tests yet
- React components, page-level integration (manual testing during prototype)

---

## 6. Tooling
- **Prettier:** single quotes, no trailing commas, 2-space indent, 100 char width
- **Pre-commit (Husky + lint-staged):** Prettier + ESLint + `tsc --noEmit` on staged files
- **Commits:** conventional commits (`feat:`, `fix:`, `test:`, `refactor:`), one logical change per commit
