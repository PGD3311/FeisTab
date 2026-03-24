# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace prototype client-side security with production-grade Supabase Auth, event-scoped roles, RLS policies, and validated write RPCs.

**Architecture:** Supabase Auth (email/password) provides identity. An `event_roles` table maps users to events with one of four roles. All operational writes go through `SECURITY DEFINER` RPCs that validate role + assignment + lock state. RLS policies enforce row-level reads. Public results remain unauthenticated.

**Tech Stack:** Next.js 15 (App Router), Supabase Auth (`@supabase/ssr`), PostgreSQL RLS + PL/pgSQL RPCs, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-security-hardening-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `src/middleware.ts` | Auth guard — starts in permissive mode (Step 1), switches to strict (Step 5) |
| `src/app/auth/login/page.tsx` | Email + password login form with `?next=` support |
| `src/app/auth/signup/page.tsx` | Email + password + full name signup form |
| `src/app/auth/confirm/route.ts` | Supabase email confirmation callback (exchanges code for session) |
| `src/app/auth/actions.ts` | Server actions: `login()`, `signup()`, `logout()`, `fulfillInvitations()` |
| `src/lib/supabase/admin.ts` | Service-role Supabase client (server-only, for invitation checks against `auth.users`) |
| `src/lib/auth/validate-next.ts` | `?next=` param validation utility |
| `src/lib/auth/require-role.ts` | Server-side role check helper: `requireRole(eventId, allowedRoles)` |
| `supabase/migrations/024_auth_roles.sql` | Drop `user_roles`, create `event_roles` + `pending_invitations` + judge exclusivity trigger + `user_event_role()` helper |
| `supabase/migrations/025_harden_existing_rpcs.sql` | ALTER 5 existing RPCs to `SECURITY DEFINER SET search_path = public` + add role validation |
| `supabase/migrations/026_write_rpcs.sql` | New write RPCs: `create_event`, `submit_score`, `tabulator_enter_score`, `check_in_dancer`, `register_dancer`, `update_registration`, `create_round`, `update_stage_status` |
| `supabase/migrations/027_audit_triggers.sql` | Triggers on mutations to auto-insert `audit_log` + `status_changes` rows |
| `supabase/migrations/028_rls_policies.sql` | All RLS policies + narrow read functions (`judge_roster`, `side_stage_roster`, `public_feedback`) + enable RLS on all tables |
| `supabase/migrations/029_enable_rls.sql` | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for every table (separate from policies so rollback is one file) |
| `tests/auth/validate-next.test.ts` | Tests for `?next=` validation |
| `tests/auth/require-role.test.ts` | Tests for role check helper |

### Files to modify

| File | Change |
|------|--------|
| `src/lib/supabase/server.ts` | Add session refresh handling |
| `src/lib/supabase/rpc.ts` | Add wrappers for all new RPCs |
| `src/app/page.tsx` | Replace code entry with event-centered home (role-based) |
| `src/app/judge/page.tsx` | Remove access code login — redirect to `/auth/login` if unauthenticated |
| `src/app/judge/[eventId]/page.tsx` | Replace localStorage session with Supabase auth + role check |
| `src/app/judge/[eventId]/[compId]/page.tsx` | Replace direct score upsert with `submit_score` RPC |
| `src/app/dashboard/events/new/page.tsx` | Replace direct event insert with `create_event` RPC |
| `src/app/dashboard/events/[eventId]/judges/page.tsx` | Add "Team" section, replace direct judge writes with RPCs |
| `src/app/dashboard/events/[eventId]/program/page.tsx` | Replace direct stage insert with RPC |
| `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` | Replace direct round insert with RPC |
| `src/app/registration/[eventId]/page.tsx` | Replace direct check-in writes with RPCs, add role check |
| `src/app/checkin/[eventId]/page.tsx` | Replace direct writes with RPCs, add role check |
| `src/app/dashboard/page.tsx` | Replace localStorage event list with role-based query |
| `src/app/registration/[eventId]/layout.tsx` | Remove `EventGate` wrapper, add role check |
| `src/app/dashboard/events/[eventId]/layout.tsx` | Remove `EventGate` wrapper, add role check |
| `src/app/checkin/[eventId]/layout.tsx` | Remove `EventGate` wrapper, add role check |

### Files to delete

| File | Reason |
|------|--------|
| `src/components/event-gate.tsx` | Replaced by auth middleware + role checks |
| `supabase/disable_rls.sql` | RLS is now enabled — this script is dangerous |

---

## Task 1: Auth utility functions

**Files:**
- Create: `src/lib/auth/validate-next.ts`
- Create: `tests/auth/validate-next.test.ts`

- [ ] **Step 1: Write failing test for validate-next**

```typescript
// tests/auth/validate-next.test.ts
import { describe, it, expect } from 'vitest'
import { validateNextParam } from '@/lib/auth/validate-next'

describe('validateNextParam', () => {
  it('accepts valid relative paths', () => {
    expect(validateNextParam('/dashboard')).toBe('/dashboard')
    expect(validateNextParam('/judge/abc-123')).toBe('/judge/abc-123')
    expect(validateNextParam('/dashboard/events/123?tab=team')).toBe('/dashboard/events/123?tab=team')
  })

  it('rejects protocol-relative URLs', () => {
    expect(validateNextParam('//evil.com')).toBe('/')
    expect(validateNextParam('//evil.com/path')).toBe('/')
  })

  it('rejects absolute URLs', () => {
    expect(validateNextParam('https://evil.com')).toBe('/')
    expect(validateNextParam('http://evil.com')).toBe('/')
  })

  it('rejects URLs with @ (credential injection)', () => {
    expect(validateNextParam('/foo@evil.com')).toBe('/')
  })

  it('rejects URLs containing ://', () => {
    expect(validateNextParam('/redirect?url=https://evil.com')).toBe('/')
  })

  it('rejects empty/null/undefined', () => {
    expect(validateNextParam('')).toBe('/')
    expect(validateNextParam(null as unknown as string)).toBe('/')
    expect(validateNextParam(undefined as unknown as string)).toBe('/')
  })

  it('rejects paths not starting with /', () => {
    expect(validateNextParam('dashboard')).toBe('/')
  })

  it('returns / as default', () => {
    expect(validateNextParam('/')).toBe('/')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth/validate-next.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement validate-next**

```typescript
// src/lib/auth/validate-next.ts
export function validateNextParam(next: string | null | undefined): string {
  if (!next || typeof next !== 'string') return '/'
  // Must start with single /, second char must not be /
  if (!/^\/[^/]/.test(next) && next !== '/') return '/'
  // Reject protocol schemes and credential injection
  if (next.includes('://') || next.includes('@')) return '/'
  return next
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth/validate-next.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/validate-next.ts tests/auth/validate-next.test.ts
git commit -m "feat: add ?next= param validation utility"
```

---

## Task 2: Service-role Supabase client

**Files:**
- Create: `src/lib/supabase/admin.ts`

- [ ] **Step 1: Create admin client**

```typescript
// src/lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'

// Server-only. Never import this from client components.
// Used for: invitation fulfillment (querying auth.users by email)
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY. This client is server-only.'
    )
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
```

- [ ] **Step 2: Add SUPABASE_SERVICE_ROLE_KEY to .env.local**

Run: `grep -q SUPABASE_SERVICE_ROLE_KEY .env.local || echo '\n# Server-only — never expose to browser\nSUPABASE_SERVICE_ROLE_KEY=' >> .env.local`

Manually fill in the key from the Supabase dashboard → Settings → API → `service_role` key.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/admin.ts
git commit -m "feat: add service-role Supabase client for server actions"
```

---

## Task 3: Role check helper

**Files:**
- Create: `src/lib/auth/require-role.ts`
- Create: `tests/auth/require-role.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/auth/require-role.test.ts
import { describe, it, expect } from 'vitest'
import { hasRequiredRole } from '@/lib/auth/require-role'

describe('hasRequiredRole', () => {
  it('returns true when user has exact role', () => {
    expect(hasRequiredRole(['organizer'], ['organizer'])).toBe(true)
  })

  it('returns true when user has one of allowed roles', () => {
    expect(hasRequiredRole(['registration_desk'], ['organizer', 'registration_desk'])).toBe(true)
  })

  it('returns false when user has no matching role', () => {
    expect(hasRequiredRole(['judge'], ['organizer', 'registration_desk'])).toBe(false)
  })

  it('returns false for empty user roles', () => {
    expect(hasRequiredRole([], ['organizer'])).toBe(false)
  })

  it('organizer inherits reg_desk and side_stage', () => {
    expect(hasRequiredRole(['organizer'], ['registration_desk'])).toBe(true)
    expect(hasRequiredRole(['organizer'], ['side_stage'])).toBe(true)
  })

  it('organizer does NOT inherit judge', () => {
    expect(hasRequiredRole(['organizer'], ['judge'])).toBe(false)
  })

  it('handles multi-role users', () => {
    expect(hasRequiredRole(['registration_desk', 'side_stage'], ['side_stage'])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth/require-role.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement role check**

```typescript
// src/lib/auth/require-role.ts
export type EventRole = 'organizer' | 'registration_desk' | 'side_stage' | 'judge'

// Organizer inherits registration_desk + side_stage but NOT judge
const ROLE_INHERITANCE: Record<string, EventRole[]> = {
  organizer: ['registration_desk', 'side_stage'],
}

export function expandRoles(userRoles: EventRole[]): EventRole[] {
  const expanded = new Set(userRoles)
  for (const role of userRoles) {
    const inherited = ROLE_INHERITANCE[role]
    if (inherited) inherited.forEach((r) => expanded.add(r))
  }
  return [...expanded]
}

export function hasRequiredRole(
  userRoles: EventRole[],
  allowedRoles: EventRole[]
): boolean {
  const expanded = expandRoles(userRoles)
  return allowedRoles.some((role) => expanded.includes(role))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth/require-role.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/require-role.ts tests/auth/require-role.test.ts
git commit -m "feat: add role check helper with organizer inheritance"
```

---

## Task 4: Migration — event_roles + pending_invitations + triggers

**Files:**
- Create: `supabase/migrations/024_auth_roles.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/024_auth_roles.sql
-- Replaces user_roles with event_roles. user_roles has no production data.

-- 0. Ensure judges.user_id FK exists (may already exist from 00001)
ALTER TABLE judges ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- 1. Drop old table
DROP TABLE IF EXISTS user_roles;

-- 2. Create event_roles
CREATE TABLE event_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('organizer', 'registration_desk', 'side_stage', 'judge')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE(user_id, event_id, role)
);

-- Index for user_event_role() helper (used in every RLS policy)
CREATE INDEX idx_event_roles_user_event ON event_roles(user_id, event_id);

-- 3. Judge exclusivity trigger
CREATE OR REPLACE FUNCTION enforce_judge_exclusivity()
RETURNS trigger AS $$
BEGIN
  IF NEW.role = 'judge' THEN
    IF EXISTS (
      SELECT 1 FROM event_roles
      WHERE user_id = NEW.user_id AND event_id = NEW.event_id AND role != 'judge'
    ) THEN
      RAISE EXCEPTION 'judge role is mutually exclusive with other roles for the same event';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM event_roles
      WHERE user_id = NEW.user_id AND event_id = NEW.event_id AND role = 'judge'
    ) THEN
      RAISE EXCEPTION 'cannot add non-judge role when user is a judge for this event';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public;

CREATE TRIGGER trg_judge_exclusivity
  BEFORE INSERT OR UPDATE ON event_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_judge_exclusivity();

-- 4. Create pending_invitations
CREATE TABLE pending_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('organizer', 'registration_desk', 'side_stage', 'judge')),
  judge_id uuid REFERENCES judges(id),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE(email, event_id, role)
);

-- 5. user_event_role() helper — used in RLS policies
CREATE OR REPLACE FUNCTION user_event_role(p_event_id uuid)
RETURNS text[] AS $$
  SELECT COALESCE(array_agg(role), '{}')
  FROM event_roles
  WHERE user_id = auth.uid() AND event_id = p_event_id
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push` or apply via Supabase dashboard migrations.

- [ ] **Step 3: Verify tables exist**

Run: Check Supabase dashboard → Table Editor for `event_roles` and `pending_invitations`. Verify `user_roles` is gone.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/024_auth_roles.sql
git commit -m "feat: add event_roles + pending_invitations + judge exclusivity trigger"
```

---

## Task 5: Auth middleware

**Files:**
- Create: `src/middleware.ts`
- Modify: `src/lib/supabase/server.ts`

- [ ] **Step 1: Update server.ts to handle middleware cookie pattern**

The existing `server.ts` works for server components. Middleware needs a slightly different cookie pattern (using `request`/`response` objects instead of Next.js `cookies()`). Keep the existing function and add a middleware-specific factory.

Read `src/lib/supabase/server.ts` to see current implementation, then add:

```typescript
// Add to src/lib/supabase/server.ts — new export for middleware
import { type NextRequest, NextResponse } from 'next/server'

export function createMiddlewareClient(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })

  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  return { client, response }
}
```

- [ ] **Step 2: Create middleware.ts in PERMISSIVE mode**

Per the spec (Step 1): middleware starts permissive — attaches session if present, allows through if not. Old EventGate and judge access code flows continue working. Strict mode is enabled in Task 15.

```typescript
// src/middleware.ts
import { type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/server'

// PERMISSIVE MODE: During migration, we only refresh the session.
// We do NOT redirect unauthenticated users.
// Old auth (EventGate, judge access codes) still works in parallel.
// Switch to strict mode in Task 15 after old auth is removed.
const STRICT_MODE = false

const PUBLIC_ROUTES = ['/auth', '/results', '/public']

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route))
}

export async function middleware(request: NextRequest) {
  const { client, response } = createMiddlewareClient(request)

  // Always refresh session if present
  const {
    data: { user },
  } = await client.auth.getUser()

  // In permissive mode, allow all requests through
  if (!STRICT_MODE) return response

  const { pathname } = request.nextUrl
  if (isPublicRoute(pathname)) return response

  // Strict mode: redirect unauthenticated users
  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/auth/login'
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', pathname)
    }
    return Response.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: [
    // Match all routes except static files and API internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 3: Test manually**

Run: `npm run dev`
- Visit `/dashboard` without being logged in → should redirect to `/auth/login?next=/dashboard`
- Visit `/results/some-id` → should load without redirect
- Visit `/auth/login` → should load without redirect

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts src/lib/supabase/server.ts
git commit -m "feat: add auth middleware with public route allowlist"
```

---

## Task 6: Auth pages — login, signup, confirm

**Files:**
- Create: `src/app/auth/actions.ts`
- Create: `src/app/auth/login/page.tsx`
- Create: `src/app/auth/signup/page.tsx`
- Create: `src/app/auth/confirm/route.ts`

- [ ] **Step 1: Create server actions**

```typescript
// src/app/auth/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateNextParam } from '@/lib/auth/validate-next'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const next = validateNextParam(formData.get('next') as string)

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return { error: error.message }
  }

  // Fulfill pending invitations server-side
  await fulfillInvitations()
  redirect(next)
}

export async function signup(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) {
    return { error: error.message }
  }

  return { success: 'Check your email for a confirmation link.' }
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/auth/login')
}

export async function fulfillInvitations() {
  const supabase = await createClient()
  const admin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return

  const normalizedEmail = user.email.toLowerCase().trim()

  // Find pending invitations
  const { data: invitations } = await admin
    .from('pending_invitations')
    .select('*')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)

  if (!invitations?.length) return

  // Fulfill via RPC for transactional safety (spec requires single transaction)
  // The fulfill_invitation RPC is created in migration 026
  for (const inv of invitations) {
    await admin.rpc('fulfill_invitation', {
      p_invitation_id: inv.id,
      p_user_id: user.id,
    })

    // Mark accepted
    await admin
      .from('pending_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', inv.id)
  }
}
```

- [ ] **Step 2: Create login page**

Read the existing app styling from `src/app/globals.css` and other pages to match the design system. Create:

```typescript
// src/app/auth/login/page.tsx
'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { login } from '@/app/auth/actions'

export default function LoginPage() {
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    formData.set('next', next)
    const result = await login(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-feis-bg">
      <div className="w-full max-w-sm rounded-lg border border-feis-border bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-center font-outfit text-2xl font-semibold text-feis-text">
          Sign in to FeisTab
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-feis-text">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="feis-input w-full"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-feis-text">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="feis-input w-full"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="feis-btn feis-btn-primary w-full"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-feis-muted">
          Don't have an account?{' '}
          <Link href="/auth/signup" className="text-feis-green hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create signup page**

```typescript
// src/app/auth/signup/page.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signup } from '@/app/auth/actions'

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)
    const formData = new FormData(e.currentTarget)
    const result = await signup(formData)
    if (result?.error) setError(result.error)
    if (result?.success) setSuccess(result.success)
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-feis-bg">
      <div className="w-full max-w-sm rounded-lg border border-feis-border bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-center font-outfit text-2xl font-semibold text-feis-text">
          Create your account
        </h1>
        {success ? (
          <div className="rounded-md bg-green-50 p-4 text-sm text-green-700">
            {success}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="full_name" className="mb-1 block text-sm font-medium text-feis-text">
                Full name
              </label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                required
                className="feis-input w-full"
              />
            </div>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-feis-text">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="feis-input w-full"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-feis-text">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                className="feis-input w-full"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="feis-btn feis-btn-primary w-full"
            >
              {loading ? 'Creating account...' : 'Sign up'}
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-feis-muted">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-feis-green hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create confirm route handler**

```typescript
// src/app/auth/confirm/route.ts
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as 'email' })

    if (!error) {
      // Import dynamically to avoid circular deps
      const { fulfillInvitations } = await import('@/app/auth/actions')
      await fulfillInvitations()
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return NextResponse.redirect(new URL('/auth/login?error=invalid_link', request.url))
}
```

- [ ] **Step 5: Test manually**

Run: `npm run dev`
- Visit `/auth/signup` → create an account
- Check email for confirmation link
- Visit `/auth/login` → sign in
- Verify redirect to `/`

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add src/app/auth/
git commit -m "feat: add auth pages — login, signup, email confirmation"
```

---

## Task 7: Event-centered home page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Read current home page**

Read `src/app/page.tsx` to understand current code entry flow.

- [ ] **Step 2: Rewrite as event-centered home**

Replace the code entry flow with a server component that:
1. Gets the authenticated user from Supabase
2. Queries `event_roles` for their events + roles
3. Displays event cards with role badges and action links
4. Shows "no roles" state with helpful actions

Key points:
- Use `createClient()` from `server.ts` (server component)
- Add `export const dynamic = 'force-dynamic'`
- Group by event, show roles as badges, actions per role
- Include logout button
- Include "Check for pending invitations" button (calls `fulfillInvitations` server action)
- Organizer: Dashboard, Check-In, Registration, Side-Stage, Team
- Registration Desk: Check-In, Registration
- Side Stage: Side-Stage
- Judge: My Assignments

- [ ] **Step 3: Test manually**

Run: `npm run dev`
- Sign in as user with no roles → see empty state
- (After Task 8 is done and roles are assigned) Sign in as organizer → see event card with actions

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: replace code entry with event-centered home page"
```

---

## Task 8: Team management UI + invitation flow

**Files:**
- Modify: `src/app/dashboard/events/[eventId]/judges/page.tsx` (add Team section)

- [ ] **Step 1: Read current judges page**

Read `src/app/dashboard/events/[eventId]/judges/page.tsx` to understand the current layout.

- [ ] **Step 2: Add Team management section**

Add a new section to the judges page (or create a separate `/team` page under the event dashboard) that:
1. Lists current `event_roles` for this event (name, email, role, added date)
2. Has an "Invite" form: email + role picker (dropdown of 4 roles)
3. For judge role: also shows a dropdown of unlinked `judges` rows to map to
4. Submit calls a server action that:
   - Creates `pending_invitations` row
   - Uses admin client to check if email exists in `auth.users`
   - If exists: immediately fulfills (creates `event_roles` row, links `judges.user_id` if judge)
   - If not: invitation stays pending
5. Shows pending invitations list with status
6. Has "Remove" button for existing roles (organizer only)

- [ ] **Step 3: Test manually**

Run: `npm run dev`
- As organizer, invite a new email with `registration_desk` role → see pending invitation
- Sign up with that email → log in → see the event on home page with correct role
- As organizer, invite an existing user as `judge` → role assigned immediately

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/events/[eventId]/judges/page.tsx
git commit -m "feat: add team management UI with invitation flow"
```

---

## Task 8b: Identity backfill for existing prototype data

**Files:**
- Create: `supabase/migrations/024b_identity_backfill.sql` (or run as a one-time server action)

Without this, enabling RLS will lock out all existing events — no one has `event_roles` rows for prototype data.

- [ ] **Step 1: Create backfill script**

After Task 8 is complete and the first organizer has signed up via `/auth/signup`:

1. The organizer who created each event needs an `event_roles` row with `role = 'organizer'`. Match via `events.created_by = auth.users.id`.
2. Existing judges with known emails need `event_roles` rows with `role = 'judge'` AND `judges.user_id` linked.
3. Events with no mapped roles get flagged (logged) for manual assignment.

```sql
-- Run via Supabase SQL editor or as a server action using admin client
-- For each event where created_by is a real auth user:
INSERT INTO event_roles (user_id, event_id, role, created_by)
SELECT e.created_by, e.id, 'organizer', e.created_by
FROM events e
WHERE e.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

-- For judges with user_id already set:
INSERT INTO event_roles (user_id, event_id, role, created_by)
SELECT j.user_id, j.event_id, 'judge', j.user_id
FROM judges j
WHERE j.user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Log events with no organizer role assigned:
SELECT e.id, e.name FROM events e
WHERE NOT EXISTS (
  SELECT 1 FROM event_roles er WHERE er.event_id = e.id AND er.role = 'organizer'
);
```

- [ ] **Step 2: Run backfill and verify**

Run the script. Verify in Supabase dashboard that `event_roles` has rows for existing events.

- [ ] **Step 3: Commit (if script is in repo)**

```bash
git add supabase/migrations/024b_identity_backfill.sql
git commit -m "feat: backfill event_roles for existing prototype data"
```

---

## Task 9: Harden existing RPCs

**Files:**
- Create: `supabase/migrations/025_harden_existing_rpcs.sql`

- [ ] **Step 1: Write migration to alter 5 existing RPCs**

Each existing RPC needs:
- `SECURITY DEFINER`
- `SET search_path = public`
- Role validation via `user_event_role()`
- Audit log entry

```sql
-- supabase/migrations/025_harden_existing_rpcs.sql
-- Harden existing RPCs: add SECURITY DEFINER, search_path, role checks

-- 1. sign_off_judge — requires judge role + assignment
CREATE OR REPLACE FUNCTION sign_off_judge(
  p_round_id uuid,
  p_judge_id uuid,
  p_competition_id uuid,
  p_action text DEFAULT 'sign_off'
)
RETURNS jsonb AS $$
DECLARE
  v_event_id uuid;
  v_sign_offs jsonb;
  v_roles text[];
BEGIN
  -- Get event_id from competition
  SELECT c.event_id INTO v_event_id
  FROM competitions c WHERE c.id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;

  -- Validate caller is this judge
  IF NOT EXISTS (
    SELECT 1 FROM judges j
    WHERE j.id = p_judge_id AND j.user_id = auth.uid()
  ) THEN
    -- Allow organizer to sign off on behalf
    v_roles := user_event_role(v_event_id);
    IF NOT 'organizer' = ANY(v_roles) THEN
      RAISE EXCEPTION 'not authorized: must be assigned judge or organizer';
    END IF;
  END IF;

  -- Existing sign-off logic (preserve current behavior)
  SELECT judge_sign_offs INTO v_sign_offs FROM rounds WHERE id = p_round_id;
  IF v_sign_offs IS NULL THEN v_sign_offs := '{}'::jsonb; END IF;

  IF p_action = 'sign_off' THEN
    v_sign_offs := v_sign_offs || jsonb_build_object(p_judge_id::text, now()::text);
  ELSIF p_action = 'undo_sign_off' THEN
    v_sign_offs := v_sign_offs - p_judge_id::text;
  ELSE
    RAISE EXCEPTION 'invalid action: %', p_action;
  END IF;

  UPDATE rounds SET judge_sign_offs = v_sign_offs WHERE id = p_round_id;

  -- Audit
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'round', p_round_id, 'sign_off_judge',
    jsonb_build_object('judge_id', p_judge_id, 'action', p_action));

  RETURN v_sign_offs;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;
```

Repeat similar pattern for `publish_results`, `unpublish_results`, `approve_tabulation`, `generate_recall` — each needs:
- Extract `event_id` from the relevant competition/round
- Check `user_event_role()` contains `'organizer'`
- Keep existing business logic
- Add audit log entry
- Add `SECURITY DEFINER SET search_path = public`

Read the existing RPC bodies from migrations 019–022 to preserve exact business logic while adding the security wrapper.

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push`

- [ ] **Step 3: Test existing flows still work**

Run: `npm run dev`
- Sign in as organizer → tabulate a competition → verify sign-off, tabulation, publish all still work
- Verify audit_log entries are being written

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/025_harden_existing_rpcs.sql
git commit -m "fix: harden 5 existing RPCs with SECURITY DEFINER + role validation"
```

---

## Task 10: New write RPCs

**Files:**
- Create: `supabase/migrations/026_write_rpcs.sql`
- Modify: `src/lib/supabase/rpc.ts`

- [ ] **Step 1: Write migration with new RPCs**

Create RPCs for every client-side write that currently uses direct `.insert()/.update()/.upsert()`:

```sql
-- supabase/migrations/026_write_rpcs.sql

-- 1. create_event — any authenticated user, auto-assigns organizer role
CREATE OR REPLACE FUNCTION create_event(
  p_name text,
  p_start_date date,
  p_end_date date,
  p_location text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_event_id uuid;
  v_reg_code text;
  v_attempts int := 0;
BEGIN
  IF p_name IS NULL OR p_start_date IS NULL THEN
    RAISE EXCEPTION 'missing required fields';
  END IF;

  -- Generate unique registration code (for display only, not auth)
  LOOP
    v_reg_code := upper(substring(md5(random()::text) from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM events WHERE registration_code = v_reg_code);
    v_attempts := v_attempts + 1;
    IF v_attempts > 5 THEN RAISE EXCEPTION 'failed to generate unique code'; END IF;
  END LOOP;

  INSERT INTO events (name, start_date, end_date, location, registration_code, created_by, status)
  VALUES (p_name, p_start_date, p_end_date, p_location, v_reg_code, auth.uid(), 'draft')
  RETURNING id INTO v_event_id;

  -- Auto-assign organizer role
  INSERT INTO event_roles (user_id, event_id, role, created_by)
  VALUES (auth.uid(), v_event_id, 'organizer', auth.uid());

  -- Auto-create Stage 1
  INSERT INTO stages (event_id, name, display_order)
  VALUES (v_event_id, 'Stage 1', 1);

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'event', v_event_id, 'create_event',
    jsonb_build_object('name', p_name, 'code', v_reg_code));

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 2. submit_score — requires judge role + assignment + unlocked
CREATE OR REPLACE FUNCTION submit_score(
  p_competition_id uuid,
  p_round_id uuid,
  p_dancer_id uuid,
  p_raw_score numeric,
  p_flagged boolean DEFAULT false,
  p_flag_reason text DEFAULT NULL,
  p_comment_data jsonb DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_event_id uuid;
  v_judge_id uuid;
  v_score_id uuid;
BEGIN
  -- Get event and validate competition status
  SELECT c.event_id INTO v_event_id FROM competitions c WHERE c.id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;

  -- Find caller's judge_id
  SELECT j.id INTO v_judge_id
  FROM judges j WHERE j.user_id = auth.uid() AND j.event_id = v_event_id;
  IF v_judge_id IS NULL THEN RAISE EXCEPTION 'not a judge for this event'; END IF;

  -- Verify assignment
  IF NOT EXISTS (
    SELECT 1 FROM judge_assignments ja
    WHERE ja.judge_id = v_judge_id AND ja.competition_id = p_competition_id
  ) THEN
    RAISE EXCEPTION 'not assigned to this competition';
  END IF;

  -- Verify not locked
  IF EXISTS (
    SELECT 1 FROM score_entries se
    WHERE se.round_id = p_round_id AND se.dancer_id = p_dancer_id
      AND se.judge_id = v_judge_id AND se.locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'score is locked after sign-off';
  END IF;

  -- Upsert score
  INSERT INTO score_entries (
    round_id, competition_id, dancer_id, judge_id,
    raw_score, flagged, flag_reason, comment_data,
    entry_mode, submitted_at
  ) VALUES (
    p_round_id, p_competition_id, p_dancer_id, v_judge_id,
    p_raw_score, p_flagged, p_flag_reason, p_comment_data,
    'judge_self_service', now()
  )
  ON CONFLICT (round_id, dancer_id, judge_id) DO UPDATE SET
    raw_score = EXCLUDED.raw_score,
    flagged = EXCLUDED.flagged,
    flag_reason = EXCLUDED.flag_reason,
    comment_data = EXCLUDED.comment_data,
    submitted_at = now()
  RETURNING id INTO v_score_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'score_entry', v_score_id, 'submit_score',
    jsonb_build_object('dancer_id', p_dancer_id, 'raw_score', p_raw_score));

  RETURN v_score_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 3. tabulator_enter_score — requires organizer role
CREATE OR REPLACE FUNCTION tabulator_enter_score(
  p_competition_id uuid,
  p_round_id uuid,
  p_dancer_id uuid,
  p_judge_id uuid,
  p_raw_score numeric,
  p_flagged boolean DEFAULT false,
  p_flag_reason text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_event_id uuid;
  v_roles text[];
  v_score_id uuid;
BEGIN
  SELECT c.event_id INTO v_event_id FROM competitions c WHERE c.id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;

  v_roles := user_event_role(v_event_id);
  IF NOT 'organizer' = ANY(v_roles) THEN
    RAISE EXCEPTION 'requires organizer role';
  END IF;

  -- Verify not locked
  IF EXISTS (
    SELECT 1 FROM score_entries se
    WHERE se.round_id = p_round_id AND se.dancer_id = p_dancer_id
      AND se.judge_id = p_judge_id AND se.locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'score is locked after sign-off';
  END IF;

  INSERT INTO score_entries (
    round_id, competition_id, dancer_id, judge_id,
    raw_score, flagged, flag_reason,
    entry_mode, entered_by_user_id, submitted_at
  ) VALUES (
    p_round_id, p_competition_id, p_dancer_id, p_judge_id,
    p_raw_score, p_flagged, p_flag_reason,
    'tabulator_transcription', auth.uid(), now()
  )
  ON CONFLICT (round_id, dancer_id, judge_id) DO UPDATE SET
    raw_score = EXCLUDED.raw_score,
    flagged = EXCLUDED.flagged,
    flag_reason = EXCLUDED.flag_reason,
    entered_by_user_id = auth.uid(),
    submitted_at = now()
  RETURNING id INTO v_score_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'score_entry', v_score_id, 'tabulator_enter_score',
    jsonb_build_object('dancer_id', p_dancer_id, 'judge_id', p_judge_id, 'raw_score', p_raw_score));

  RETURN v_score_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 4. check_in_dancer — requires organizer or registration_desk
CREATE OR REPLACE FUNCTION check_in_dancer(
  p_event_id uuid,
  p_dancer_id uuid,
  p_competitor_number int
)
RETURNS uuid AS $$
DECLARE
  v_roles text[];
  v_checkin_id uuid;
BEGIN
  v_roles := user_event_role(p_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'registration_desk' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or registration_desk role';
  END IF;

  INSERT INTO event_check_ins (event_id, dancer_id, competitor_number, checked_in_at)
  VALUES (p_event_id, p_dancer_id, p_competitor_number, now())
  ON CONFLICT (event_id, dancer_id) DO UPDATE SET
    competitor_number = EXCLUDED.competitor_number,
    checked_in_at = now()
  RETURNING id INTO v_checkin_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'event_check_in', v_checkin_id, 'check_in_dancer',
    jsonb_build_object('dancer_id', p_dancer_id, 'number', p_competitor_number));

  RETURN v_checkin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;
```

Additional RPCs needed (same pattern: validate args → check role → business logic → audit):

```sql
-- 5. fulfill_invitation — called by server action, transactional
CREATE OR REPLACE FUNCTION fulfill_invitation(p_invitation_id uuid, p_user_id uuid)
RETURNS void AS $$
DECLARE
  v_inv record;
BEGIN
  SELECT * INTO v_inv FROM pending_invitations WHERE id = p_invitation_id AND accepted_at IS NULL;
  IF v_inv IS NULL THEN RETURN; END IF;

  -- Create event role (idempotent)
  INSERT INTO event_roles (user_id, event_id, role, created_by)
  VALUES (p_user_id, v_inv.event_id, v_inv.role, v_inv.invited_by)
  ON CONFLICT DO NOTHING;

  -- Link judge if applicable
  IF v_inv.judge_id IS NOT NULL THEN
    UPDATE judges SET user_id = p_user_id WHERE id = v_inv.judge_id;
  END IF;

  -- Mark accepted
  UPDATE pending_invitations SET accepted_at = now() WHERE id = p_invitation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 6. transition_competition_status — organizer only, enforces state machine
CREATE OR REPLACE FUNCTION transition_competition_status(
  p_competition_id uuid, p_new_status text
)
RETURNS void AS $$
DECLARE
  v_event_id uuid;
  v_old_status text;
BEGIN
  SELECT event_id, status INTO v_event_id, v_old_status
  FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN
    RAISE EXCEPTION 'requires organizer role';
  END IF;
  -- State machine validation happens in app layer via canTransition()
  -- RPC just enforces role + does the update + audits
  UPDATE competitions SET status = p_new_status WHERE id = p_competition_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'transition_status',
    jsonb_build_object('from', v_old_status, 'to', p_new_status));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 7. confirm_roster — organizer only
CREATE OR REPLACE FUNCTION confirm_roster(p_competition_id uuid)
RETURNS void AS $$
DECLARE v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN
    RAISE EXCEPTION 'requires organizer role';
  END IF;
  UPDATE competitions SET roster_confirmed = true, roster_confirmed_at = now(),
    roster_confirmed_by = auth.uid()::text WHERE id = p_competition_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'confirm_roster', '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 8. create_round — organizer only
CREATE OR REPLACE FUNCTION create_round(
  p_competition_id uuid, p_round_number int, p_round_type text DEFAULT 'normal'
)
RETURNS uuid AS $$
DECLARE v_event_id uuid; v_round_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN
    RAISE EXCEPTION 'requires organizer role';
  END IF;
  INSERT INTO rounds (competition_id, round_number, round_type, status)
  VALUES (p_competition_id, p_round_number, p_round_type, 'pending')
  RETURNING id INTO v_round_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'round', v_round_id, 'create_round',
    jsonb_build_object('competition_id', p_competition_id, 'round_number', p_round_number));
  RETURN v_round_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 9. update_heat_snapshot — organizer only
CREATE OR REPLACE FUNCTION update_heat_snapshot(p_round_id uuid, p_snapshot jsonb)
RETURNS void AS $$
DECLARE v_event_id uuid;
BEGIN
  SELECT c.event_id INTO v_event_id FROM rounds r
  JOIN competitions c ON c.id = r.competition_id WHERE r.id = p_round_id;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN
    RAISE EXCEPTION 'requires organizer role';
  END IF;
  UPDATE rounds SET heat_snapshot = p_snapshot WHERE id = p_round_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 10. register_dancer — organizer or registration_desk
CREATE OR REPLACE FUNCTION register_dancer(
  p_event_id uuid, p_competition_id uuid, p_dancer_id uuid
)
RETURNS uuid AS $$
DECLARE v_roles text[]; v_reg_id uuid;
BEGIN
  v_roles := user_event_role(p_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'registration_desk' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or registration_desk role';
  END IF;
  INSERT INTO registrations (event_id, competition_id, dancer_id, status)
  VALUES (p_event_id, p_competition_id, p_dancer_id, 'registered')
  ON CONFLICT (competition_id, dancer_id) DO NOTHING
  RETURNING id INTO v_reg_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'registration', COALESCE(v_reg_id, gen_random_uuid()), 'register_dancer',
    jsonb_build_object('dancer_id', p_dancer_id, 'competition_id', p_competition_id));
  RETURN v_reg_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 11. update_stage_status (side_stage) — side_stage or organizer
CREATE OR REPLACE FUNCTION update_stage_status(
  p_event_id uuid, p_dancer_id uuid, p_competition_id uuid, p_status text
)
RETURNS void AS $$
DECLARE v_roles text[];
BEGIN
  v_roles := user_event_role(p_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'side_stage' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or side_stage role';
  END IF;
  -- Update registration status (present / no_show / scratched)
  UPDATE registrations SET status = p_status
  WHERE competition_id = p_competition_id AND dancer_id = p_dancer_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'registration', p_competition_id, 'update_stage_status',
    jsonb_build_object('dancer_id', p_dancer_id, 'status', p_status));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;
```

- [ ] **Step 2: Add RPC wrappers to rpc.ts**

Read `src/lib/supabase/rpc.ts` and add typed wrappers for each new RPC:

```typescript
export async function createEvent(
  supabase: SupabaseClient,
  params: { name: string; start_date: string; end_date: string; location?: string }
) {
  const { data, error } = await supabase.rpc('create_event', {
    p_name: params.name,
    p_start_date: params.start_date,
    p_end_date: params.end_date,
    p_location: params.location ?? null,
  })
  if (error) throw error
  return data as string // returns event_id
}

export async function submitScore(
  supabase: SupabaseClient,
  params: {
    competition_id: string; round_id: string; dancer_id: string;
    raw_score: number; flagged?: boolean; flag_reason?: string;
    comment_data?: Record<string, unknown>;
  }
) {
  const { data, error } = await supabase.rpc('submit_score', {
    p_competition_id: params.competition_id,
    p_round_id: params.round_id,
    p_dancer_id: params.dancer_id,
    p_raw_score: params.raw_score,
    p_flagged: params.flagged ?? false,
    p_flag_reason: params.flag_reason ?? null,
    p_comment_data: params.comment_data ?? null,
  })
  if (error) throw error
  return data as string
}
// ... repeat for each RPC
```

- [ ] **Step 3: Apply migration and test**

Run: `npx supabase db push`
Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/026_write_rpcs.sql src/lib/supabase/rpc.ts
git commit -m "feat: add write RPCs for score, check-in, event creation, tabulator entry"
```

---

## Task 11: Migrate UI to use RPCs (remove direct writes)

**Files:**
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx` — replace `.upsert()` with `submitScore()` RPC
- Modify: `src/app/dashboard/events/new/page.tsx` — replace `.insert()` with `createEvent()` RPC
- Modify: `src/app/registration/[eventId]/page.tsx` — replace direct writes with RPCs
- Modify: `src/app/checkin/[eventId]/page.tsx` — replace direct writes with RPCs
- Modify: `src/app/dashboard/events/[eventId]/judges/page.tsx` — replace direct judge writes with RPCs
- Modify: `src/app/dashboard/events/[eventId]/program/page.tsx` — replace direct stage writes
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/page.tsx` — replace ALL direct writes (rounds, status transitions, roster confirmation, heat snapshots — at least 9 write calls)
- Modify: `src/app/dashboard/events/[eventId]/competitions/[compId]/tabulator/page.tsx` — replace score upserts with `tabulatorEnterScore()` RPC

- [ ] **Step 1: Migrate judge scoring page**

Read `src/app/judge/[eventId]/[compId]/page.tsx`. Find the `.upsert()` call for score_entries (around line 282). Replace with:

```typescript
import { submitScore } from '@/lib/supabase/rpc'
// In the score submit handler:
await submitScore(supabase, {
  competition_id: compId,
  round_id: activeRound.id,
  dancer_id: dancerId,
  raw_score: score,
  flagged,
  flag_reason: flagReason,
  comment_data: commentData,
})
```

Remove the old direct `.upsert()` code and the client-side `logAudit()` call (audit is now in the RPC).

- [ ] **Step 2: Migrate event creation page**

Read `src/app/dashboard/events/new/page.tsx`. Replace direct event + stage insert with:

```typescript
import { createEvent } from '@/lib/supabase/rpc'
const eventId = await createEvent(supabase, {
  name, start_date, end_date, location
})
// Stage 1 is auto-created by the RPC
router.push(`/dashboard/events/${eventId}`)
```

- [ ] **Step 3: Migrate remaining pages**

For each remaining page with direct writes:
1. Read the file
2. Identify the `.insert()`/`.update()`/`.upsert()` calls
3. Replace with the corresponding RPC wrapper
4. Remove client-side `logAudit()` calls
5. Verify no direct writes remain

**Hard rule: after each page is migrated, grep the file for `.insert(`, `.update(`, `.upsert(` to confirm no direct writes remain (reads via `.select()` are fine — those stay until RLS is enabled).**

- [ ] **Step 4: Remove ALL client-side logAudit usage**

Grep for `logAudit` across the entire codebase. Remove every client-side call — audit logging now happens inside RPCs. Also check: tabulator page, results page, and any other pages not in the list above. Once all callers are removed, delete `src/lib/audit.ts` (the utility itself) if it exists and has no remaining callers.

Run: `grep -r "logAudit" src/` — should return zero results after cleanup.

- [ ] **Step 5: Run build + test**

Run: `npm run build`
Run: `npm test`
Run: `npm run dev` — manually test scoring, event creation, check-in flows

- [ ] **Step 6: Commit**

```bash
git add src/app/ src/lib/supabase/rpc.ts
git commit -m "refactor: migrate all client writes to RPCs, remove direct Supabase mutations"
```

---

## Task 12: Audit triggers

**Files:**
- Create: `supabase/migrations/027_audit_triggers.sql`

- [ ] **Step 1: Write migration**

Create triggers that auto-insert into `audit_log` and `status_changes` on table mutations. This replaces client-side audit calls.

```sql
-- supabase/migrations/027_audit_triggers.sql

-- Status changes trigger: auto-log competition status transitions
CREATE OR REPLACE FUNCTION log_competition_status_change()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO status_changes (entity_type, entity_id, from_status, to_status, changed_by, changed_at)
    VALUES ('competition', NEW.id, OLD.status, NEW.status, auth.uid(), now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

CREATE TRIGGER trg_competition_status_change
  AFTER UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION log_competition_status_change();
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/027_audit_triggers.sql
git commit -m "feat: add audit triggers for status_changes"
```

---

## Task 13: RLS policies + narrow read functions

**Files:**
- Create: `supabase/migrations/028_rls_policies.sql`

- [ ] **Step 1: Write RLS policies migration**

This is the largest migration. Create all policies per the spec's policy matrix, plus the narrow read functions.

```sql
-- supabase/migrations/028_rls_policies.sql

-- Narrow read functions
CREATE OR REPLACE FUNCTION judge_roster(p_comp_id uuid)
RETURNS TABLE (dancer_id uuid, first_name text, last_name text, competitor_number int) AS $$
BEGIN
  -- Validate caller is assigned judge
  IF NOT EXISTS (
    SELECT 1 FROM judge_assignments ja
    JOIN judges j ON j.id = ja.judge_id
    WHERE ja.competition_id = p_comp_id AND j.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not assigned to this competition';
  END IF;

  RETURN QUERY
  SELECT d.id, d.first_name, d.last_name, ec.competitor_number
  FROM registrations r
  JOIN dancers d ON d.id = r.dancer_id
  LEFT JOIN event_check_ins ec ON ec.dancer_id = d.id
    AND ec.event_id = (SELECT event_id FROM competitions WHERE id = p_comp_id)
  WHERE r.competition_id = p_comp_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

CREATE OR REPLACE FUNCTION side_stage_roster(p_comp_id uuid)
RETURNS TABLE (dancer_id uuid, first_name text, last_name text, competitor_number int, registration_status text) AS $$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_comp_id;
  IF NOT ('side_stage' = ANY(user_event_role(v_event_id))
    OR 'organizer' = ANY(user_event_role(v_event_id))) THEN
    RAISE EXCEPTION 'requires side_stage or organizer role';
  END IF;

  RETURN QUERY
  SELECT d.id, d.first_name, d.last_name, ec.competitor_number, r.status
  FROM registrations r
  JOIN dancers d ON d.id = r.dancer_id
  LEFT JOIN event_check_ins ec ON ec.dancer_id = d.id AND ec.event_id = v_event_id
  WHERE r.competition_id = p_comp_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

CREATE OR REPLACE FUNCTION public_feedback(p_dancer_id uuid, p_event_id uuid)
RETURNS TABLE (
  comp_name text, final_rank int, judge_name text, comment_data jsonb
) AS $$
BEGIN
  RETURN QUERY
  SELECT c.name, res.final_rank,
    j.first_name || ' ' || j.last_name,
    se.comment_data
  FROM results res
  JOIN competitions c ON c.id = res.competition_id
  JOIN score_entries se ON se.competition_id = c.id AND se.dancer_id = p_dancer_id
  JOIN judges j ON j.id = se.judge_id
  WHERE res.dancer_id = p_dancer_id
    AND c.event_id = p_event_id
    AND res.published_at IS NOT NULL
    AND se.comment_data IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- RLS POLICIES (apply per table — full policy set)
-- NOTE: Do NOT enable RLS here. That happens in migration 029 (Task 14).
-- This migration only creates the policies so they're ready when RLS is enabled.

-- Example for events:
CREATE POLICY events_select ON events FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND array_length(user_event_role(id), 1) > 0
  );

CREATE POLICY events_insert ON events FOR INSERT
  WITH CHECK (false); -- Only via create_event RPC

CREATE POLICY events_update ON events FOR UPDATE
  USING ('organizer' = ANY(user_event_role(id)));

-- Repeat for all tables per spec matrix...
-- (Full SQL for each table's policies)

-- IMPORTANT: Don't forget pending_invitations policies:
CREATE POLICY pending_invitations_select ON pending_invitations FOR SELECT
  USING (
    -- Organizer can see invitations for their events
    'organizer' = ANY(user_event_role(event_id))
  );
CREATE POLICY pending_invitations_insert ON pending_invitations FOR INSERT
  WITH CHECK ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY pending_invitations_update ON pending_invitations FOR UPDATE
  USING (false); -- Only via fulfill_invitation RPC (SECURITY DEFINER)
```

Write the complete policy set for every table in the spec matrix PLUS `pending_invitations`. Each table needs: SELECT, INSERT, UPDATE, DELETE policies.

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/028_rls_policies.sql
git commit -m "feat: add RLS policies + narrow read functions for all tables"
```

---

## Task 14: Enable RLS

**Files:**
- Create: `supabase/migrations/029_enable_rls.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/029_enable_rls.sql
-- Separate file so rollback = dropping this one migration
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dancers ENABLE ROW LEVEL SECURITY;
ALTER TABLE judges ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE recalls ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE judge_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_invitations ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Run pre-cutover test matrix**

Before applying, test EVERY scenario from the spec:

| Test | How | Expected |
|------|-----|----------|
| Organizer on own event | Sign in as organizer, navigate dashboard | Full access |
| Registration_desk on event | Sign in as reg_desk user | Check-in + registration only |
| Side_stage on event | Sign in as side_stage user | Roster + present/no-show |
| Judge on assigned comp | Sign in as judge, open assigned comp | Score + roster |
| Judge on unassigned comp | Sign in as judge, try accessing other comp | Blocked |
| User with no roles | Sign in, go to home | Empty state, no data |
| Unauthenticated | Visit `/results/*` | Published results only |
| Pending invitation | Sign up with invited email | Roles appear after login |
| Multi-role user | Organizer + reg_desk | Both sets of actions |
| Multi-event user | Roles on 2 events | Only own events visible |

- [ ] **Step 3: Apply migration**

Run: `npx supabase db push`

- [ ] **Step 4: Re-test all flows**

Run: `npm run dev`
Full manual test of all operational flows with authenticated users.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/029_enable_rls.sql
git commit -m "feat: enable RLS on all tables"
```

---

## Task 15: Remove old auth system

**Files:**
- Delete: `src/components/event-gate.tsx`
- Delete: `supabase/disable_rls.sql`
- Modify: `src/middleware.ts` (switch to strict mode)
- Modify: `src/app/registration/[eventId]/layout.tsx` (remove EventGate)
- Modify: `src/app/dashboard/events/[eventId]/layout.tsx` (remove EventGate)
- Modify: `src/app/checkin/[eventId]/layout.tsx` (remove EventGate)
- Modify: `src/app/judge/page.tsx` (remove access code login)
- Modify: `src/app/judge/[eventId]/page.tsx` (remove localStorage session)
- Modify: `src/app/judge/[eventId]/[compId]/page.tsx` (remove localStorage session)
- Modify: `src/app/dashboard/page.tsx` (remove localStorage event list)

- [ ] **Step 1: Switch middleware to strict mode**

In `src/middleware.ts`, change `const STRICT_MODE = false` to `const STRICT_MODE = true`.

- [ ] **Step 1b: Add session refresh failure handling**

Add a client-side session monitor component that detects auth state changes. Create `src/components/session-monitor.tsx`:

```typescript
'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'

export function SessionMonitor() {
  const supabase = useSupabase()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          if (event === 'SIGNED_OUT') {
            // Session expired or refresh failed
            router.push(`/auth/login?next=${encodeURIComponent(pathname)}`)
          }
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [supabase, router, pathname])

  return null
}
```

Add `<SessionMonitor />` to the root layout for authenticated pages.

In `src/middleware.ts`, the middleware is already strict (redirects unauthenticated users). Remove any permissive-mode comments or conditionals if they exist.

- [ ] **Step 2: Remove EventGate from layouts**

For each layout file that wraps children in `<EventGate>`:
1. Read the file
2. Remove the EventGate import and wrapper
3. Replace with a server-side role check using `requireRole()`

Example for `src/app/dashboard/events/[eventId]/layout.tsx`:
```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { eventId: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Check user has any role on this event
  const { data: roles } = await supabase
    .from('event_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('event_id', params.eventId)

  if (!roles?.length) redirect('/')

  return <>{children}</>
}
```

- [ ] **Step 3: Remove judge localStorage auth**

Read and modify:
- `src/app/judge/page.tsx` — remove access code form, redirect to `/auth/login` if not authenticated, then show judge's assigned events
- `src/app/judge/[eventId]/page.tsx` — remove localStorage `judge_session` reads, get judge_id from `judges.user_id = auth.uid()`
- `src/app/judge/[eventId]/[compId]/page.tsx` — same: derive judge_id from authenticated user

- [ ] **Step 4: Remove dashboard localStorage**

Read and modify `src/app/dashboard/page.tsx` — remove localStorage event list, query `event_roles` for organizer events.

- [ ] **Step 5: Delete old files**

```bash
rm src/components/event-gate.tsx
rm supabase/disable_rls.sql
```

- [ ] **Step 6: Grep for leftover localStorage usage**

Run: `grep -r "localStorage" src/` — should return zero results related to auth/sessions. (Some non-auth localStorage usage like UI preferences is fine.)

Run: `grep -r "feistab_access" src/` — should return zero results.

Run: `grep -r "judge_session" src/` — should return zero results.

Run: `grep -r "EventGate" src/` — should return zero results.

- [ ] **Step 7: Run build + test**

Run: `npm run build`
Run: `npm test`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove old auth system — EventGate, localStorage sessions, access codes"
```

---

## Task 16: Final verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: PASS, no TypeScript errors

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No new warnings

- [ ] **Step 4: Manual end-to-end test**

Run through the complete Phase 1 flow with real auth:
1. Sign up as organizer → create event → see it on home page
2. Invite registration_desk user → they sign up → see event with reg_desk actions
3. Invite judge → they sign up → see assigned competitions
4. Check in dancers (as reg_desk)
5. Score competition (as judge)
6. Sign off → tabulate → publish (as organizer)
7. View published results (unauthenticated)
8. View feedback page (unauthenticated)

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final verification fixes for security hardening"
```
