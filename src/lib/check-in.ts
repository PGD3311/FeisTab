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

// Auto-suggest starts at 100. If an event has numbers 1-50 from CSV,
// next assigned number will still be 100 (not 51). This is intentional.
export function computeNextNumber(existingNumbers: string[]): number {
  let max = 99
  for (const n of existingNumbers) {
    const parsed = parseInt(n, 10)
    if (!isNaN(parsed) && parsed > max) max = parsed
  }
  return max + 1
}
