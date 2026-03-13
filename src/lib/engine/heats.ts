// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeatDancer {
  dancer_id: string
  competitor_number: string
  display_order: number
}

export interface HeatSlot {
  dancer_id: string
  competitor_number: string
  status: 'active' | 'scratched' | 'no_show' | 'absent'
}

export interface Heat {
  heat_number: number
  slots: HeatSlot[]
}

export interface HeatSnapshot {
  group_size: number
  generated_at: string // ISO timestamp
  heats: Heat[]
}

// ---------------------------------------------------------------------------
// generateHeats
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic heat snapshot from active dancers.
 *
 * Dancers are chunked into groups of `groupSize` based on `display_order`.
 * The last heat may be smaller. All slots start with status 'active'.
 * Same input always produces the same heats (timestamp aside).
 */
export function generateHeats(activeDancers: HeatDancer[], groupSize: number): HeatSnapshot {
  const sorted = [...activeDancers].sort((a, b) => a.display_order - b.display_order)

  const heats: Heat[] = []
  for (let i = 0; i < sorted.length; i += groupSize) {
    const chunk = sorted.slice(i, i + groupSize)
    heats.push({
      heat_number: heats.length + 1,
      slots: chunk.map((d): HeatSlot => ({
        dancer_id: d.dancer_id,
        competitor_number: d.competitor_number,
        status: 'active',
      })),
    })
  }

  return {
    group_size: groupSize,
    generated_at: new Date().toISOString(),
    heats,
  }
}

// ---------------------------------------------------------------------------
// getCurrentHeat
// ---------------------------------------------------------------------------

/**
 * Find the heat containing the first incomplete active slot.
 *
 * An "incomplete active slot" is a slot with status 'active' whose dancer_id
 * is NOT in scoredDancerIds. Slots with status 'scratched', 'no_show', or
 * 'absent' don't block heat progression — they are skipped.
 *
 * Returns null when all active slots are scored.
 */
export function getCurrentHeat(
  snapshot: HeatSnapshot,
  scoredDancerIds: Set<string>
): Heat | null {
  for (const heat of snapshot.heats) {
    const hasUnscoredActive = heat.slots.some(
      (slot) => slot.status === 'active' && !scoredDancerIds.has(slot.dancer_id)
    )
    if (hasUnscoredActive) {
      return heat
    }
  }
  return null
}
