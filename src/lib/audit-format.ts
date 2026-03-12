// src/lib/audit-format.ts

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

// --- Formatter helpers (not exported) ---

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
    const count = get(entry.after_data, 'result_count') ?? '?'
    return { summary: `${count} results saved`, actor: 'Organizer' }
  },

  result_publish() {
    return { summary: 'Results published', actor: 'Organizer' }
  },

  result_unpublish() {
    return { summary: 'Results unpublished', actor: 'Organizer' }
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

  import() {
    return { summary: 'Data imported', actor: 'Organizer' }
  },
}

export function formatAuditEntry(entry: AuditEntry, names: NameMaps): FormattedAudit {
  const badge = getBadge(entry.action)
  const hasRawData = entry.after_data !== null || entry.before_data !== null

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
  const pairs = entry.after_data
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
