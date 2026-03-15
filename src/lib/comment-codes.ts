/**
 * Comment codes and validation for judge feedback.
 * Pure functions — no Supabase, no React.
 */

export interface CommentData {
  codes: string[]
  note: string | null
}

export const COMMENT_CODES = [
  { code: 'turnout', label: 'Turnout' },
  { code: 'timing', label: 'Timing' },
  { code: 'rhythm', label: 'Rhythm' },
  { code: 'posture', label: 'Posture' },
  { code: 'presentation', label: 'Presentation' },
  { code: 'carriage', label: 'Carriage' },
] as const

const VALID_CODES = new Set(COMMENT_CODES.map(c => c.code))

/**
 * Validates and normalizes comment data before save.
 * Strips unknown codes, trims note, returns null if empty.
 */
export function validateCommentData(data: CommentData | null): CommentData | null {
  if (!data) return null

  const codes = data.codes.filter(c => {
    if (VALID_CODES.has(c)) return true
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`Unknown comment code stripped: "${c}"`)
    }
    return false
  })

  const note = data.note?.trim() || null

  if (codes.length === 0 && !note) return null

  return { codes, note }
}

/**
 * Checks whether any comment content exists (structured or legacy).
 * Used to show/hide the comment indicator in collapsed state.
 */
export function hasCommentContent(
  commentData: CommentData | null,
  legacyComments: string | null
): boolean {
  if (commentData && (commentData.codes.length > 0 || commentData.note)) return true
  if (legacyComments && legacyComments.trim().length > 0) return true
  return false
}
