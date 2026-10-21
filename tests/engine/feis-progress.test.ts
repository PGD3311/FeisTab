import { describe, it, expect } from 'vitest'
import { feisProgress } from '@/lib/engine/feis-progress'

describe('feisProgress', () => {
  it('counts only competitions with dancers', () => {
    expect(
      feisProgress([
        { status: 'imported', dancerCount: 0 },
        { status: 'imported', dancerCount: 0 },
        { status: 'imported', dancerCount: 5 }
      ])
    ).toEqual({ finished: 0, toRun: 1 })
  })

  it('counts published and locked competitions as finished', () => {
    expect(
      feisProgress([
        { status: 'published', dancerCount: 5 },
        { status: 'locked', dancerCount: 3 },
        { status: 'complete_unpublished', dancerCount: 4 },
        { status: 'in_progress', dancerCount: 6 }
      ])
    ).toEqual({ finished: 2, toRun: 4 })
  })

  it('is zero of zero for a feis with no entries', () => {
    expect(feisProgress([])).toEqual({ finished: 0, toRun: 0 })
  })
})
