import { describe, it, expect } from 'vitest'
import {
  scoreReducer,
  buildInitialRows,
  type ScoreRow,
  isEditable,
  getEnteredCount,
  getActiveTotal,
  getFailedCount,
  getFirstEmptyEditableId,
  canSignOff,
  allSaved,
} from '@/lib/engine/tabulator-state'

function makeRow(overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    dancerId: 'd1',
    dancerName: 'Sienna Walsh',
    competitorNumber: '102',
    registrationStatus: 'present',
    score: '',
    flagged: false,
    flagReason: null,
    commentData: null,
    status: 'empty',
    dbScore: null,
    saveSeq: 0,
    ...overrides,
  }
}

describe('scoreReducer', () => {
  describe('SET_SCORE', () => {
    it('empty → dirty when user types a score', () => {
      const rows = [makeRow()]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '75' })
      expect(result[0].score).toBe('75')
      expect(result[0].status).toBe('dirty')
    })

    it('saved → dirty when user edits a saved score', () => {
      const rows = [makeRow({ status: 'saved', dbScore: 75, score: '75' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '80' })
      expect(result[0].status).toBe('dirty')
    })

    it('saved stays saved when edited back to dbScore value', () => {
      const rows = [makeRow({ status: 'saved', dbScore: 75, score: '80' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '75' })
      expect(result[0].status).toBe('saved')
    })

    it('failed → dirty when user edits a failed score', () => {
      const rows = [makeRow({ status: 'failed', score: '75', saveSeq: 1 })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '80' })
      expect(result[0].status).toBe('dirty')
    })

    it('dirty → saved when score is edited back to dbScore (no-op shortcut)', () => {
      const rows = [makeRow({ status: 'dirty', dbScore: 75, score: '80' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '75' })
      expect(result[0].status).toBe('saved')
    })

    it('dirty → empty when score is cleared and no dbScore exists', () => {
      const rows = [makeRow({ status: 'dirty', dbScore: null, score: '75' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '' })
      expect(result[0].status).toBe('empty')
    })

    it('dirty detection handles float coercion: "75.0" matches dbScore 75', () => {
      const rows = [makeRow({ status: 'dirty', dbScore: 75, score: '80' })]
      const result = scoreReducer(rows, { type: 'SET_SCORE', dancerId: 'd1', score: '75.0' })
      expect(result[0].status).toBe('saved')
    })
  })

  describe('MARK_SAVING', () => {
    it('dirty → saving with saveSeq', () => {
      const rows = [makeRow({ status: 'dirty', score: '75' })]
      const result = scoreReducer(rows, { type: 'MARK_SAVING', dancerId: 'd1', saveSeq: 1 })
      expect(result[0].status).toBe('saving')
      expect(result[0].saveSeq).toBe(1)
    })
  })

  describe('MARK_SAVED', () => {
    it('saving → saved when saveSeq matches', () => {
      const rows = [makeRow({ status: 'saving', score: '75', saveSeq: 1 })]
      const result = scoreReducer(rows, { type: 'MARK_SAVED', dancerId: 'd1', dbScore: 75, saveSeq: 1 })
      expect(result[0].status).toBe('saved')
      expect(result[0].dbScore).toBe(75)
    })

    it('ignores stale MARK_SAVED when saveSeq does not match', () => {
      const rows = [makeRow({ status: 'saving', score: '80', saveSeq: 2 })]
      const result = scoreReducer(rows, { type: 'MARK_SAVED', dancerId: 'd1', dbScore: 75, saveSeq: 1 })
      expect(result[0].status).toBe('saving')
      expect(result[0].dbScore).toBeNull()
    })
  })

  describe('MARK_FAILED', () => {
    it('saving → failed when saveSeq matches', () => {
      const rows = [makeRow({ status: 'saving', score: '75', saveSeq: 1 })]
      const result = scoreReducer(rows, { type: 'MARK_FAILED', dancerId: 'd1', saveSeq: 1 })
      expect(result[0].status).toBe('failed')
    })

    it('ignores stale MARK_FAILED when saveSeq does not match', () => {
      const rows = [makeRow({ status: 'saving', score: '80', saveSeq: 2 })]
      const result = scoreReducer(rows, { type: 'MARK_FAILED', dancerId: 'd1', saveSeq: 1 })
      expect(result[0].status).toBe('saving')
    })
  })

  describe('SET_FLAG', () => {
    it('sets flagged and flagReason, marks dirty', () => {
      const rows = [makeRow({ status: 'saved', dbScore: 75, score: '75' })]
      const result = scoreReducer(rows, { type: 'SET_FLAG', dancerId: 'd1', flagged: true, flagReason: 'early_start' })
      expect(result[0].flagged).toBe(true)
      expect(result[0].flagReason).toBe('early_start')
      expect(result[0].status).toBe('dirty')
    })

    it('empty → dirty when flag is set (flag without score must be saveable)', () => {
      const rows = [makeRow({ status: 'empty' })]
      const result = scoreReducer(rows, { type: 'SET_FLAG', dancerId: 'd1', flagged: true, flagReason: 'early_start' })
      expect(result[0].status).toBe('dirty')
    })

    it('dirty → empty when flag is removed on row with no score and no comments', () => {
      const rows = [makeRow({ status: 'dirty', flagged: true, flagReason: 'early_start' })]
      const result = scoreReducer(rows, { type: 'SET_FLAG', dancerId: 'd1', flagged: false, flagReason: null })
      expect(result[0].flagged).toBe(false)
      expect(result[0].status).toBe('empty')
    })

    it('stays dirty when flag is removed but row has a score', () => {
      const rows = [makeRow({ status: 'dirty', score: '75', flagged: true, flagReason: 'early_start' })]
      const result = scoreReducer(rows, { type: 'SET_FLAG', dancerId: 'd1', flagged: false, flagReason: null })
      expect(result[0].status).toBe('dirty')
    })

    it('stays dirty when flag is removed but row has comments', () => {
      const rows = [makeRow({ status: 'dirty', flagged: true, flagReason: 'early_start', commentData: { codes: ['turnout'], note: null } })]
      const result = scoreReducer(rows, { type: 'SET_FLAG', dancerId: 'd1', flagged: false, flagReason: null })
      expect(result[0].status).toBe('dirty')
    })
  })

  describe('SET_COMMENT', () => {
    it('sets commentData and marks dirty', () => {
      const rows = [makeRow({ status: 'saved', dbScore: 75, score: '75' })]
      const result = scoreReducer(rows, { type: 'SET_COMMENT', dancerId: 'd1', commentData: { codes: ['turnout'], note: null } })
      expect(result[0].commentData).toEqual({ codes: ['turnout'], note: null })
      expect(result[0].status).toBe('dirty')
    })

    it('empty → dirty when comment is set (comment without score must be saveable)', () => {
      const rows = [makeRow({ status: 'empty' })]
      const result = scoreReducer(rows, { type: 'SET_COMMENT', dancerId: 'd1', commentData: { codes: ['timing'], note: null } })
      expect(result[0].status).toBe('dirty')
    })

    it('dirty → empty when comment is removed on row with no score and no flag', () => {
      const rows = [makeRow({ status: 'dirty', commentData: { codes: ['turnout'], note: null } })]
      const result = scoreReducer(rows, { type: 'SET_COMMENT', dancerId: 'd1', commentData: null })
      expect(result[0].commentData).toBeNull()
      expect(result[0].status).toBe('empty')
    })

    it('stays dirty when comment is removed but row has a score', () => {
      const rows = [makeRow({ status: 'dirty', score: '75', commentData: { codes: ['turnout'], note: null } })]
      const result = scoreReducer(rows, { type: 'SET_COMMENT', dancerId: 'd1', commentData: null })
      expect(result[0].status).toBe('dirty')
    })

    it('stays dirty when comment is removed but row is flagged', () => {
      const rows = [makeRow({ status: 'dirty', flagged: true, flagReason: 'early_start', commentData: { codes: ['turnout'], note: null } })]
      const result = scoreReducer(rows, { type: 'SET_COMMENT', dancerId: 'd1', commentData: null })
      expect(result[0].status).toBe('dirty')
    })
  })

  describe('LOAD_EXISTING', () => {
    it('replaces entire state', () => {
      const oldRows = [makeRow({ dancerId: 'd1' })]
      const newRows = [makeRow({ dancerId: 'd2' }), makeRow({ dancerId: 'd3' })]
      const result = scoreReducer(oldRows, { type: 'LOAD_EXISTING', rows: newRows })
      expect(result).toHaveLength(2)
      expect(result[0].dancerId).toBe('d2')
    })
  })
})

describe('buildInitialRows', () => {
  it('marks rows with existing scores as saved', () => {
    const registrations = [
      { dancerId: 'd1', dancerName: 'A', competitorNumber: '101', registrationStatus: 'present' },
      { dancerId: 'd2', dancerName: 'B', competitorNumber: '102', registrationStatus: 'present' },
    ]
    const existingScores = [
      { dancerId: 'd1', rawScore: 75, flagged: false, flagReason: null, commentData: null },
    ]
    const rows = buildInitialRows(registrations, existingScores)
    expect(rows[0].status).toBe('saved')
    expect(rows[0].dbScore).toBe(75)
    expect(rows[0].score).toBe('75')
    expect(rows[1].status).toBe('empty')
    expect(rows[1].dbScore).toBeNull()
  })

  it('includes non-active registrations with empty status', () => {
    const registrations = [
      { dancerId: 'd1', dancerName: 'A', competitorNumber: '101', registrationStatus: 'scratched' },
    ]
    const rows = buildInitialRows(registrations, [])
    expect(rows[0].registrationStatus).toBe('scratched')
    expect(rows[0].status).toBe('empty')
  })
})

describe('selectors', () => {
  it('isEditable returns false for non-active statuses', () => {
    expect(isEditable(makeRow({ registrationStatus: 'scratched' }))).toBe(false)
    expect(isEditable(makeRow({ registrationStatus: 'no_show' }))).toBe(false)
    expect(isEditable(makeRow({ registrationStatus: 'present' }))).toBe(true)
    expect(isEditable(makeRow({ registrationStatus: 'checked_in' }))).toBe(true)
  })

  it('getEnteredCount counts only editable rows with scores', () => {
    const rows = [
      makeRow({ dancerId: 'd1', score: '75', registrationStatus: 'present' }),
      makeRow({ dancerId: 'd2', score: '', registrationStatus: 'present' }),
      makeRow({ dancerId: 'd3', score: '80', registrationStatus: 'scratched' }),
    ]
    expect(getEnteredCount(rows)).toBe(1)
  })

  it('getActiveTotal counts only editable rows', () => {
    const rows = [
      makeRow({ registrationStatus: 'present' }),
      makeRow({ registrationStatus: 'scratched' }),
      makeRow({ registrationStatus: 'present' }),
    ]
    expect(getActiveTotal(rows)).toBe(2)
  })

  it('getFailedCount counts failed rows', () => {
    const rows = [
      makeRow({ status: 'failed' }),
      makeRow({ status: 'saved' }),
      makeRow({ status: 'failed' }),
    ]
    expect(getFailedCount(rows)).toBe(2)
  })

  it('getFirstEmptyEditableId skips non-editable and non-empty rows', () => {
    const rows = [
      makeRow({ dancerId: 'd1', status: 'saved', registrationStatus: 'present' }),
      makeRow({ dancerId: 'd2', status: 'empty', registrationStatus: 'scratched' }),
      makeRow({ dancerId: 'd3', status: 'empty', registrationStatus: 'present' }),
    ]
    expect(getFirstEmptyEditableId(rows)).toBe('d3')
  })

  it('canSignOff requires all editable rows saved or empty, with at least one saved', () => {
    expect(canSignOff([
      makeRow({ status: 'saved' }),
      makeRow({ status: 'saved' }),
    ])).toBe(true)

    expect(canSignOff([
      makeRow({ status: 'saved' }),
      makeRow({ status: 'failed' }),
    ])).toBe(false)

    expect(canSignOff([
      makeRow({ status: 'empty' }),
      makeRow({ status: 'empty' }),
    ])).toBe(false)
  })

  it('allSaved is true when all editable rows are saved or empty', () => {
    expect(allSaved([
      makeRow({ status: 'saved' }),
      makeRow({ status: 'empty' }),
    ])).toBe(true)
  })
})
