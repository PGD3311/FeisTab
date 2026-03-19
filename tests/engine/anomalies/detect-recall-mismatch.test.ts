import { describe, it, expect } from 'vitest'
import { detectRecallMismatch } from '@/lib/engine/anomalies/detect-recall-mismatch'

describe('detectRecallMismatch', () => {
  it('returns empty when recall count matches rule', () => {
    const recalls = ['d1', 'd2', 'd3', 'd4', 'd5'].map(d => ({ dancer_id: d, round_id: 'r1' }))
    expect(detectRecallMismatch(recalls, 10, 50, 'r1', 'c1')).toEqual([])
  })

  it('flags recall count mismatch as blocker', () => {
    const recalls = ['d1', 'd2', 'd3'].map(d => ({ dancer_id: d, round_id: 'r1' }))
    const result = detectRecallMismatch(recalls, 10, 50, 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('recall_mismatch')
    expect(result[0].severity).toBe('blocker')
    expect(result[0].blocking).toBe(true)
  })

  it('allows tie-bubble expansion (more than expected)', () => {
    const recalls = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map(d => ({ dancer_id: d, round_id: 'r1' }))
    expect(detectRecallMismatch(recalls, 10, 50, 'r1', 'c1')).toEqual([])
  })

  it('returns empty when recall_top_percent is 0', () => {
    expect(detectRecallMismatch([], 10, 0, 'r1', 'c1')).toEqual([])
  })

  it('returns empty when no recalls and no recall rule', () => {
    expect(detectRecallMismatch([], 0, 0, 'r1', 'c1')).toEqual([])
  })
})
