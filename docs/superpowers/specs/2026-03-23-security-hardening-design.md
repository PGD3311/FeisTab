# Security Hardening: Auth + RLS + Role-Based Access Control

**Date:** 2026-03-23
**Status:** Approved
**Goal:** Replace prototype client-side security (localStorage sessions, access codes, disabled RLS) with production-grade Supabase Auth, event-scoped roles, RLS policies, and validated write RPCs.

**Threat model:** Public results are open. Everything operational requires authentication. Users are organizers, registration desk staff, side-stage operators, and judges working a feis day. The software is not publicly discoverable but the URL may be shared — security must hold against a curious or tech-savvy user, not just accidental misuse.

---

## 1. Auth Model

- **Supabase Auth with email + password.** Every person who touches the operational side gets an account.
- `/auth/login` — email + password form. Supports `?next=` param for deep-link return (validated as relative path).
- `/auth/signup` — email, password, full name. Supabase sends confirmation email.
- `/auth/confirm` — Supabase email confirmation callback.
- After login, invitation fulfillment runs server-side (see Section 4), then redirect to `next` param or `/`.
- **No more access codes for auth.** Event `registration_code` and judge `access_code` no longer grant access. Organizer must explicitly add users via roles.
- **Public results remain unauthenticated** — `/results/[eventId]` and `/results/[eventId]/feedback/[dancerId]` stay open.

---

## 2. Role Model

### Roles

Four roles: `organizer`, `registration_desk`, `side_stage`, `judge`.

### `event_roles` table

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

### Policy matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| events | Any role on event | Authenticated (creates event) | Organizer | Never |
| dancers | Organizer, reg_desk: full. Side_stage, judge: via narrow functions only. | Via RPC | Via RPC | Never |
| judges | Any role on event | Organizer | Organizer | Never |
| competitions | Any role on event | Organizer | Organizer | Never |
| registrations | Organizer: full. Reg_desk: own event. Side_stage, judge: via roster functions only. | Via RPC | Via RPC | Organizer via RPC |
| event_check_ins | Organizer, reg_desk | Via RPC | Via RPC | Never |
| rounds | Any role on event | Organizer | Organizer | Never |
| score_entries | Organizer OR own judge_id | Judge via RPC | Judge via RPC | Never |
| results | Organizer OR public if published | Via RPC only | Via RPC only | Never |
| recalls | Organizer | Via RPC only | Never | Never |
| event_roles | Organizer: all rows for event. All others: own rows only. | Organizer | Organizer | Organizer |
| judge_assignments | Organizer, own judge | Organizer | Organizer | Organizer |
| audit_log | Organizer | Trigger/RPC only | Never | Never |
| status_changes | Organizer | Trigger only | Never | Never |

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
├── accepted_at (timestamptz, nullable)
└── UNIQUE(email, event_id, role)
```

#### Fulfillment flow (server-side only)

1. Runs as a server action from `/auth/confirm` and `/auth/login` post-auth callback. Never exposed as a client-callable endpoint.
2. Query `pending_invitations WHERE email = lower(user.email) AND accepted_at IS NULL`
3. For each match: INSERT into `event_roles`, SET `accepted_at = now()`
4. Multiple pending invitations → all fulfilled at once
5. Email case: stored lowercase, compared lowercase. No alias handling.
6. Repeat login with already-accepted invitations → no-op

#### Organizer invite flow

- Dashboard "Team" section: enter email + pick role(s)
- If email matches existing user → `event_roles` row created immediately
- If no account yet → `pending_invitations` row created. Fulfilled on their first login after signup.

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

- Build every write RPC (score submission, check-in, registration mutations, sign-off, tabulation, etc.)
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
