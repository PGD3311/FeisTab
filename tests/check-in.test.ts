import { describe, it, expect } from 'vitest'
import {
  getCheckInState,
  deriveCheckInStats,
  computeNextNumber,
  normalizeSearchText,
  dancerSearchScore,
  SEARCH_EXACT_NUMBER,
  SEARCH_MATCH,
  SEARCH_NO_MATCH,
  type CheckInRow,
  type DancerSearchFields,
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

describe('computeNextNumber', () => {
  it('returns 100 when no existing numbers', () => {
    expect(computeNextNumber([])).toBe(100)
  })

  it('returns max + 1 from existing numeric numbers', () => {
    expect(computeNextNumber(['101', '102', '105'])).toBe(106)
  })

  it('ignores non-numeric values', () => {
    expect(computeNextNumber(['101', 'VIP-1', '103'])).toBe(104)
  })

  it('starts from 100 even if all values are non-numeric', () => {
    expect(computeNextNumber(['VIP-1', 'VIP-2'])).toBe(100)
  })
})

describe('normalizeSearchText', () => {
  it('drops apostrophes, hyphens and spaces', () => {
    expect(normalizeSearchText("O'Brien")).toBe('obrien')
    expect(normalizeSearchText('O’Brien')).toBe('obrien')
    expect(normalizeSearchText('Nic Giolla-Phádraig')).toBe('nicgiollaphadraig')
  })

  it('strips accents (fadas)', () => {
    expect(normalizeSearchText('Siobhán Ní Dhónaill')).toBe('siobhannidhonaill')
  })
})

describe('dancerSearchScore', () => {
  const dancer: DancerSearchFields = {
    first_name: 'Siobhán',
    last_name: "O'Brien",
    school_name: 'Scoil Rince Ní Bhriain',
    competitor_number: '104'
  }

  it('matches names regardless of apostrophes, case and accents', () => {
    expect(dancerSearchScore('obrien', dancer)).toBe(SEARCH_MATCH)
    expect(dancerSearchScore("O'BRIEN", dancer)).toBe(SEARCH_MATCH)
    expect(dancerSearchScore('o brien', dancer)).toBe(SEARCH_MATCH)
    expect(dancerSearchScore('siobhan', dancer)).toBe(SEARCH_MATCH)
  })

  it('matches full name in either order', () => {
    expect(dancerSearchScore('siobhan obrien', dancer)).toBe(SEARCH_MATCH)
    expect(dancerSearchScore("O'Brien Siobhán", dancer)).toBe(SEARCH_MATCH)
  })

  it('matches school name', () => {
    expect(dancerSearchScore('ni bhriain', dancer)).toBe(SEARCH_MATCH)
  })

  it('finds a dancer by exact competitor number, with or without #', () => {
    expect(dancerSearchScore('104', dancer)).toBe(SEARCH_EXACT_NUMBER)
    expect(dancerSearchScore('#104', dancer)).toBe(SEARCH_EXACT_NUMBER)
    expect(dancerSearchScore(' 104 ', dancer)).toBe(SEARCH_EXACT_NUMBER)
  })

  it('treats a partial number as a prefix match', () => {
    expect(dancerSearchScore('10', dancer)).toBe(SEARCH_MATCH)
    expect(dancerSearchScore('4', dancer)).toBe(SEARCH_NO_MATCH)
  })

  it('does not match a number when the dancer has none yet', () => {
    expect(dancerSearchScore('104', { ...dancer, competitor_number: null })).toBe(SEARCH_NO_MATCH)
  })

  it('returns no match for unrelated text', () => {
    expect(dancerSearchScore('murphy', dancer)).toBe(SEARCH_NO_MATCH)
  })
})
