import { describe, it, expect } from 'vitest'
import {
  getCheckInState,
  deriveCheckInStats,
  type CheckInRow,
  type CheckInState,
} from '@/lib/check-in'

describe('getCheckInState', () => {
  it('returns needs_number when row is null', () => {
    expect(getCheckInState(null)).toBe('needs_number')
  })

  it('returns needs_number when row is undefined', () => {
    expect(getCheckInState(undefined)).toBe('needs_number')
  })

  it('returns awaiting_arrival when row exists with no checked_in_at', () => {
    const row: CheckInRow = {
      competitor_number: '101',
      checked_in_at: null,
    }
    expect(getCheckInState(row)).toBe('awaiting_arrival')
  })

  it('returns checked_in when row has checked_in_at', () => {
    const row: CheckInRow = {
      competitor_number: '101',
      checked_in_at: '2026-03-15T10:00:00Z',
    }
    expect(getCheckInState(row)).toBe('checked_in')
  })
})

describe('deriveCheckInStats', () => {
  it('counts all three states correctly', () => {
    const dancerIds = ['d1', 'd2', 'd3', 'd4', 'd5']
    const checkInMap = new Map<string, CheckInRow>([
      ['d1', { competitor_number: '101', checked_in_at: '2026-03-15T10:00:00Z' }],
      ['d2', { competitor_number: '102', checked_in_at: '2026-03-15T10:05:00Z' }],
      ['d3', { competitor_number: '103', checked_in_at: null }],
    ])

    const stats = deriveCheckInStats(dancerIds, checkInMap)
    expect(stats.checkedIn).toBe(2)
    expect(stats.awaitingArrival).toBe(1)
    expect(stats.needsNumber).toBe(2)
  })

  it('handles empty inputs', () => {
    const stats = deriveCheckInStats([], new Map())
    expect(stats.checkedIn).toBe(0)
    expect(stats.awaitingArrival).toBe(0)
    expect(stats.needsNumber).toBe(0)
  })
})
