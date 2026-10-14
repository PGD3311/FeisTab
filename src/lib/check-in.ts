/**
 * Check-in state derivation helpers.
 * Pure functions — no Supabase, no React.
 */

export type CheckInState = 'needs_number' | 'awaiting_arrival' | 'checked_in'

export interface CheckInRow {
  competitor_number: string
  checked_in_at: string | null
}

export interface CheckInStats {
  checkedIn: number
  awaitingArrival: number
  needsNumber: number
}

export function getCheckInState(row: CheckInRow | null | undefined): CheckInState {
  if (!row) return 'needs_number'
  if (row.checked_in_at) return 'checked_in'
  return 'awaiting_arrival'
}

export function deriveCheckInStats(
  dancerIds: string[],
  checkInMap: Map<string, CheckInRow>
): CheckInStats {
  let checkedIn = 0
  let awaitingArrival = 0
  let needsNumber = 0

  for (const id of dancerIds) {
    const state = getCheckInState(checkInMap.get(id) ?? null)
    if (state === 'checked_in') checkedIn++
    else if (state === 'awaiting_arrival') awaitingArrival++
    else needsNumber++
  }

  return { checkedIn, awaitingArrival, needsNumber }
}

// Auto-suggest starts at 100 to avoid collisions with CSV-imported competitor
// numbers (which typically start at 1). Walk-up registrations get numbers from
// a separate range so they never clash with pre-registered dancers.
export function computeNextNumber(existingNumbers: string[]): number {
  let max = 99
  for (const n of existingNumbers) {
    const parsed = parseInt(n, 10)
    if (!isNaN(parsed) && parsed > max) max = parsed
  }
  return max + 1
}

/**
 * Fold text for desk search: strip accents, lowercase, and drop apostrophes, hyphens,
 * spaces and other punctuation, so "obrien" finds "O'Brien" and "siobhan" finds "Siobhán".
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export interface DancerSearchFields {
  first_name: string
  last_name: string
  school_name: string | null
  competitor_number: string | null
}

/** Exact competitor number hits sort first, then everything else that matches. */
export const SEARCH_EXACT_NUMBER = 2
export const SEARCH_MATCH = 1
export const SEARCH_NO_MATCH = 0

/**
 * Score a dancer against a desk search query. A query that is only a number
 * (optionally "#101") searches competitor numbers; anything else searches names and school.
 */
export function dancerSearchScore(query: string, dancer: DancerSearchFields): number {
  const trimmed = query.trim()
  const numberQuery = /^#?\s*(\d+)$/.exec(trimmed)
  if (numberQuery) {
    const digits = numberQuery[1]
    const number = dancer.competitor_number?.trim() ?? ''
    if (number === '') return SEARCH_NO_MATCH
    if (number === digits || parseInt(number, 10) === parseInt(digits, 10)) {
      return SEARCH_EXACT_NUMBER
    }
    return number.startsWith(digits) ? SEARCH_MATCH : SEARCH_NO_MATCH
  }

  const q = normalizeSearchText(trimmed)
  if (q === '') return SEARCH_MATCH

  const haystacks = [
    `${dancer.first_name}${dancer.last_name}`,
    `${dancer.last_name}${dancer.first_name}`,
    dancer.school_name ?? ''
  ]
  return haystacks.some((h) => normalizeSearchText(h).includes(q)) ? SEARCH_MATCH : SEARCH_NO_MATCH
}
