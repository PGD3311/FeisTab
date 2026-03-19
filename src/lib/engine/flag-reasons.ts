export const FLAG_REASONS = [
  { value: 'early_start', label: 'Early Start' },
  { value: 'did_not_complete', label: 'Did Not Complete' },
  { value: 'other', label: 'Other' },
] as const

export type FlagReason = (typeof FLAG_REASONS)[number]['value']

export const VALID_FLAG_REASON_VALUES: Set<string> = new Set(FLAG_REASONS.map(r => r.value))
