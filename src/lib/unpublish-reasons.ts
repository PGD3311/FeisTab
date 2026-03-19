export const UNPUBLISH_REASONS = [
  { value: 'score_correction_needed', label: 'Score correction needed' },
  { value: 'wrong_competition_published', label: 'Wrong competition published' },
  { value: 'premature_publish', label: 'Premature publish' },
  { value: 'other', label: 'Other' },
] as const

export type UnpublishReason = (typeof UNPUBLISH_REASONS)[number]['value']

export const VALID_UNPUBLISH_REASON_VALUES = new Set(
  UNPUBLISH_REASONS.map((r) => r.value)
)
