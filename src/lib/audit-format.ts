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
