import { type CommentData, hasCommentContent } from '@/lib/comment-codes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RowStatus = 'empty' | 'dirty' | 'saving' | 'saved' | 'failed'

export interface ScoreRow {
  dancerId: string
  dancerName: string
  competitorNumber: string
  registrationStatus: string
  score: string
  flagged: boolean
  flagReason: string | null
  commentData: CommentData | null
  status: RowStatus
  dbScore: number | null
  saveSeq: number
}

export type ScoreAction =
  | { type: 'SET_SCORE'; dancerId: string; score: string }
  | { type: 'SET_FLAG'; dancerId: string; flagged: boolean; flagReason: string | null }
  | { type: 'SET_COMMENT'; dancerId: string; commentData: CommentData | null }
  | { type: 'MARK_SAVING'; dancerId: string; saveSeq: number }
  | { type: 'MARK_SAVED'; dancerId: string; dbScore: number; saveSeq: number }
  | { type: 'MARK_FAILED'; dancerId: string; saveSeq: number }
  | { type: 'LOAD_EXISTING'; rows: ScoreRow[] }

// ---------------------------------------------------------------------------
// Derived selectors (compute from rows, never store)
// ---------------------------------------------------------------------------

// Keep in sync with NON_ACTIVE_STATUSES in anomalies/types.ts.
// Defined separately because this module must stay pure (no anomaly dependency).
const NON_ACTIVE = new Set(['scratched', 'no_show', 'disqualified', 'did_not_complete', 'medical'])

export function isEditable(row: ScoreRow): boolean {
  return !NON_ACTIVE.has(row.registrationStatus)
}

export function getEditableRows(rows: ScoreRow[]): ScoreRow[] {
  return rows.filter(isEditable)
}

export function getEnteredCount(rows: ScoreRow[]): number {
  return rows.filter(r => isEditable(r) && r.score !== '').length
}

export function getActiveTotal(rows: ScoreRow[]): number {
  return rows.filter(isEditable).length
}

export function getFailedCount(rows: ScoreRow[]): number {
  return rows.filter(r => r.status === 'failed').length
}

export function getFirstEmptyEditableId(rows: ScoreRow[]): string | null {
  return rows.find(r => isEditable(r) && r.status === 'empty')?.dancerId ?? null
}

export function canSignOff(rows: ScoreRow[]): boolean {
  const editable = getEditableRows(rows)
  if (editable.length === 0) return false
  return (
    editable.every(r => r.status === 'saved' || r.status === 'empty') &&
    editable.some(r => r.status === 'saved')
  )
}

export function allSaved(rows: ScoreRow[]): boolean {
  const editable = getEditableRows(rows)
  return editable.length > 0 && editable.every(r => r.status === 'saved' || r.status === 'empty')
}

// ---------------------------------------------------------------------------
// Dirty detection
// ---------------------------------------------------------------------------

function isDirtyScore(score: string, dbScore: number | null): boolean {
  if (dbScore === null) return score !== ''
  const parsed = parseFloat(score)
  if (isNaN(parsed)) return true
  return parsed !== dbScore
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function updateRow(
  rows: ScoreRow[],
  dancerId: string,
  updater: (row: ScoreRow) => ScoreRow
): ScoreRow[] {
  return rows.map(r => (r.dancerId === dancerId ? updater(r) : r))
}

export function scoreReducer(state: ScoreRow[], action: ScoreAction): ScoreRow[] {
  switch (action.type) {
    case 'SET_SCORE':
      return updateRow(state, action.dancerId, row => {
        const newScore = action.score
        const dirty = isDirtyScore(newScore, row.dbScore)
        return {
          ...row,
          score: newScore,
          status:
            newScore === '' && row.dbScore === null ? 'empty' : dirty ? 'dirty' : 'saved',
        }
      })

    case 'SET_FLAG':
      return updateRow(state, action.dancerId, row => {
        const newFlagged = action.flagged
        const rowHasContent =
          row.score !== '' || newFlagged || hasCommentContent(row.commentData, null)
        return {
          ...row,
          flagged: newFlagged,
          flagReason: action.flagReason,
          status: rowHasContent ? 'dirty' : row.dbScore === null ? 'empty' : 'dirty',
        }
      })

    case 'SET_COMMENT':
      return updateRow(state, action.dancerId, row => {
        const newCommentData = action.commentData
        const rowHasContent =
          row.score !== '' || row.flagged || hasCommentContent(newCommentData, null)
        return {
          ...row,
          commentData: newCommentData,
          status: rowHasContent ? 'dirty' : row.dbScore === null ? 'empty' : 'dirty',
        }
      })

    case 'MARK_SAVING':
      return updateRow(state, action.dancerId, row => ({
        ...row,
        status: 'saving',
        saveSeq: action.saveSeq,
      }))

    case 'MARK_SAVED':
      return updateRow(state, action.dancerId, row => {
        if (row.saveSeq !== action.saveSeq) return row
        return { ...row, status: 'saved', dbScore: action.dbScore }
      })

    case 'MARK_FAILED':
      return updateRow(state, action.dancerId, row => {
        if (row.saveSeq !== action.saveSeq) return row
        return { ...row, status: 'failed' }
      })

    case 'LOAD_EXISTING':
      return action.rows

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Initial row builder
// ---------------------------------------------------------------------------

interface RegistrationInput {
  dancerId: string
  dancerName: string
  competitorNumber: string
  registrationStatus: string
}

interface ExistingScore {
  dancerId: string
  rawScore: number
  flagged: boolean
  flagReason: string | null
  commentData: CommentData | null
}

export function buildInitialRows(
  registrations: RegistrationInput[],
  existingScores: ExistingScore[]
): ScoreRow[] {
  const scoreMap = new Map(existingScores.map(s => [s.dancerId, s]))
  return registrations.map((reg): ScoreRow => {
    const existing = scoreMap.get(reg.dancerId)
    if (existing) {
      return {
        dancerId: reg.dancerId,
        dancerName: reg.dancerName,
        competitorNumber: reg.competitorNumber,
        registrationStatus: reg.registrationStatus,
        score: String(existing.rawScore),
        flagged: existing.flagged,
        flagReason: existing.flagReason,
        commentData: existing.commentData,
        status: 'saved',
        dbScore: existing.rawScore,
        saveSeq: 0,
      }
    }
    return {
      dancerId: reg.dancerId,
      dancerName: reg.dancerName,
      competitorNumber: reg.competitorNumber,
      registrationStatus: reg.registrationStatus,
      score: '',
      flagged: false,
      flagReason: null,
      commentData: null,
      status: 'empty',
      dbScore: null,
      saveSeq: 0,
    }
  })
}
