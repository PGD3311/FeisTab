# FeisTab Brand Guidelines v1.0

## Quick Reference
- **Primary Color:** #0B4D2C (Forest Green)
- **Accent Color:** #D4652A (Feis Orange)
- **Primary Font:** Outfit (sans-serif)
- **Mono Font:** Geist Mono
- **Voice:** Precise, operational, trustworthy

---

## 1. Brand Identity

**FeisTab** is competition-day software for Irish dance. It replaces the paper-envelope-box-transcription chaos with a connected digital flow from registration desk to published results.

**Brand promise:** Trustworthy competition results, delivered faster.

**Voice traits:**
- **Precise** — software speaks in facts, not marketing language. "3 of 5 scored" not "Great progress!"
- **Operational** — every label earns its place. If it doesn't help the operator do their job, remove it.
- **Trustworthy** — transparent calculations, immutable audit trails, defensible results.

**Visual identity:** "Precision Utility." Single font, cool neutral palette, flat panels with 1px borders, monospace for data/numbers. No serif, no textures, no decorative elements. Software, not app.

---

## 2. Color Palette

### Primary Colors
| Name | Hex | RGB | CSS Variable | Usage |
|------|-----|-----|-------------|-------|
| Forest Green | #0B4D2C | 11, 77, 44 | `--color-feis-green` | Primary — nav, headers, CTAs, active states |
| Green Light | #EBF4EF | 235, 244, 239 | `--color-feis-green-light` | Hover backgrounds, selected states, success |

### Accent Colors
| Name | Hex | RGB | CSS Variable | Usage |
|------|-----|-----|-------------|-------|
| Feis Orange | #D4652A | 212, 101, 42 | `--color-feis-orange` | Attention, warnings, needs-action states |
| Orange Light | #FEF3EC | 254, 243, 236 | `--color-feis-orange-light` | Warning backgrounds |
| Feis Gold | #C59D5F | 197, 157, 95 | `--color-feis-gold` | 1st place, medals, achievement |

### Neutrals
| Name | Hex | RGB | CSS Variable | Usage |
|------|-----|-----|-------------|-------|
| Charcoal | #1A1D23 | 26, 29, 35 | `--color-feis-charcoal` | Primary text |
| Muted | #636C76 | 99, 108, 118 | `--muted-foreground` | Secondary text, labels |
| Cream | #F7F8FA | 247, 248, 250 | `--color-feis-cream` | Page background |
| Cream Dark | #EFF1F3 | 239, 241, 243 | `--color-feis-cream-dark` | Card backgrounds, dividers |
| Border | #D1D5DB | 209, 213, 219 | `--border` | Borders, separators |
| White | #FFFFFF | 255, 255, 255 | `--card` | Card surfaces |

### Accessibility
- Forest Green on White: 7.2:1 (WCAG AAA)
- Charcoal on Cream: 14.8:1 (WCAG AAA)
- Orange on White: 3.6:1 (WCAG AA Large Text)
- All interactive elements meet WCAG 2.1 AA

### Color Rules
- **Green = trust, done, active, primary.** Use for CTAs, confirmed states, navigation.
- **Orange = attention, action needed.** Use sparingly — only for things that require human intervention.
- **Gold = achievement only.** 1st place medal. Do not use for UI chrome.
- **Never use red for non-errors.** Red = destructive actions or real failures only.

---

## 3. Typography

### Font Stack
```css
--font-body: 'Outfit', sans-serif;
--font-mono: 'Geist Mono', monospace;
```

**Outfit** is the sole typeface. Clean, geometric, professional. No display font, no serif. One font, one voice.

**Geist Mono** for all data: scores, competitor numbers, timestamps, stats. Monospace communicates "this is a precise value."

### Type Scale
| Element | Font | Weight | Size | Line Height | Usage |
|---------|------|--------|------|-------------|-------|
| Page Title | Outfit | Bold (700) | 30px / `text-3xl` | 1.2 | Event name, page headings |
| Section Title | Outfit | Semibold (600) | 18px / `text-lg` | 1.4 | Card titles, section headings |
| Subsection | Outfit | Semibold (600) | 16px / `text-base` | 1.5 | "Needs Attention", "All Competitions" |
| Body | Outfit | Regular (400) | 14px / `text-sm` | 1.5 | Default text, descriptions |
| Small | Outfit | Regular (400) | 12px / `text-xs` | 1.4 | Metadata, badges, labels |
| Tiny | Outfit | Regular (400) | 10px / `text-[10px]` | 1.3 | Footer credits, micro-labels |
| Data (large) | Geist Mono | Bold (700) | 28-32px | 1.0 | Competitor numbers on judge page |
| Data (medium) | Geist Mono | Semibold (600) | 18-20px | 1.0 | Competitor numbers in lists |
| Data (small) | Geist Mono | Regular (400) | 14px / `text-sm` | 1.4 | Competition codes, stats, scores |

### Typography Rules
- **Numbers are always monospace.** Competitor numbers, scores, dancer counts, percentages — all Geist Mono.
- **Labels use Outfit.** Headings, names, descriptions, buttons.
- **No bold body text.** Bold is for headings and data emphasis only.
- **No italics** except for legacy/read-only data callouts.

---

## 4. Spacing & Layout

### Spacing Scale
| Token | Value | Usage |
|-------|-------|-------|
| `gap-1` | 4px | Inline element spacing |
| `gap-1.5` | 6px | Badge/chip spacing |
| `gap-2` | 8px | Tight list items |
| `gap-3` | 12px | Form element spacing |
| `gap-4` | 16px | Card content padding |
| `gap-5` | 20px | Section spacing |
| `gap-6` | 24px | Major section gaps |
| `gap-8` | 32px | Page section separation |

### Layout Rules
- **Max content width:** `max-w-3xl` (768px) for public pages, full width for dashboard
- **Card pattern:** `border rounded-md` with `p-3` to `p-4` internal padding. Class: `feis-card`
- **No shadows** on cards. 1px border only. Flat is the aesthetic.
- **No rounded-full** on containers. Slightly rounded corners (`rounded-md` / `rounded-lg`) only.
- **Touch targets:** Minimum 44px height for all interactive elements on tablet/phone views.

---

## 5. Component Patterns

### Badges
| Type | Classes | Usage |
|------|---------|-------|
| Status (green) | `bg-feis-green-light text-feis-green` | Active, published, checked-in |
| Status (orange) | `bg-orange-50 text-orange-700` | Needs attention, warnings |
| Status (gray) | `bg-gray-100 text-gray-600` | Draft, inactive, neutral |
| Outline | `border text-muted-foreground` | Metadata, counts |

### Buttons
| Type | Classes | Usage |
|------|---------|-------|
| Primary | `bg-feis-green text-white` | Main actions (Save, Check In, Publish) |
| Secondary | `border text-foreground` | Cancel, back, secondary actions |
| Destructive | `bg-destructive text-white` | Delete, unpublish (use sparingly) |

### Cards
```css
.feis-card {
  @apply border rounded-md bg-card;
}
```
No shadows. No gradients. Just a border and a surface.

### Data Tables
```css
.feis-thead { @apply bg-feis-cream-dark text-xs uppercase tracking-wider; }
.feis-tbody tr { @apply border-t; }
```

### Score Entry (Judge Variant)
- Competitor number: 28-32px monospace bold, green
- Score input: 24px monospace, 48px height
- Save button: 48px height, fills remaining width
- Expand on number tap for name/comments/flag

### Score Entry (Tabulator Variant)
- Name visible inline (tabulators read off paper)
- Enter/Tab = save + advance
- Compact rows with full detail

---

## 6. States & Feedback

### Save Feedback
| State | Visual |
|-------|--------|
| Idle | Normal border |
| Saving | Button shows "..." |
| Saved | Brief green flash, ✓ checkmark |
| Error | Red border, "Retry" button |

### Empty States
- Always show a message. Never a blank page.
- Use muted text: "No competitions yet. Head to Import to get started."

### Loading States
- Always show `<p className="text-muted-foreground">Loading...</p>`
- No skeleton screens in Phase 1 — simple text indicator.

### Error States
- Use `showError()` or `showCritical()` toasts for action failures
- Use inline red text for form validation
- Use `loadError` state + visible message for page-level data failures
- Never use `console.error` as the only feedback

---

## 7. Navigation

### Event Dashboard Tabs
```
Overview | Competitions | Program | Side-Stage ↗ | Judges | Comments | Import | Results
```

External links (Registration, Side-Stage) open in new tabs with ↗ indicator.

### Registration Desk
Prominent green button in the event header — not buried in tabs.

### Back Navigation
- Every sub-page has a back link: `← Back to [parent]`
- Use `ArrowLeft` icon, small muted text, top-left position

---

## 8. Irish Identity

FeisTab is Irish dance software. The identity comes through in:
- **Color:** Forest green as the primary color (Irish green)
- **Terminology:** Feis, competitor, competition (not "event" or "participant")
- **Precision:** Competition-day software demands accuracy and trust — this IS the Irish identity more than shamrocks would be

What FeisTab does NOT use:
- Celtic fonts
- Shamrock / clover imagery
- Ornamental borders
- Green gradients
- Any decoration that doesn't serve the operator

The Irishness is in the substance, not the decoration.
