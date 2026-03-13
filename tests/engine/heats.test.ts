import { describe, it, expect } from 'vitest'
import {
  generateHeats,
  getCurrentHeat,
  type HeatDancer,
  type HeatSnapshot,
  type HeatSlot,
} from '@/lib/engine/heats'

function makeDancers(count: number): HeatDancer[] {
  return Array.from({ length: count }, (_, i) => ({
    dancer_id: `d${i + 1}`,
    competitor_number: `${100 + i + 1}`,
    display_order: i + 1,
  }))
}

describe('generateHeats', () => {
  it('12 dancers, group size 2 → 6 heats of 2 slots each', () => {
    const dancers = makeDancers(12)
    const snapshot = generateHeats(dancers, 2)

    expect(snapshot.heats).toHaveLength(6)
    for (const heat of snapshot.heats) {
      expect(heat.slots).toHaveLength(2)
    }
  })

  it('11 dancers, group size 3 → 3 heats of 3 + 1 heat of 2', () => {
    const dancers = makeDancers(11)
    const snapshot = generateHeats(dancers, 3)

    expect(snapshot.heats).toHaveLength(4)
    expect(snapshot.heats[0].slots).toHaveLength(3)
    expect(snapshot.heats[1].slots).toHaveLength(3)
    expect(snapshot.heats[2].slots).toHaveLength(3)
    expect(snapshot.heats[3].slots).toHaveLength(2)
  })

  it('1 dancer, group size 2 → 1 heat of 1', () => {
    const dancers = makeDancers(1)
    const snapshot = generateHeats(dancers, 2)

    expect(snapshot.heats).toHaveLength(1)
    expect(snapshot.heats[0].slots).toHaveLength(1)
  })

  it('0 dancers → empty heats array', () => {
    const snapshot = generateHeats([], 3)

    expect(snapshot.heats).toHaveLength(0)
  })

  it('snapshot includes group_size and generated_at metadata', () => {
    const dancers = makeDancers(4)
    const before = new Date().toISOString()
    const snapshot = generateHeats(dancers, 2)
    const after = new Date().toISOString()

    expect(snapshot.group_size).toBe(2)
    expect(snapshot.generated_at).toBeDefined()
    expect(snapshot.generated_at >= before).toBe(true)
    expect(snapshot.generated_at <= after).toBe(true)
  })

  it('all slots in a fresh snapshot have status active', () => {
    const dancers = makeDancers(6)
    const snapshot = generateHeats(dancers, 2)

    for (const heat of snapshot.heats) {
      for (const slot of heat.slots) {
        expect(slot.status).toBe('active')
      }
    }
  })
})

describe('getCurrentHeat', () => {
  it('with no scores → heat 1', () => {
    const dancers = makeDancers(6)
    const snapshot = generateHeats(dancers, 2)
    const scored = new Set<string>()

    const current = getCurrentHeat(snapshot, scored)

    expect(current).not.toBeNull()
    expect(current!.heat_number).toBe(1)
  })

  it('with first 4 scored (group size 2) → heat 3', () => {
    const dancers = makeDancers(6)
    const snapshot = generateHeats(dancers, 2)
    const scored = new Set(['d1', 'd2', 'd3', 'd4'])

    const current = getCurrentHeat(snapshot, scored)

    expect(current).not.toBeNull()
    expect(current!.heat_number).toBe(3)
  })

  it('with out-of-order scoring → correct heat based on first unscored active slot', () => {
    const dancers = makeDancers(6)
    const snapshot = generateHeats(dancers, 2)
    // Score dancers from heat 1 and heat 3, but not heat 2
    const scored = new Set(['d1', 'd2', 'd5', 'd6'])

    const current = getCurrentHeat(snapshot, scored)

    // Heat 2 has d3 and d4 — first unscored active slots
    expect(current).not.toBeNull()
    expect(current!.heat_number).toBe(2)
  })

  it('with all active slots scored → null', () => {
    const dancers = makeDancers(4)
    const snapshot = generateHeats(dancers, 2)
    const scored = new Set(['d1', 'd2', 'd3', 'd4'])

    const current = getCurrentHeat(snapshot, scored)

    expect(current).toBeNull()
  })

  it('skips slots with status scratched or no_show', () => {
    const dancers = makeDancers(6)
    const snapshot = generateHeats(dancers, 2)

    // Mark all slots in heat 1 as scratched/no_show
    snapshot.heats[0].slots[0].status = 'scratched'
    snapshot.heats[0].slots[1].status = 'no_show'

    // No scores at all — heat 1 should be skipped because both slots are non-active
    const scored = new Set<string>()
    const current = getCurrentHeat(snapshot, scored)

    expect(current).not.toBeNull()
    expect(current!.heat_number).toBe(2)
  })

  it('snapshot with a scratched slot: heat structure unchanged, slot remains in original heat', () => {
    const dancers = makeDancers(4)
    const snapshot = generateHeats(dancers, 2)

    // Scratch one dancer in heat 1
    snapshot.heats[0].slots[0].status = 'scratched'

    // Heat 1 still has 2 slots (structure unchanged)
    expect(snapshot.heats[0].slots).toHaveLength(2)
    expect(snapshot.heats[0].slots[0].dancer_id).toBe('d1')
    expect(snapshot.heats[0].slots[0].status).toBe('scratched')

    // Only d2 is active in heat 1, score d2 → heat 1 complete, move to heat 2
    const scored = new Set(['d2'])
    const current = getCurrentHeat(snapshot, scored)

    expect(current).not.toBeNull()
    expect(current!.heat_number).toBe(2)
  })
})
