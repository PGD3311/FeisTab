# Security Hardening: Auth + RLS + Role-Based Access Control

**Date:** 2026-03-23
**Status:** Approved
**Goal:** Replace prototype client-side security (localStorage sessions, access codes, disabled RLS) with production-grade Supabase Auth, event-scoped roles, RLS policies, and validated write RPCs.

**Threat model:** Public results are open. Everything operational requires authentication. Users are organizers, registration desk staff, side-stage operators, and judges working a feis day. The software is not publicly discoverable but the URL may be shared — security must hold against a curious or tech-savvy user, not just accidental misuse.

---

## 1. Auth Model

- **Supabase Auth with email + password.** Every person who touches the operational side gets an account.
- `/auth/login` — email + password form. Supports `?next=` param for deep-link return. Validation: `next` must match `/^\/[^\/]/` (starts with single `/`, second char is not `/`) and must not contain `://` or `@`. Rejects protocol-relative URLs like `//evil.com`.
- `/auth/signup` — email, password, full name. Supabase sends confirmation email.
- `/auth/confirm` — Supabase email confirmation callback.
- After login, invitation fulfillment runs server-side (see Section 4), then redirect to `next` param or `/`.
- **No more access codes for auth.** Event `registration_code` and judge `access_code` no longer grant access. Organizer must explicitly add users via roles.
- **Public results remain unauthenticated** — `/results/[eventId]` and `/results/[eventId]/feedback/[dancerId]` stay open.
- **Session configuration:** JWT expiry set to 1 hour with auto-refresh via `@supabase/ssr`. Refresh token rotation enabled. A feis day runs 8-12 hours — the client auto-refreshes silently. If refresh fails (e.g., network drop), redirect to `/auth/login?next={current_path}` with a toast warning about unsaved work.

---

## 2. Role Model

### Roles

Four roles: `organizer`, `registration_desk`, `side_stage`, `judge`.

### `event_roles` table (replaces existing `user_roles`)

The existing `user_roles` table (migration `00004_operations.sql`, enum: `super_admin/organizer/tabulator/stage_manager/judge/viewer`) is dropped and replaced. It has no production data. The new enum maps as: `organizer` → `organizer`, `tabulator` → `organizer`, `stage_manager` → `side_stage`, `judge` → `judge`, `viewer` → removed (public results handle this), `super_admin` → removed (out of scope).

```
event_roles
├── id          (uuid, PK)
├── user_id     (uuid, FK → auth.users)
├── event_id    (uuid, FK → events)
├── role        (enum: 'organizer', 'registration_desk', 'side_stage', 'judge')
├── created_at  (timestamptz, default now())
├── created_by  (uuid, FK → auth.users)
└── UNIQUE(user_id, event_id, role)
```

A user can hold multiple roles per event. **Judge is mutually exclusive** with all other roles for the same event — enforced by a DB trigger:

```sql
-- Before INSERT on event_roles:
-- If new role = 'judge': reject if user has ANY other role for this event
-- If new role != 'judge': reject if user has 'judge' role for this event
```

### Event role vs judging permission

- `event_roles.role = 'judge'` → user is in the judge pool for the event
- `judges.user_id` → links auth user to a judges row
- `judge_assignments` → determines which competitions they can score
- All three must be in place before a judge can submit scores

### `judges.user_id` linkage mechanism

When an organizer invites a judge:
1. Organizer enters email + selects role `judge` + picks which `judges` row this person maps to (or creates a new one)
2. `pending_invitations` row stores both `role = 'judge'` and `judge_id` (new column on `pending_invitations`)
3. On fulfillment: INSERT into `event_roles` AND UPDATE `judges SET user_id = auth.uid() WHERE id = invitation.judge_id`
4. If the judge already has an account: both happen immediately on invite

### Permission matrix

| Action | Organizer | Registration Desk | Side Stage | Judge |
|---|---|---|---|---|
| Create/edit event | Yes | - | - | - |
| Manage judges & roles | Yes | - | - | - |
| Check-in / arrived on site | Yes | Yes | - | - |
| Registration + corrections | Yes | Yes | - | - |
| Present at stage | Yes | - | Yes | - |
| No-show / scratched | Yes | - | Yes | - |
| Tabulation & results | Yes | - | - | - |
| Score competitions | - | - | - | Assigned only |
| View published results | Public | Public | Public | Public |

Organizer inherits registration_desk + side_stage permissions but NOT judge.

---

## 3. RLS Policies

### Principle

Deny by default. RLS handles row-level reads. RPCs handle all writes.

### Helper function

```sql
CREATE FUNCTION user_event_role(p_event_id uuid)
RETURNS text[] AS $$
  SELECT array_agg(role)
  FROM event_roles
  WHERE user_id = auth.uid() AND event_id = p_event_id
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

**Note:** This function is `SECURITY DEFINER` by design — it runs as the function owner (migration role), which bypasses RLS on `event_roles`. This is intentional: the function is used inside RLS policies on other tables, and if it were `SECURITY INVOKER`, querying `event_roles` (which itself has RLS) would cause infinite recursion. Do not change this to `SECURITY INVOKER`.

### RPC security model

**All write RPCs are `SECURITY DEFINER`.** They bypass RLS and enforce authorization in the function body. This is necessary because:
- A judge calling `submit_score` needs to INSERT into `score_entries`, but the RLS INSERT policy is "Via RPC" (no direct client inserts)
- Organizer RPCs like `approve_tabulation` need to UPDATE `competitions` and INSERT into `results`
- The RPC body re-checks role, assignment, lock state, and allowed fields before executing

**Client-side code uses the `anon` key** for all operations. RPCs bypass RLS internally via `SECURITY DEFINER`.

**Server actions** (invitation fulfillment, invitation check) use a **service-role Supabase client** (not exposed to the browser) for operations that require querying `auth.users` (e.g., checking if an invited email already has an account).

### Policy matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| events | Any role on event | Authenticated (creates event) | Organizer | Never |
| dancers | Organizer, reg_desk: via event join (see predicate below). Side_stage, judge: via narrow functions only. Public: name + number via `public_feedback()` for published results. | Via RPC | Via RPC | Never |
| judges | Any role on event | Organizer | Organizer | Never |
| competitions | Any role on event | Organizer | Organizer | Never |
| registrations | Organizer: full. Reg_desk: own event. Side_stage, judge: via roster functions only. | Via RPC | Via RPC | Organizer via RPC |
| event_check_ins | Organizer, reg_desk | Via RPC | Via RPC | Never |
| rounds | Any role on event | Organizer via RPC | Via RPC only (sign-off, heat snapshot) | Never |
| score_entries | Organizer OR own judge_id | Via RPC (judge or tabulator) | Via RPC (judge or tabulator) | Never |
| stages | Any role on event | Organizer | Organizer | Organizer |
| rule_sets | Any role on event | Organizer | Organizer | Never |
| results | Organizer OR public if published | Via RPC only | Via RPC only | Never |
| recalls | Organizer | Via RPC only | Never | Never |
| event_roles | Organizer: all rows for event. All others: own rows only. | Organizer | Organizer | Organizer |
| judge_assignments | Organizer, own judge | Organizer | Organizer | Organizer |
| audit_log | Organizer | Trigger/RPC only | Never | Never |
| status_changes | Organizer | Trigger only | Never | Never |

### `dancers` table RLS predicate

`dancers` has no `event_id` column — it's a shared table across events. The SELECT policy for organizer/reg_desk joins through registrations:

```sql
-- Policy: organizer or registration_desk can see dancers registered for their events
EXISTS (
  SELECT 1 FROM registrations r
  JOIN event_roles er ON er.event_id = r.event_id
  WHERE r.dancer_id = dancers.id
    AND er.user_id = auth.uid()
    AND er.role IN ('organizer', 'registration_desk')
)
```

**Performance note:** Requires index on `registrations(dancer_id)` (already exists from migration 018). Also requires index on `event_roles(user_id, event_id)` (add in auth migration).

### Narrow read functions (not raw table access)

- `judge_roster(p_comp_id)` — dancer name + competitor number. Validates `auth.uid()` → `judges.user_id` → `judge_assignments.competition_id`.
- `side_stage_roster(p_comp_id)` — dancer name + competitor number + present/no-show status. Validates `auth.uid()` → `event_roles.role = 'side_stage'`.
- `public_feedback(p_dancer_id, p_event_id)` — published comments only. No auth required. Joins through `results.published_at IS NOT NULL`.

### Write RPC contract

Every write RPC must:

1. **Re-check role membership** — call `user_event_role()` and reject if caller lacks the required role
2. **Re-check assignment** — for judge RPCs, verify `judges.user_id = auth.uid()` AND `judge_assignments` row exists for the target competition
3. **Re-check lock state** — for score RPCs, verify `locked_at IS NULL` before allowing writes
4. **Restrict field mutations** — each RPC accepts only the fields that role is allowed to set. The RPC function body defines the exact column list, not the caller.
5. **Check competition status** — score submission RPCs must verify the competition is in a status that allows scoring (e.g., `in_progress` or `released_to_judge`). Roster read functions similarly only return data for competitions in active statuses.

### Tabulator entry flow

The existing tabulator data entry mode (organizer types scores on behalf of judges) is preserved via a dedicated RPC:

- `tabulator_enter_score(p_comp_id, p_round_id, p_dancer_id, p_judge_id, p_raw_score, ...)` — requires `organizer` role. Sets `entry_mode = 'tabulator_entry'` and `entered_by_user_id = auth.uid()`. Same lock-state checks as judge scoring.

### Public anonymous policies (no auth required)

- `results` WHERE `published_at IS NOT NULL`
- `dancers` — name and competitor number only via `public_feedback()` function, joined through published results
- `score_entries` — comment_data only via `public_feedback()` function, joined through published results

---

## 4. Auth UI & Flow

### Post-login home (`/`) — event-centered

Each event the user belongs to shows as a card:

```
┌─────────────────────────────────────┐
│ New England Feis — March 29, 2026   │
│ [Organizer] [Registration Desk]     │
│                                     │
│ Dashboard · Check-In · Team         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Boston Spring Feis — April 12, 2026 │
│ [Judge]                             │
│                                     │
│ My Assignments                      │
└─────────────────────────────────────┘
```

- Grouped by event, roles shown as badges
- Actions are role-appropriate per event
- Organizer actions include everything except judging

### No roles state

- "You haven't been added to any events yet."
- Actions: "Check for pending invitations" (re-runs fulfillment server action) / "Sign out and use a different email" / "Contact your organizer"

### Auth middleware (`middleware.ts`)

- All routes except `/auth/*` and `/results/*` require authenticated session
- Middleware only checks "are you authenticated?" — role checks happen at page level
- No session → redirect to `/auth/login?next={current_path}`

### Invitation system

#### `pending_invitations` table

```
pending_invitations
├── id          (uuid, PK)
├── email       (text, stored lowercase/trimmed)
├── event_id    (uuid, FK → events)
├── role        (enum)
├── invited_by  (uuid, FK → auth.users)
├── created_at  (timestamptz)
├── judge_id    (uuid, FK → judges, nullable — set when role = 'judge')
├── accepted_at (timestamptz, nullable)
└── UNIQUE(email, event_id, role)
```

#### Fulfillment flow (server-side only)

1. Runs as a server action from `/auth/confirm` and `/auth/login` post-auth callback. Never exposed as a client-callable endpoint.
2. Query `pending_invitations WHERE email = lower(user.email) AND accepted_at IS NULL`
3. For each match: in a single transaction — INSERT into `event_roles` (with `ON CONFLICT DO NOTHING` for idempotency), if `judge_id` is set on invitation then UPDATE `judges SET user_id = auth.uid()`, SET `accepted_at = now()` on the invitation
4. Multiple pending invitations → all fulfilled at once in the same transaction
5. Email case: stored lowercase, compared lowercase. No alias handling.
6. Repeat login with already-accepted invitations → no-op

#### Organizer invite flow

- Dashboard "Team" section: enter email + pick role(s)
- Always creates a `pending_invitations` row first
- Server action (using service-role client) checks `auth.users` for matching email — if account exists, fulfills the invitation immediately in the same request
- If no account yet → invitation stays pending, fulfilled on their first login after signup

### What gets removed

- Event code entry splash on `/`
- `EventGate` component
- Judge access code login at `/judge`
- All localStorage session storage
- `registration_code` and `access_code` fields kept for display/reference but no longer grant access

---

## 5. Migration Strategy

### Step 1: Add auth infrastructure (no breaking changes)

- Enable Supabase Auth (email/password provider)
- Create `/auth/login`, `/auth/signup`, `/auth/confirm` pages
- Add `middleware.ts` in **permissive mode**: attach session if present, allow through if not. `/judge/*` continues old code access, organizer pages still use `EventGate`, all existing flows work unchanged.
- Add `event_roles`, `pending_invitations` tables, judge exclusivity trigger
- Ensure `judges.user_id` FK exists

### Step 2: Add role management UI + identity backfill

- Organizer dashboard gets "Team" section — invite users, assign roles
- Invitation fulfillment server action wired up
- **Identity backfill:** Map existing prototype organizers/judges to auth accounts. Organizer who created the event gets `organizer` role. Existing judges with known emails get `judge` role + `judges.user_id` linked. Events with no mapped roles flagged for manual assignment.

### Step 3: Replace direct writes with RPCs

- **Migrate existing RPCs first:** ALTER `sign_off_judge`, `publish_results`, `unpublish_results`, `approve_tabulation`, `generate_recall` to `SECURITY DEFINER` and add role/assignment validation to each function body. Without this, enabling RLS in Step 4 will break scoring and tabulation.
- Build new write RPCs (score submission, check-in, registration mutations, tabulator entry, etc.)
- Each RPC validates role + assignment + lock state + allowed fields
- **Hard rule: once a UI flow is migrated to its RPC, the old direct-write code path is removed from the app immediately.** No dual-write period. DB remains permissive (no RLS yet), but the application only uses RPCs.
- Audit_log and status_changes triggers replace client inserts at this step.

### Step 4: Enable RLS

- Create all policies, narrow read functions (`judge_roster`, `side_stage_roster`, `public_feedback`)
- **Pre-cutover test matrix — every cell must pass before RLS goes live:**

| Scenario | Expected |
|---|---|
| Organizer on own event | Full read/write via RPCs |
| Registration_desk on own event | Check-in + registration only |
| Side_stage on own event | Roster + present/no-show only |
| Judge on assigned competition | Score + view roster |
| Judge on unassigned competition | Blocked |
| Authenticated user with no roles | Sees empty home, no data access |
| Public unauthenticated user | Published results only |
| Pending invitation (not yet signed up) | No access until signup + fulfillment |
| Multi-role user (organizer + reg_desk) | Union of permissions |
| User with roles on multiple events | Only sees/accesses own events |

- **Enable RLS on all tables**

### Step 5: Remove old auth system

- Switch middleware to **strict mode**: no session → redirect to `/auth/login`
- Remove `EventGate` component
- Remove all localStorage session code
- Remove event code entry flow, judge access code login
- Clean up `registration_code` and `access_code` columns (keep for display, no longer grant access)

### Rollback plan

- **Steps 1-3:** Purely additive, no rollback needed
- **Step 4 rollback:** Disable RLS on all tables, drop policies. RPCs still provide validation so the app remains functional. Triggers for audit_log/status_changes stay in place (they work regardless of RLS).
- **Step 5:** Point of no return — only proceed once step 4 is stable in production
