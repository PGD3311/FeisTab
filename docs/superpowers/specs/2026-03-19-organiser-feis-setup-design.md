# Organiser Feis Setup

**Date:** 2026-03-19
**Goal:** Let an organiser create a feis listing with syllabus, fees, and deadlines — ready for parents to register against. This is sub-project 1 of 3 for pre-registration.

---

## Why This Matters

FeisTab's Phase 1 chain (check-in → scoring → tabulation → results) works, but competition rosters are currently CSV-imported. Pre-registration replaces that manual step. This spec builds the **upstream foundation**: the organiser creates a feis listing that the parent portal (sub-project 2) will register against, and the bridge (sub-project 3) will convert into competition-day rosters.

Without this, there's nothing for parents to register *for*.

---

## Sub-Project Boundaries

| Sub-project | Scope | Depends on |
|---|---|---|
| **1. Organiser Feis Setup (this spec)** | Wizard, syllabus templates, fees, deadlines, clone | Nothing |
| **2. Parent Registration Portal** | Family accounts, dancer profiles, eligibility filtering, Stripe checkout | #1 |
| **3. The Bridge** | "Launch Feis Day" — entries → event + rosters + number cards | #1 and #2 |

Each sub-project gets its own spec → plan → build cycle in a separate Claude session.

---

## Data Model

### New Tables

#### `feis_listings`

The core feis record. One per feis per year.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `uuid` | `uuid_generate_v4()` | Primary key |
| `name` | `text` | NOT NULL | e.g., "Midwest Open Feis 2026" |
| `feis_date` | `date` | NOT NULL | Primary event date |
| `end_date` | `date` | NULL | For multi-day events |
| `venue_name` | `text` | NOT NULL | Venue name |
| `venue_address` | `text` | NULL | Full address |
| `contact_email` | `text` | NOT NULL | Organiser contact |
| `contact_phone` | `text` | NULL | Optional phone |
| `description` | `text` | NULL | What parents see when browsing |
| `status` | `text` | `'draft'` | State machine (see below) |
| `reg_opens_at` | `timestamptz` | NULL | When registration opens |
| `reg_closes_at` | `timestamptz` | NULL | Standard registration deadline |
| `late_reg_closes_at` | `timestamptz` | NULL | Late registration deadline (late fees apply) |
| `syllabus_template_id` | `uuid` | NULL | Template used to seed competitions |
| `cloned_from` | `uuid` | NULL | Self-reference for clone feature |
| `dancer_cap` | `integer` | NULL | Global cap on total dancers (NULL = unlimited) |
| `stripe_account_id` | `text` | NULL | Connected Stripe account ID |
| `event_id` | `uuid` | NULL | References events(id) — set by bridge when feis day is launched |
| `created_by` | `uuid` | NULL | References auth.users (nullable during prototype, NOT NULL when auth is real) |
| `created_at` | `timestamptz` | `now()` | |
| `updated_at` | `timestamptz` | `now()` | Auto-updated via trigger |

**Status state machine:**

```
draft → open → closed → launched
         ↑       |
         +-------+
        (reopen)
```

- `draft` — organiser is still configuring. Not visible to parents.
- `open` — published. Parents can register and pay.
- `closed` — registration closed. Organiser reviewing entries before feis day.
- `launched` — "Launch Feis Day" executed. Event + rosters created in Phase 1 system. Terminal state.

Transition rules enforced by a `canTransitionListing()` function (same pattern as competition state machine):
- `draft → open`: requires name, date, venue, contact, at least 1 competition, fee schedule, reg_opens_at, reg_closes_at, Stripe connected.
- `open → closed`: always allowed.
- `closed → open`: allowed (reopen registration).
- `closed → launched`: handled by bridge spec (#3).

**Check constraint:**
```sql
status in ('draft', 'open', 'closed', 'launched')
```

#### `fee_schedules`

One-to-one with `feis_listings`. All amounts stored as **integer cents** (same integer-math principle as scoring).

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `uuid` | `uuid_generate_v4()` | Primary key |
| `feis_listing_id` | `uuid` | NOT NULL, UNIQUE | References feis_listings |
| `event_fee_cents` | `integer` | `0` | Per-family flat fee |
| `solo_fee_cents` | `integer` | `0` | Per-dancer per-solo-dance |
| `prelim_champ_fee_cents` | `integer` | `0` | Per-dancer for prelim championship |
| `open_champ_fee_cents` | `integer` | `0` | Per-dancer for open championship |
| `family_cap_cents` | `integer` | NULL | Max total per family (NULL = no cap) |
| `late_fee_cents` | `integer` | `0` | Per-dancer late registration surcharge |
| `day_of_surcharge_cents` | `integer` | `0` | Per-dancer day-of registration surcharge |
| `created_at` | `timestamptz` | `now()` | |
| `updated_at` | `timestamptz` | `now()` | Auto-updated via trigger |

#### `syllabus_templates`

System-shipped and organiser-created templates. A template defines the full grid of possible competitions.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `uuid` | `uuid_generate_v4()` | Primary key |
| `name` | `text` | NOT NULL | e.g., "Standard Grade Feis" |
| `description` | `text` | NULL | What this template includes |
| `template_data` | `jsonb` | NOT NULL | Structured competition grid (see below) |
| `is_system` | `boolean` | `false` | True for built-in templates |
| `created_by` | `uuid` | NULL | NULL for system templates |
| `created_at` | `timestamptz` | `now()` | |

**`template_data` JSON structure:**

```jsonc
{
  "age_groups": [
    { "key": "U6", "label": "Under 6", "max_age_jan1": 5 },
    { "key": "U7", "label": "Under 7", "max_age_jan1": 6 },
    { "key": "U8", "label": "Under 8", "max_age_jan1": 7 },
    { "key": "U9", "label": "Under 9", "max_age_jan1": 8 },
    { "key": "U10", "label": "Under 10", "max_age_jan1": 9 },
    { "key": "U11", "label": "Under 11", "max_age_jan1": 10 },
    { "key": "U12", "label": "Under 12", "max_age_jan1": 11 },
    { "key": "U13", "label": "Under 13", "max_age_jan1": 12 },
    { "key": "U14", "label": "Under 14", "max_age_jan1": 13 },
    { "key": "U15", "label": "Under 15", "max_age_jan1": 14 },
    { "key": "U16", "label": "Under 16", "max_age_jan1": 15 },
    { "key": "U17", "label": "Under 17", "max_age_jan1": 16 },
    { "key": "U18", "label": "Under 18", "max_age_jan1": 17 },
    { "key": "U19", "label": "Under 19", "max_age_jan1": 18 },
    { "key": "O18", "label": "18 & Over", "min_age_jan1": 18 },
    { "key": "O21", "label": "21 & Over", "min_age_jan1": 21 }
  ],
  "levels": [
    { "key": "BG", "label": "Beginner", "rank": 1 },
    { "key": "AB", "label": "Advanced Beginner", "rank": 2 },
    { "key": "NOV", "label": "Novice", "rank": 3 },
    { "key": "PW", "label": "Prizewinner", "rank": 4 }
  ],
  "dances": [
    { "key": "reel", "label": "Reel", "type": "light" },
    { "key": "light_jig", "label": "Light Jig", "type": "light" },
    { "key": "slip_jig", "label": "Slip Jig", "type": "light" },
    { "key": "single_jig", "label": "Single Jig", "type": "light" },
    { "key": "treble_jig", "label": "Treble Jig", "type": "heavy" },
    { "key": "hornpipe", "label": "Hornpipe", "type": "heavy" },
    { "key": "st_patricks_day", "label": "St. Patrick's Day", "type": "set" },
    { "key": "treble_reel", "label": "Treble Reel", "type": "heavy" }
  ],
  "championship_types": [
    {
      "key": "prelim",
      "label": "Preliminary Championship",
      "eligible_levels": ["PW"],
      "fee_category": "prelim_champ"
    },
    {
      "key": "open",
      "label": "Open Championship",
      "eligible_levels": ["PW"],
      "requires_championship_status": true,
      "fee_category": "open_champ"
    }
  ],
  "specials": [
    { "key": "ceili", "label": "Ceili (Team)", "type": "team" },
    { "key": "figure", "label": "Figure Choreography", "type": "team" }
  ]
}
```

This structure encodes eligibility rules (age thresholds, level requirements for championships) that the parent portal will use to auto-filter competitions per dancer.

### Extended Tables

#### `competitions` — add column (deferred to bridge spec)

The bridge (sub-project 3) will add `feis_listing_id` to `competitions` when it creates day-of competitions from pre-registration entries. This column is NOT added in this spec's migration — it belongs to the bridge because it's only populated when `launched` status is reached.

#### `feis_competitions` — new table

The pre-registration syllabus. Generated when organiser saves their syllabus selections. Each row is one competition the organiser has enabled. This is the table parents register against (sub-project 2). The bridge (sub-project 3) converts these into `competitions` rows for day-of operations.

**Key distinction:** `feis_competitions` = pre-registration (what parents see). `competitions` = day-of (what judges/tabulators see). The bridge creates one from the other.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `uuid` | `uuid_generate_v4()` | Primary key |
| `feis_listing_id` | `uuid` | NOT NULL | References feis_listings |
| `age_group_key` | `text` | NOT NULL | e.g., "U10" |
| `level_key` | `text` | NOT NULL | e.g., "BG" |
| `dance_key` | `text` | NOT NULL | e.g., "reel" |
| `competition_type` | `text` | `'solo'` | 'solo', 'championship', 'special' |
| `championship_key` | `text` | NULL | 'prelim' or 'open' — only set when competition_type = 'championship' |
| `display_name` | `text` | NOT NULL | Auto-generated: "U10 Beginner Reel" |
| `display_code` | `text` | NULL | Optional short code: "101" |
| `capacity_cap` | `integer` | NULL | Max entries (NULL = unlimited) |
| `enabled` | `boolean` | `true` | Organiser can disable without deleting |
| `sort_order` | `integer` | `0` | Display ordering |
| `created_at` | `timestamptz` | `now()` | |

**Unique constraint:** `(feis_listing_id, age_group_key, level_key, dance_key, competition_type)`

This table is the "expanded syllabus" — the template generates it, the organiser toggles/customizes it.

---

## Organiser Setup Wizard

### Entry Point

`/organiser/feiseanna/new` — two paths:

1. **Start Fresh** — blank wizard, pick a syllabus template
2. **Clone Previous** — select a past feis listing, pre-fill all fields from it

Clone copies: name (with year bumped), venue, contact, fee schedule, syllabus (all feis_competitions), Stripe account (same organiser, same account), deadlines (cleared — must set new dates). Sets `cloned_from` for audit.

### Wizard Steps

#### Step 1: Feis Details

Fields: name, date, end_date (optional toggle for multi-day), venue_name, venue_address, contact_email, contact_phone, description.

Smart defaults for clone path: previous values pre-filled, year incremented in name.

#### Step 2: Syllabus

1. Pick a template (or keep cloned syllabus)
2. **Broad toggles first:** checkboxes for age groups (U6–O21) and levels (BG, AB, NOV, PW). Checking both auto-generates all dance combinations.
3. **Drill-down if needed:** expand to see individual competitions, toggle specific ones on/off, set per-competition capacity caps.
4. **Championship section:** separate toggle for Prelim and Open Championship, with their own age group selections.
5. **Specials:** toggle ceili, figure choreography, etc.

The UI generates `feis_competitions` rows as the organiser toggles. Everything is `enabled: true` by default from the template; organiser unchecks what they're not running.

#### Step 3: Fees

Standard fill-in-the-blank form with the fee categories:

| Field | Label | Hint |
|---|---|---|
| `event_fee_cents` | Event Fee (per family) | "Typical: $25–30" |
| `solo_fee_cents` | Solo Dance Fee (per dancer per dance) | "Typical: $13–15" |
| `prelim_champ_fee_cents` | Prelim Championship Fee (per dancer) | "Typical: $55" |
| `open_champ_fee_cents` | Open Championship Fee (per dancer) | "Typical: $60–65" |
| `family_cap_cents` | Family Cap (max total) | "Typical: $150–175. Leave blank for no cap." |
| `late_fee_cents` | Late Fee (per dancer) | "Typical: $25" |
| `day_of_surcharge_cents` | Day-of Surcharge (per dancer) | "Typical: $50" |

Input as dollar amounts, stored as cents. UI handles conversion.

#### Step 4: Deadlines & Caps

- **Registration opens:** date picker (defaults to 8 weeks before feis date)
- **Registration closes:** date picker (defaults to 2 weeks before feis date)
- **Late registration closes:** date picker (defaults to 1 week before feis date, optional)
- **Overall dancer cap:** optional global cap on total dancers

Smart defaults based on feis date so the organiser doesn't have to think about typical timelines.

**Date ordering invariants enforced:** `reg_opens_at < reg_closes_at < late_reg_closes_at (if set) < feis_date`. UI prevents invalid combinations.

#### Step 5: Review & Publish

Summary screen showing:
- Feis details
- Syllabus summary (X competitions across Y age groups and Z levels)
- Fee schedule formatted as a clear table
- Deadlines
- Stripe connection status

**Stripe Connect:** "Connect your Stripe account" button. Uses Stripe Connect OAuth flow. Required before publishing — the button to go `draft → open` is disabled until Stripe is connected.

**Publish button:** transitions status to `open`. Feis becomes visible to parents (in parent portal, sub-project 2).

**Save as Draft:** available at any wizard step. Organiser can leave and come back. The `feis_listings` row is created (status `draft`) when the organiser completes Step 1 (or clones). Subsequent steps update the existing record. No client-side persistence needed — each step saves to the database.

---

## Pages

### `/organiser/feiseanna`

List of all feis listings for this organiser. Shows:
- Name, date, status badge (Draft / Open / Closed / Launched)
- Quick stats: registered dancers count, revenue (once parent portal exists)
- Actions: Edit, Clone, View Entries

### `/organiser/feiseanna/new`

The setup wizard described above. Also the clone picker.

### `/organiser/feiseanna/[id]`

Feis detail / management page. Tabs:
- **Overview** — details summary, status, quick actions (open/close registration)
- **Syllabus** — edit competitions (same UI as wizard step 2, but standalone)
- **Fees** — edit fee schedule
- **Entries** — registration list (populated by parent portal, sub-project 2)
- **Settings** — deadlines, Stripe, danger zone (delete draft)

### `/organiser/feiseanna/[id]/edit`

Edit mode for feis details (wizard step 1 fields). Available while status is `draft` or `open`. Some fields lock after `open` (e.g., can't change date while people are registered without a warning).

---

## State Machine

### `canTransitionListing(from, to)` function

Located in `src/lib/feis-listing-states.ts`. Same pattern as `canTransition()` for competitions.

```typescript
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['open'],
  open: ['closed'],
  closed: ['open', 'launched'],
  launched: [],
};
```

### Publish Prerequisites (draft → open)

Before a listing can go live, validate:
- [ ] Name, date, venue, contact email are set
- [ ] At least 1 competition enabled in syllabus
- [ ] Fee schedule exists with non-zero solo_fee
- [ ] reg_opens_at and reg_closes_at are set
- [ ] Date ordering valid: reg_opens_at < reg_closes_at < late_reg_closes_at (if set) < feis_date
- [ ] Stripe account connected

Return a checklist of what's missing so the organiser knows exactly what to fix.

### `ListingTransitionContext` interface

```typescript
interface ListingTransitionContext {
  listing: FeisListing;
  feeSchedule: FeeSchedule | null;
  enabledCompetitionCount: number;
  stripeConnected: boolean;
}
```

`getListingTransitionBlockReasons(from, to, context)` returns `string[]` — empty array means transition is allowed. Same pattern as `getTransitionBlockReason()` for competitions.

---

## System Templates

Ship 3 built-in templates:

### Standard Grade Feis
- Age groups: U6 through O18
- Levels: BG, AB, NOV, PW
- Dances: Reel, Light Jig, Slip Jig, Single Jig, Treble Jig, Hornpipe
- No championship
- ~80–100 competitions

### Championship Feis
- All of Standard Grade plus:
- Prelim Championship (U12–O18)
- Open Championship (U14–O18)
- ~120–140 competitions

### Full CLRG
- Everything: all age groups, all levels, all dances, both championship types, ceili, figure
- ~160+ competitions
- For large regional events

---

## Seed Data Migration

Migration `016_feis_setup.sql`:

1. Create `feis_listings` table with status check constraint, `updated_at` trigger, and index on `created_by`
2. Create `fee_schedules` table with `updated_at` trigger and unique index on `feis_listing_id`
3. Create `syllabus_templates` table
4. Create `feis_competitions` table with unique constraint and index on `feis_listing_id`
5. Insert 3 system syllabus templates

Note: `competitions.feis_listing_id` is NOT added here — deferred to bridge spec (sub-project 3).

---

## Engine Code

### `src/lib/engine/fee-calculator.ts`

Pure function. All integer math (cents). No floats.

```typescript
interface FeeSchedule {
  event_fee_cents: number;
  solo_fee_cents: number;
  prelim_champ_fee_cents: number;
  open_champ_fee_cents: number;
  family_cap_cents: number | null;
  late_fee_cents: number;
  day_of_surcharge_cents: number;
}

interface FeeEntry {
  dancer_id: string;
  competition_type: 'solo' | 'championship' | 'special';
  championship_key?: 'prelim' | 'open';
  is_late: boolean;
  is_day_of: boolean;
}

interface FeeLineItem {
  dancer_id: string;
  base_fee_cents: number;
  late_fee_cents: number;
  day_of_surcharge_cents: number;
  line_total_cents: number;
}

interface FeeBreakdown {
  line_items: FeeLineItem[];
  event_fee_cents: number;          // per-family flat fee
  subtotal_per_dancer: Record<string, number>; // dancer_id → total cents
  subtotal_before_cap_cents: number;
  family_cap_applied: boolean;
  grand_total_cents: number;
}

function calculateFees(schedule: FeeSchedule, entries: FeeEntry[]): FeeBreakdown;
```

The event fee is a per-family flat fee applied once regardless of how many dancers or entries. The family cap applies to the grand total (event fee + all entry fees). If the total exceeds the cap, `grand_total_cents` is clamped to `family_cap_cents`.

### `src/lib/engine/syllabus-expander.ts`

Pure function.

```typescript
interface SyllabusSelection {
  enabled_age_groups: string[];    // e.g., ["U8", "U9", "U10"]
  enabled_levels: string[];        // e.g., ["BG", "AB"]
  enabled_dances: string[];        // e.g., ["reel", "light_jig"]
  enable_prelim: boolean;
  prelim_age_groups: string[];     // which age groups for prelim champ
  enable_open: boolean;
  open_age_groups: string[];       // which age groups for open champ
  enable_specials: string[];       // e.g., ["ceili"]
}

interface ExpandedCompetition {
  age_group_key: string;
  level_key: string;
  dance_key: string;
  competition_type: 'solo' | 'championship' | 'special';
  championship_key: string | null;
  display_name: string;
  sort_order: number;
}

function expandSyllabus(
  templateData: TemplateData,
  selection: SyllabusSelection
): ExpandedCompetition[];
```

### `src/lib/feis-listing-states.ts`

State machine + prerequisite checker. Located outside `engine/` because it may need to reference database types, but the core logic is pure.

```typescript
type ListingStatus = 'draft' | 'open' | 'closed' | 'launched';

function canTransitionListing(from: ListingStatus, to: ListingStatus): boolean;

function getListingTransitionBlockReasons(
  from: ListingStatus,
  to: ListingStatus,
  context: ListingTransitionContext
): string[];
```

---

## What This Spec Does NOT Cover

Deferred to sub-project 2 (Parent Registration Portal):
- Family accounts and dancer profiles
- Eligibility filtering (using age_group/level data from templates)
- Stripe Checkout integration
- Payment webhooks
- COPPA consent flow
- Post-payment edits/refunds
- Cap-during-checkout race conditions

Deferred to sub-project 3 (The Bridge):
- "Launch Feis Day" flow
- Converting entries → event + competitions + registrations + rosters
- Number card generation and privacy model
- Printable artifacts (PDFs)
- Per-dancer summaries

---

## Testing

### Must be tested (engine code)
- `fee-calculator.ts` — all fee categories, family cap logic, late fees, edge cases (zero fees, no cap, single dancer, large family)
- `syllabus-expander.ts` — template expansion, partial selections, championship filtering, empty selections
- `feis-listing-states.ts` — valid transitions, invalid transitions, publish prerequisite validation, date ordering invariants

### Manual testing (UI)
- Wizard flow end-to-end
- Clone from previous feis
- Syllabus toggle UX (broad toggles + drill-down)
- Fee input (dollar → cents conversion)
- Stripe Connect flow
- Draft save/resume
