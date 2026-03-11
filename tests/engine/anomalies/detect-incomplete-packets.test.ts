import { describe, it, expect } from 'vitest'
import { detectIncompleteJudgePackets } from '@/lib/engine/anomalies/detect-incomplete-packets'
import { type ScoreEntry, type Registration } from '@/lib/engine/anomalies/types'

const score = (dancer_id: string, judge_id: string): ScoreEntry => ({
  id: `${dancer_id}-${judge_id}`, round_id: 'r1', competition_id: 'c1',
  dancer_id, judge_id, raw_score: 80,
  flagged: false, flag_reason: null,
})

const reg = (dancer_id: string): Registration => ({
  id: dancer_id, dancer_id, competition_id: 'c1',
  competitor_number: '100', status: 'registered', status_reason: null,
})

describe('detectIncompleteJudgePackets', () => {
  it('returns empty when all judges scored all dancers', () => {
    const scores = [
      score('d1', 'j1'), score('d1', 'j2'),
      score('d2', 'j1'), score('d2', 'j2'),
    ]
    expect(detectIncompleteJudgePackets(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')).toEqual([])
  })

  it('detects judge who has not scored all dancers', () => {
    const scores = [
      score('d1', 'j1'), score('d1', 'j2'),
      score('d2', 'j1'),
    ]
    const result = detectIncompleteJudgePackets(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('incomplete_judge_packet')
    expect(result[0].scope).toBe('judge_packet')
    expect(result[0].entity_ids.judge_id).toBe('j2')
  })

  it('returns empty for empty inputs', () => {
    expect(detectIncompleteJudgePackets([], [], [], 'r1', 'c1')).toEqual([])
  })

  it('detects multiple incomplete judges', () => {
    const scores = [score('d1', 'j1')]
    const result = detectIncompleteJudgePackets(scores, [reg('d1'), reg('d2')], ['j1', 'j2'], 'r1', 'c1')
    expect(result).toHaveLength(2)
  })
})
