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

export interface NameMaps {
  judges: Map<string, string>   // judge_id → "First Last"
  dancers: Map<string, string>  // dancer_id → "First Last (#number)"
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

const BADGE_MAP: Record<string, BadgeConfig> = {
  score_submit: { text: 'Score', color: 'bg-blue-50 text-blue-700', filterGroup: 'scores' },
  score_transcribe: { text: 'Score', color: 'bg-blue-50 text-blue-700', filterGroup: 'scores' },
  score_edit: { text: 'Score', color: 'bg-blue-50 text-blue-700', filterGroup: 'scores' },
  sign_off: { text: 'Sign-off', color: 'bg-feis-green-light text-feis-green', filterGroup: 'signoffs' },
  status_change: { text: 'Status', color: 'bg-gray-100 text-gray-600', filterGroup: 'status' },
  tabulate: { text: 'Tabulation', color: 'bg-feis-green-light text-feis-green', filterGroup: 'tabulation' },
  unlock_for_correction: { text: 'Correction', color: 'bg-orange-50 text-orange-700', filterGroup: 'corrections' },
  result_publish: { text: 'Published', color: 'bg-feis-green-light text-feis-green', filterGroup: 'publish' },
  result_unpublish: { text: 'Unpublished', color: 'bg-gray-100 text-gray-600', filterGroup: 'publish' },
  recall_generate: { text: 'Recall', color: 'bg-feis-green-light text-feis-green', filterGroup: 'recalls' },
  import: { text: 'Import', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  scratch: { text: 'Status', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  disqualify: { text: 'Status', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
  competition_update: { text: 'Update', color: 'bg-gray-100 text-gray-600', filterGroup: 'other' },
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
  { value: 'other', label: 'Other' },
]

export function getBadge(action: string): BadgeConfig {
  return BADGE_MAP[action] ?? { text: action, color: 'bg-gray-100 text-gray-600', filterGroup: 'other' }
}

export function matchesFilter(action: string, filter: string): boolean {
  if (filter === 'all') return true
  return getBadge(action).filterGroup === filter
}

import { UNPUBLISH_REASONS } from '@/lib/unpublish-reasons'

// --- Formatter helpers (not exported) ---

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
      actor: judge ?? 'Judge',
    }
  },

  score_transcribe(entry, names) {
    const d = entry.after_data
    const dancer = resolveDancer(get(d, 'dancer_id'), names) ?? String(get(d, 'dancer_id') ?? '?')
    const score = get(d, 'raw_score') ?? '?'
    const judge = resolveJudge(get(d, 'judge_id'), names) ?? 'judge'
    return {
      summary: `Transcribed ${score} for ${dancer} · Judge: ${judge}`,
      actor: 'Tabulator',
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
      actor: resolveJudge(get(d, 'judge_id'), names) ?? 'Judge',
    }
  },

  status_change(entry) {
    const d = entry.after_data ?? entry.before_data
    const from = get(d, 'from') ?? get(d, 'status')
    const to = get(d, 'to') ?? get(d, 'status')
    const trigger = get(d, 'trigger')
    let summary = ''
    if (from && to) {
      summary = `${humanizeStatus(String(from))} → ${humanizeStatus(String(to))}`
    } else if (to) {
      summary = `Status: ${humanizeStatus(String(to))}`
    } else {
      summary = 'Status changed'
    }
    if (trigger) summary += ` · ${trigger}`
    return {
      summary,
      actor: trigger ? 'System' : 'Organizer',
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

  result_publish(entry) {
    const d = entry.after_data
    const approvedBy = typeof get(d, 'approved_by') === 'string' ? (get(d, 'approved_by') as string) : null
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
      actor: unpublishedBy ?? 'Organizer',
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
  },
}

export function formatAuditEntry(entry: AuditEntry, names: NameMaps): FormattedAudit {
  const badge = getBadge(entry.action)
  const hasRawData = isPlainObject(entry.after_data) || isPlainObject(entry.before_data)

  try {
    const formatter = formatters[entry.action]
    if (formatter) {
      const { summary, actor } = formatter(entry, names)
      return {
        summary,
        actor,
        badgeText: badge.text,
        badgeColor: badge.color,
        isCorrection: entry.action === 'unlock_for_correction',
        hasRawData,
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
    actor: 'Unknown',
    badgeText: badge.text,
    badgeColor: badge.color,
    isCorrection: false,
    hasRawData,
  }
}
