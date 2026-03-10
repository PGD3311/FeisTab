# FeisTab — Project Rules

## What this is
Live tabulation and results engine for Irish dance competitions (feiseanna).
Spec: `docs/superpowers/specs/2026-03-10-feistab-design.md`
Plan: `docs/superpowers/plans/2026-03-10-feistab.md`

## Tech Stack
- Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- Supabase (Postgres + Auth + Row Level Security)
- Vitest for testing
- Deployed on Vercel

## Architecture Rules

### Results are computed, never stored manually
Results always flow from: score_entries → tabulation engine → results table.
No screen should allow manually entering a placement. If you need results, run tabulation.

### Competition state machine is the law
All competition status changes MUST go through `canTransition()` in `src/lib/competition-states.ts`.
Never update `competitions.status` directly without checking the transition is valid.

### Integer math for scores
The tabulation engine uses integer arithmetic (multiply by 1000) to avoid floating point comparison bugs.
Never compare score averages with `===` or `!==` on raw floats. Use the integer representations.

### Supabase client usage
- **Server components / route handlers:** use `createClient()` from `src/lib/supabase/server.ts`
- **Client components:** use `useSupabase()` hook from `src/hooks/use-supabase.ts`
- **NEVER** call `createClient()` from `src/lib/supabase/client.ts` directly inside a component body

### File organization
- One component per file, named for what it does
- Engine logic lives in `src/lib/engine/` — pure functions, no Supabase imports
- CSV parsing lives in `src/lib/csv/` — pure functions, no Supabase imports
- Database queries happen in pages/route handlers, not in lib/ or components/

## Coding Standards

### TypeScript
- No `any` types in new code. Use proper Supabase-generated types or explicit interfaces.
- All function parameters and return types must be typed.

### Testing
- Engine code (`src/lib/engine/`) MUST have tests in `tests/engine/`.
- CSV parser MUST have tests in `tests/csv/`.
- State machine MUST have tests in `tests/`.
- Tests use vitest. Run with `npm test`.

### Commits
- Use conventional commits: `feat:`, `fix:`, `test:`, `refactor:`
- One logical change per commit

### What not to do
- Don't add auth middleware or login pages yet (prototype uses hardcoded context)
- Don't add RLS policies yet (comes after prototype validation)
- Don't create documentation files unless explicitly asked
- Don't add features beyond what the current task specifies
- Don't refactor code outside your current task scope

## Commands
- `npm run dev` — start dev server
- `npm test` — run all tests
- `npm run build` — production build
- `npx vitest run tests/engine/` — run engine tests only
