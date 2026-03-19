import { describe, it, expect } from 'vitest'
import { formatAuditEntry, type AuditEntry, type NameMaps } from '@/lib/audit-format'

const names: NameMaps = {
  judges: new Map([
    ['judge-1', "Mary O'Brien"],
    ['judge-2', 'Patrick Kelly'],
  ]),
  dancers: new Map([
    ['dancer-1', 'Siobhan Murphy (#104)'],
    ['dancer-2', 'Aoife Walsh (#201)'],
  ]),
}

function makeEntry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'entry-1',
    user_id: null,
    action: 'status_change',
    entity_type: 'competition',
    entity_id: 'comp-1',
    before_data: null,
    after_data: null,
    created_at: '2026-03-12T10:48:00Z',
    ...overrides,
  }
}

describe('formatAuditEntry', () => {
  it('formats score_submit with judge and dancer names', () => {
    const entry = makeEntry({
      action: 'score_submit',
      after_data: {
        judge_id: 'judge-1',
        dancer_id: 'dancer-1',
        raw_score: 72.5,
        entry_mode: 'judge_self_service',
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('72.5')
    expect(result.summary).toContain('Siobhan Murphy (#104)')
    expect(result.actor).toBe("Mary O'Brien")
    expect(result.badgeText).toBe('Score')
    expect(result.isCorrection).toBe(false)
    expect(result.hasRawData).toBe(true)
  })

  it('formats score_transcribe with tabulator actor', () => {
    const entry = makeEntry({
      action: 'score_transcribe',
      after_data: {
        judge_id: 'judge-2',
        dancer_id: 'dancer-1',
        raw_score: 68,
        entry_mode: 'tabulator_transcription',
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('68')
    expect(result.summary).toContain('Siobhan Murphy (#104)')
    expect(result.summary).toContain('Patrick Kelly')
    expect(result.actor).toBe('Tabulator')
  })

  it('formats sign_off with all judges done', () => {
    const entry = makeEntry({
      action: 'sign_off',
      after_data: {
        judge_id: 'judge-1',
        entry_mode: 'judge_self_service',
        all_judges_done: true,
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain("Mary O'Brien")
    expect(result.summary).toContain('signed off')
    expect(result.summary).toContain('all judges done')
    expect(result.badgeText).toBe('Sign-off')
  })

  it('formats status_change with humanized labels', () => {
    const entry = makeEntry({
      action: 'status_change',
      after_data: { from: 'in_progress', to: 'awaiting_scores' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('In Progress')
    expect(result.summary).toContain('Awaiting Scores')
    expect(result.actor).toBe('Organizer')
  })

  it('formats auto-triggered status_change with System actor', () => {
    const entry = makeEntry({
      action: 'status_change',
      after_data: { from: 'in_progress', to: 'awaiting_scores', trigger: 'auto_advance_on_sign_off' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.actor).toBe('System')
    expect(result.summary).toContain('auto_advance_on_sign_off')
  })

  it('formats unlock_for_correction as correction', () => {
    const entry = makeEntry({
      action: 'unlock_for_correction',
      after_data: {
        judge_id: 'judge-1',
        judge_name: "Mary O'Brien",
        reason: 'wrong_score',
        note: 'Entered 72 instead of 27',
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain("Mary O'Brien")
    expect(result.summary).toContain('wrong_score')
    expect(result.summary).toContain('Entered 72 instead of 27')
    expect(result.isCorrection).toBe(true)
    expect(result.badgeText).toBe('Correction')
  })

  it('formats tabulate with round context', () => {
    const entry = makeEntry({
      action: 'tabulate',
      after_data: { result_count: 12, round_id: 'r-1' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('12 results saved')
    expect(result.summary).toContain('round r-1')
    expect(result.actor).toBe('Organizer')
  })

  it('formats tabulate with approval flag', () => {
    const entry = makeEntry({
      action: 'tabulate',
      after_data: { result_count: 8, preview_approved: true, round_id: 'r-2' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('8 results saved')
    expect(result.summary).toContain('(approved)')
    expect(result.summary).toContain('round r-2')
  })

  it('formats result_publish', () => {
    const entry = makeEntry({
      action: 'result_publish',
      after_data: { published_at: '2026-03-12T10:48:00Z' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('Results published')
    expect(result.badgeText).toBe('Published')
  })

  it('formats recall_generate', () => {
    const entry = makeEntry({
      action: 'recall_generate',
      after_data: { recalled_count: 8, source_round_id: 'r-1', new_round_number: 2 },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('8 dancers recalled')
  })

  it('formats import with counts', () => {
    const entry = makeEntry({
      action: 'import',
      after_data: { competition_count: 5, dancer_count: 42, registration_count: 100 },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('Imported 5 competitions, 42 dancers, 100 registrations')
    expect(result.actor).toBe('Organizer')
  })

  it('formats import without counts as CSV fallback', () => {
    const entry = makeEntry({
      action: 'import',
      after_data: null,
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('CSV data imported')
  })

  it('formats import with partial counts', () => {
    const entry = makeEntry({
      action: 'import',
      after_data: { dancer_count: 30 },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('Imported 30 dancers')
  })

  it('treats non-object after_data as absent for hasRawData', () => {
    const entry = makeEntry({
      action: 'some_future_action',
      after_data: 'just a string' as unknown as Record<string, unknown>,
    })
    const result = formatAuditEntry(entry, names)
    expect(result.hasRawData).toBe(false)
    expect(result.summary).toBe('some_future_action')
  })

  it('treats array after_data as absent for hasRawData', () => {
    const entry = makeEntry({
      action: 'some_future_action',
      after_data: [1, 2, 3] as unknown as Record<string, unknown>,
    })
    const result = formatAuditEntry(entry, names)
    expect(result.hasRawData).toBe(false)
    expect(result.summary).toBe('some_future_action')
  })

  it('falls back gracefully for unknown action', () => {
    const entry = makeEntry({
      action: 'some_future_action',
      after_data: { foo: 'bar', count: 5 },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('some_future_action')
    expect(result.actor).toBe('Unknown')
    expect(result.badgeText).toBe('some_future_action')
    expect(result.hasRawData).toBe(true)
  })

  it('handles null after_data without crashing', () => {
    const entry = makeEntry({
      action: 'result_publish',
      after_data: null,
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('Results published')
    expect(result.hasRawData).toBe(false)
  })

  it('handles malformed after_data without crashing', () => {
    const entry = makeEntry({
      action: 'score_submit',
      after_data: { unexpected: true },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBeDefined()
    expect(result.actor).toBeDefined()
  })

  it('formats result_publish with approver', () => {
    const entry = makeEntry({
      action: 'result_publish',
      after_data: {
        approved_by: 'Bridget',
        checks: { reviewed_preview: true, judge_signoffs_complete: true, anomalies_reviewed: true },
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('Bridget')
    expect(result.summary).toContain('published')
  })

  it('formats result_publish without approver (legacy)', () => {
    const entry = makeEntry({ action: 'result_publish', after_data: { published_at: '2026-03-18' } })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('Results published')
  })

  it('formats result_unpublish with reason', () => {
    const entry = makeEntry({
      action: 'result_unpublish',
      after_data: { unpublished_by: 'Bridget', reason: 'score_correction_needed', note: null },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('Score correction needed')
  })

  it('formats result_unpublish with other reason and note', () => {
    const entry = makeEntry({
      action: 'result_unpublish',
      after_data: { unpublished_by: 'Bridget', reason: 'other', note: 'Judge 2 was incorrect' },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toContain('Judge 2 was incorrect')
  })

  it('formats result_unpublish with null after_data', () => {
    const entry = makeEntry({ action: 'result_unpublish', after_data: null })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('Results unpublished')
  })

  it('resolves unresolved judge_id to "Judge" fallback', () => {
    const entry = makeEntry({
      action: 'sign_off',
      after_data: {
        judge_id: 'unknown-judge-id',
        entry_mode: 'judge_self_service',
        all_judges_done: false,
      },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.actor).toBe('Judge')
  })
})
