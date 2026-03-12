import { describe, it, expect } from 'vitest'
import { canEnterScores } from '@/lib/entry-mode'

describe('canEnterScores', () => {
  it('allows entry when no existing scores', () => {
    const result = canEnterScores([], 'tabulator_transcription')
    expect(result.allowed).toBe(true)
  })

  it('allows entry when existing scores use the same mode', () => {
    const result = canEnterScores(
      ['tabulator_transcription', 'tabulator_transcription'],
      'tabulator_transcription'
    )
    expect(result.allowed).toBe(true)
  })

  it('blocks entry when existing scores use a different mode', () => {
    const result = canEnterScores(
      ['judge_self_service'],
      'tabulator_transcription'
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('blocks judge self-service when tabulator already entered', () => {
    const result = canEnterScores(
      ['tabulator_transcription'],
      'judge_self_service'
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('includes the conflicting mode in the reason', () => {
    const result = canEnterScores(
      ['judge_self_service'],
      'tabulator_transcription'
    )
    expect(result.reason).toContain('judge_self_service')
  })
})
