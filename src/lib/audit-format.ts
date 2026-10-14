import { UNPUBLISH_REASONS } from '@/lib/unpublish-reasons'

export interface AuditEntry {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  created_at: string
}

export interface ScoreEntryRef {
  judge_id: string
  dancer_id: string
}

export interface NameMaps {
  judges: Map<string, string> // judge_id → "First Last"
  dancers: Map<string, string> // dancer_id → "First Last (#number)"
  judgesByUser?: Map<string, string> // auth user_id → judge "First Last"
  rolesByUser?: Map<string, string[]> // auth user_id → event roles
  rounds?: Map<string, number> // round_id → round_number
  scoreEntries?: Map<string, ScoreEntryRef> // score_entry id → judge/dancer
}

export interface FormattedAudit {
  summary: string
  actor: string
  badgeText: string
  badgeColor: string
  isCorrection: boolean
  hasRawData: boolean
}

interface BadgeConfig {
  text: string
  color: string
  filterGroup: string
}

const SCORE_BADGE: BadgeConfig = {
  text: 'Score',
  color: 'bg-blue-50 text-blue-700',
  filterGroup: 'scores'
}
const SIGN_OFF_BADGE: BadgeConfig = {
  text: 'Sign-off',
  color: 'bg-feis-green-light text-feis-green',
  filterGroup: 'signoffs'
}
const STATUS_BADGE: BadgeConfig = {
  text: 'Status',
  color: 'bg-gray-100 text-gray-600',
  filterGroup: 'status'
}
const TABULATION_BADGE: BadgeConfig = {
  text: 'Tabulation',
  color: 'bg-feis-green-light text-feis-green',
  filterGroup: 'tabulation'
}
const PUBLISHED_BADGE: BadgeConfig = {
  text: 'Published',
  color: 'bg-feis-green-light text-feis-green',
  filterGroup: 'publish'
}
const UNPUBLISHED_BADGE: BadgeConfig = {
  text: 'Unpublished',
  color: 'bg-gray-100 text-gray-600',
  filterGroup: 'publish'
}
const RECALL_BADGE: BadgeConfig = {
  text: 'Recall',
  color: 'bg-feis-green-light text-feis-green',
  filterGroup: 'recalls'
}
const ROSTER_BADGE: BadgeConfig = {
  text: 'Roster',
  color: 'bg-gray-100 text-gray-600',
  filterGroup: 'other'
}

const BADGE_MAP: Record<string, BadgeConfig> = {
  // Legacy client-side writes
  score_submit: SCORE_BADGE,
  score_transcribe: SCORE_BADGE,
  score_edit: SCORE_BADGE,
  sign_off: SIGN_OFF_BADGE,
  tabulate: TABULATION_BADGE,
  result_publish: PUBLISHED_BADGE,
  result_unpublish: UNPUBLISHED_BADGE,
  recall_generate: RECALL_BADGE,
  transition_status: STATUS_BADGE,
  import: { text: 'Import', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  scratch: { text: 'Status', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  disqualify: { text: 'Status', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  competition_update: { text: 'Update', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  // Trigger + RPC writes (migrations 025–033)
  status_change: STATUS_BADGE,
  submit_score: SCORE_BADGE,
  tabulator_enter_score: SCORE_BADGE,
  sign_off_judge: SIGN_OFF_BADGE,
  unlock_for_correction: {
    text: 'Correction',
    color: 'bg-orange-50 text-orange-700',
    filterGroup: 'corrections'
  },
  approve_tabulation: TABULATION_BADGE,
  publish_results: PUBLISHED_BADGE,
  unpublish_results: UNPUBLISHED_BADGE,
  generate_recall: RECALL_BADGE,
  set_registration_status: {
    text: 'Dancer',
    color: 'bg-gray-100 text-gray-600',
    filterGroup: 'status'
  },
  register_dancer: { text: 'Dancer', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  create_round: { text: 'Round', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  confirm_roster: ROSTER_BADGE,
  unconfirm_roster: ROSTER_BADGE
}

export const FILTER_GROUPS: { value: string; label: string }[] = [
  { value: 'all', label: 'All actions' },
  { value: 'scores', label: 'Score entries' },
  { value: 'signoffs', label: 'Sign-offs' },
  { value: 'status', label: 'Status changes' },
  { value: 'corrections', label: 'Corrections' },
  { value: 'tabulation', label: 'Tabulation' },
  { value: 'publish', label: 'Publish/unpublish' },
  { value: 'recalls', label: 'Recalls' },
  { value: 'other', label: 'Other' }
]

export function getBadge(action: string): BadgeConfig {
  return (
    BADGE_MAP[action] ?? { text: action, color: 'bg-gray-100 text-gray-600', filterGroup: 'other' }
  )
}

export function matchesFilter(action: string, filter: string): boolean {
  if (filter === 'all') return true
  return getBadge(action).filterGroup === filter
}

// --- Actor resolution ---

const ROLE_LABELS: [role: string, label: string][] = [
  ['organizer', 'Organizer'],
  ['side_stage', 'Side-stage'],
  ['registration_desk', 'Registration desk'],
  ['judge', 'Judge']
]

/**
 * Who performed the action, from audit_log.user_id.
 * A linked judge login → "Judge First Last"; otherwise the user's event role.
 * Returns null when the row has no user_id (legacy writes) or no lookup maps
 * were supplied, so the caller can fall back to the per-action guess.
 */
export function resolveActor(userId: string | null, names: NameMaps): string | null {
  if (!userId) return null
  if (!names.judgesByUser && !names.rolesByUser) return null

  const judgeName = names.judgesByUser?.get(userId)
  if (judgeName) return `Judge ${judgeName}`

  const roles = names.rolesByUser?.get(userId) ?? []
  for (const [role, label] of ROLE_LABELS) {
    if (roles.includes(role)) return label
  }
  return 'Unknown user'
}

// --- Ordering ---

function statusOf(data: Record<string, unknown> | null): string | null {
  const s = data?.status
  return typeof s === 'string' ? s : null
}

function isStatusRow(entry: AuditEntry): boolean {
  return entry.action === 'status_change' && entry.entity_type === 'competition'
}

/**
 * Newest first. Rows written in one transaction share a timestamp (e.g. a sign-off
 * and the status changes it triggers); within a tie the triggered status changes go
 * above their cause, and chained status changes (A → B, B → C) stay in sequence.
 */
export function sortAuditEntries(entries: AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => {
    const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    if (diff !== 0) return diff

    const aStatus = isStatusRow(a)
    const bStatus = isStatusRow(b)
    if (aStatus !== bStatus) return aStatus ? -1 : 1
    if (aStatus && bStatus) {
      if (statusOf(a.after_data) === statusOf(b.before_data)) return 1
      if (statusOf(b.after_data) === statusOf(a.before_data)) return -1
    }
    return 0
  })
}

// --- Formatter helpers ---

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function humanizeStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function resolveJudge(judgeId: unknown, names: NameMaps): string | null {
  if (typeof judgeId !== 'string') return null
  return names.judges.get(judgeId) ?? null
}

function resolveDancer(dancerId: unknown, names: NameMaps): string | null {
  if (typeof dancerId !== 'string') return null
  return names.dancers.get(dancerId) ?? null
}

/** "Judge First Last", or "a judge" when unknown */
function judgeLabel(judgeId: unknown, names: NameMaps): string {
  const name = resolveJudge(judgeId, names)
  return name ? `Judge ${name}` : 'a judge'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function roundLabel(roundId: string, names: NameMaps): string | null {
  const n = names.rounds?.get(roundId)
  return n === undefined ? null : `round ${n}`
}

function get(data: Record<string, unknown> | null, key: string): unknown {
  return data?.[key] ?? null
}

type Formatter = (entry: AuditEntry, names: NameMaps) => { summary: string; actor: string }

const formatters: Record<string, Formatter> = {
  score_submit(entry, names) {
    const d = entry.after_data
    const dancer = resolveDancer(get(d, 'dancer_id'), names) ?? String(get(d, 'dancer_id') ?? '?')
    const score = get(d, 'raw_score') ?? '?'
    const mode = get(d, 'entry_mode') ?? ''
    const judge = resolveJudge(get(d, 'judge_id'), names)
    return {
      summary: `Score: ${score} for ${dancer} · ${mode}`,
      actor: judge ?? 'Judge'
    }
  },

  score_transcribe(entry, names) {
    const d = entry.after_data
    const dancer = resolveDancer(get(d, 'dancer_id'), names) ?? String(get(d, 'dancer_id') ?? '?')
    const score = get(d, 'raw_score') ?? '?'
    const judge = resolveJudge(get(d, 'judge_id'), names) ?? 'judge'
    return {
      summary: `Transcribed ${score} for ${dancer} · Judge: ${judge}`,
      actor: 'Tabulator'
    }
  },

  // submit_score RPC: entity is the score_entry; judge comes from that row
  submit_score(entry, names) {
    const d = entry.after_data
    const ref = names.scoreEntries?.get(entry.entity_id)
    const dancer = resolveDancer(get(d, 'dancer_id') ?? ref?.dancer_id, names) ?? 'unknown dancer'
    const score = get(d, 'raw_score')
    const judge = judgeLabel(ref?.judge_id, names)
    const scorePart = score !== null ? `Score ${score}` : 'Score'
    return {
      summary: `${scorePart} entered for ${dancer} by ${judge}`,
      actor: judge === 'a judge' ? 'Judge' : judge
    }
  },

  // tabulator_enter_score RPC: organizer types in a judge's paper sheet
  tabulator_enter_score(entry, names) {
    const d = entry.after_data
    const ref = names.scoreEntries?.get(entry.entity_id)
    const dancer = resolveDancer(get(d, 'dancer_id') ?? ref?.dancer_id, names) ?? 'unknown dancer'
    const judge = judgeLabel(get(d, 'judge_id') ?? ref?.judge_id, names)
    return {
      summary: `Score entered for ${dancer} by ${judge} · transcribed from score sheet`,
      actor: 'Organizer'
    }
  },

  sign_off(entry, names) {
    const d = entry.after_data
    const judge = resolveJudge(get(d, 'judge_id'), names) ?? String(get(d, 'judge_id') ?? 'Judge')
    const mode = get(d, 'entry_mode') ?? ''
    const allDone = get(d, 'all_judges_done')
    let summary = `${judge} signed off · ${mode}`
    if (allDone) summary += ' · all judges done'
    return {
      summary,
      actor: resolveJudge(get(d, 'judge_id'), names) ?? 'Judge'
    }
  },

  // sign_off_judge RPC: entity is the round; action is 'add' or 'remove'
  sign_off_judge(entry, names) {
    const d = entry.after_data
    const judge = judgeLabel(get(d, 'judge_id'), names)
    const round = roundLabel(entry.entity_id, names)
    const summary =
      get(d, 'action') === 'remove'
        ? `Sign-off reopened for ${judge}${round ? ` · ${round}` : ''}`
        : `${capitalize(judge)} signed off${round ? ` ${round}` : ''}`
    return { summary, actor: 'Unknown' }
  },

  // Trigger rows: before_data.status → after_data.status.
  // Legacy rows: after_data.from → after_data.to.
  status_change(entry, names) {
    const from = get(entry.after_data, 'from') ?? get(entry.before_data, 'status')
    const to = get(entry.after_data, 'to') ?? get(entry.after_data, 'status')
    const trigger = get(entry.after_data, 'trigger')
    let summary = ''
    if (from && to) {
      summary = `${humanizeStatus(String(from))} → ${humanizeStatus(String(to))}`
    } else if (to) {
      summary = `Status: ${humanizeStatus(String(to))}`
    } else {
      summary = 'Status changed'
    }
    if (entry.entity_type === 'registration') {
      const dancerId = get(entry.after_data, 'dancer_id') ?? get(entry.before_data, 'dancer_id')
      const dancer = resolveDancer(dancerId, names) ?? 'Dancer'
      summary = `${dancer}: ${summary}`
    }
    if (trigger) summary += ` · ${trigger}`
    return {
      summary,
      actor: trigger ? 'System' : 'Organizer'
    }
  },

  tabulate(entry) {
    const d = entry.after_data
    const count = get(d, 'result_count') ?? '?'
    const approved = get(d, 'preview_approved')
    const roundId = get(d, 'round_id')
    let summary = `${count} results saved`
    if (approved) summary += ' (approved)'
    if (roundId) summary += ` · round ${roundId}`
    return { summary, actor: 'Organizer' }
  },

  approve_tabulation(entry) {
    const count = get(entry.after_data, 'result_count') ?? '?'
    return { summary: `${count} results approved and saved`, actor: 'Organizer' }
  },

  result_publish(entry) {
    const d = entry.after_data
    const approvedBy =
      typeof get(d, 'approved_by') === 'string' ? (get(d, 'approved_by') as string) : null
    if (approvedBy) {
      return { summary: `Results published by ${approvedBy}`, actor: approvedBy }
    }
    return { summary: 'Results published', actor: 'Organizer' }
  },

  result_unpublish(entry) {
    const d = entry.after_data
    const unpublishedBy =
      typeof get(d, 'unpublished_by') === 'string' ? (get(d, 'unpublished_by') as string) : null
    const reason = typeof get(d, 'reason') === 'string' ? (get(d, 'reason') as string) : null
    const note = typeof get(d, 'note') === 'string' ? (get(d, 'note') as string) : null

    if (!reason) {
      return { summary: 'Results unpublished', actor: unpublishedBy ?? 'Organizer' }
    }

    let reasonLabel: string
    if (reason === 'other' && note) {
      reasonLabel = note
    } else {
      const match = UNPUBLISH_REASONS.find((r) => r.value === reason)
      reasonLabel = match ? match.label : reason
    }

    return {
      summary: `Results unpublished · ${reasonLabel}`,
      actor: unpublishedBy ?? 'Organizer'
    }
  },

  unlock_for_correction(entry, names) {
    const d = entry.after_data
    const judge =
      resolveJudge(get(d, 'judge_id'), names) ?? String(get(d, 'judge_name') ?? 'judge')
    const reason = get(d, 'reason') ?? ''
    const note = get(d, 'note')
    let summary = `Unlocked ${judge} · ${reason}`
    if (note) summary += ` · ${note}`
    return { summary, actor: 'Organizer' }
  },

  recall_generate(entry) {
    const count = get(entry.after_data, 'recalled_count') ?? '?'
    return { summary: `${count} dancers recalled`, actor: 'Organizer' }
  },

  generate_recall(entry, names) {
    const count = get(entry.after_data, 'recall_count') ?? '?'
    const round = roundLabel(entry.entity_id, names)
    return {
      summary: `${count} dancers recalled${round ? ` to ${round}` : ''}`,
      actor: 'Organizer'
    }
  },

  create_round(entry) {
    const n = get(entry.after_data, 'round_number')
    return { summary: n !== null ? `Round ${n} created` : 'Round created', actor: 'Organizer' }
  },

  register_dancer(entry, names) {
    const dancer = resolveDancer(get(entry.after_data, 'dancer_id'), names) ?? 'Dancer'
    return { summary: `${dancer} registered`, actor: 'Organizer' }
  },

  confirm_roster() {
    return { summary: 'Roster confirmed', actor: 'Organizer' }
  },

  unconfirm_roster() {
    return { summary: 'Roster unconfirmed', actor: 'Organizer' }
  },

  import(entry) {
    const d = entry.after_data
    const parts: string[] = []
    const compCount = get(d, 'competition_count')
    const dancerCount = get(d, 'dancer_count')
    const registrationCount = get(d, 'registration_count')
    if (compCount) parts.push(`${compCount} competitions`)
    if (dancerCount) parts.push(`${dancerCount} dancers`)
    if (registrationCount) parts.push(`${registrationCount} registrations`)
    const summary = parts.length > 0 ? `Imported ${parts.join(', ')}` : 'CSV data imported'
    return { summary, actor: 'Organizer' }
  }
}

// RPCs that log under their own names but share a legacy shape
formatters.unpublish_results = formatters.result_unpublish
formatters.publish_results = formatters.result_publish
formatters.transition_status = formatters.status_change
formatters.set_registration_status = formatters.status_change

export function formatAuditEntry(entry: AuditEntry, names: NameMaps): FormattedAudit {
  const badge = getBadge(entry.action)
  const hasRawData = isPlainObject(entry.after_data) || isPlainObject(entry.before_data)
  const resolvedActor = resolveActor(entry.user_id, names)

  try {
    const formatter = formatters[entry.action]
    if (formatter) {
      const { summary, actor } = formatter(entry, names)
      return {
        summary,
        actor: resolvedActor ?? actor,
        badgeText: badge.text,
        badgeColor: badge.color,
        isCorrection: entry.action === 'unlock_for_correction',
        hasRawData
      }
    }
  } catch {
    // Formatter failed — fall through to generic
  }

  // Generic fallback for unknown or failed actions
  const pairs = isPlainObject(entry.after_data)
    ? Object.entries(entry.after_data)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
    : ''
  return {
    summary: pairs ? `${entry.action}: ${pairs}` : entry.action,
    actor: resolvedActor ?? 'Unknown',
    badgeText: badge.text,
    badgeColor: badge.color,
    isCorrection: false,
    hasRawData
  }
}
