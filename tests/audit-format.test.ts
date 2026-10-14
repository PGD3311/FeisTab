import { describe, it, expect } from 'vitest'
import {
  formatAuditEntry,
  matchesFilter,
  resolveActor,
  sortAuditEntries,
  type AuditEntry,
  type NameMaps
} from '@/lib/audit-format'

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

  it('formats unpublish_results RPC entries with reason', () => {
    const entry = makeEntry({
      action: 'unpublish_results',
      after_data: { unpublished_by: 'Bridget', reason: 'premature_publish', note: null },
    })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('Results unpublished · Premature publish')
    expect(result.actor).toBe('Bridget')
    expect(result.badgeText).toBe('Unpublished')
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

// Live names: rows written by the RPCs/trigger carry user_id and need these lookups
const liveNames: NameMaps = {
  judges: new Map([
    ['judge-aine', 'Aine Hennessy'],
    ['judge-declan', 'Declan Moran']
  ]),
  dancers: new Map([['dancer-104', 'Siobhan Murphy (#104)']]),
  judgesByUser: new Map([
    ['user-aine', 'Aine Hennessy'],
    ['user-declan', 'Declan Moran']
  ]),
  rolesByUser: new Map([
    ['user-org', ['organizer']],
    ['user-side', ['side_stage']],
    ['user-desk', ['registration_desk']],
    ['user-both', ['side_stage', 'organizer']],
    ['user-aine', ['judge']],
    ['user-declan', ['judge']]
  ]),
  rounds: new Map([
    ['round-1', 1],
    ['round-2', 2]
  ]),
  scoreEntries: new Map([
    ['score-1', { judge_id: 'judge-aine', dancer_id: 'dancer-104' }],
    ['score-2', { judge_id: 'judge-declan', dancer_id: 'dancer-104' }]
  ])
}

describe('status_change from the competition trigger', () => {
  it('reads the old status from before_data and the new one from after_data', () => {
    const entry = makeEntry({
      user_id: 'user-org',
      before_data: { status: 'in_progress' },
      after_data: { status: 'awaiting_scores' }
    })
    expect(formatAuditEntry(entry, liveNames).summary).toBe('In Progress → Awaiting Scores')
  })

  it('formats a dancer status change with the dancer name', () => {
    const entry = makeEntry({
      action: 'set_registration_status',
      entity_type: 'registration',
      entity_id: 'reg-1',
      user_id: 'user-side',
      before_data: { status: 'registered' },
      after_data: { status: 'scratched', dancer_id: 'dancer-104', competition_id: 'comp-1' }
    })
    const result = formatAuditEntry(entry, liveNames)
    expect(result.summary).toBe('Siobhan Murphy (#104): Registered → Scratched')
    expect(result.actor).toBe('Side-stage')
    expect(matchesFilter(entry.action, 'status')).toBe(true)
  })

  it('formats the legacy transition_status RPC shape', () => {
    const entry = makeEntry({
      action: 'transition_status',
      after_data: { from: 'imported', to: 'ready_for_day_of' }
    })
    expect(formatAuditEntry(entry, names).summary).toBe('Imported → Ready For Day Of')
  })
})

describe('resolveActor', () => {
  it('names a judge whose login made the change', () => {
    expect(resolveActor('user-aine', liveNames)).toBe('Judge Aine Hennessy')
  })

  it('labels staff by event role', () => {
    expect(resolveActor('user-org', liveNames)).toBe('Organizer')
    expect(resolveActor('user-side', liveNames)).toBe('Side-stage')
    expect(resolveActor('user-desk', liveNames)).toBe('Registration desk')
  })

  it('prefers organizer when a user holds several roles', () => {
    expect(resolveActor('user-both', liveNames)).toBe('Organizer')
  })

  it('says so when a user id cannot be resolved', () => {
    expect(resolveActor('user-stranger', liveNames)).toBe('Unknown user')
  })

  it('returns null without a user id or lookup maps', () => {
    expect(resolveActor(null, liveNames)).toBeNull()
    expect(resolveActor('user-org', names)).toBeNull()
  })

  it('overrides the per-action guess in formatted rows', () => {
    const sideStage = makeEntry({
      user_id: 'user-side',
      before_data: { status: 'ready_for_day_of' },
      after_data: { status: 'released_to_judge' }
    })
    expect(formatAuditEntry(sideStage, liveNames).actor).toBe('Side-stage')

    const judge = makeEntry({
      user_id: 'user-aine',
      before_data: { status: 'released_to_judge' },
      after_data: { status: 'in_progress' }
    })
    expect(formatAuditEntry(judge, liveNames).actor).toBe('Judge Aine Hennessy')
  })

  it('keeps the legacy guess for rows without a user id', () => {
    const entry = makeEntry({
      before_data: { status: 'in_progress' },
      after_data: { status: 'awaiting_scores' }
    })
    expect(formatAuditEntry(entry, liveNames).actor).toBe('Organizer')
  })
})

describe('score and sign-off RPC rows', () => {
  it('formats submit_score using the score entry for the judge', () => {
    const entry = makeEntry({
      action: 'submit_score',
      entity_type: 'score_entry',
      entity_id: 'score-1',
      user_id: 'user-aine',
      after_data: { dancer_id: 'dancer-104', raw_score: 72.5 }
    })
    const result = formatAuditEntry(entry, liveNames)
    expect(result.summary).toBe(
      'Score 72.5 entered for Siobhan Murphy (#104) by Judge Aine Hennessy'
    )
    expect(result.actor).toBe('Judge Aine Hennessy')
    expect(result.badgeText).toBe('Score')
    expect(matchesFilter(entry.action, 'scores')).toBe(true)
  })

  it('formats tabulator_enter_score as a transcription by the organizer', () => {
    const entry = makeEntry({
      action: 'tabulator_enter_score',
      entity_type: 'score_entry',
      entity_id: 'score-1',
      user_id: 'user-org',
      after_data: { dancer_id: 'dancer-104', judge_id: 'judge-aine' }
    })
    const result = formatAuditEntry(entry, liveNames)
    expect(result.summary).toBe(
      'Score entered for Siobhan Murphy (#104) by Judge Aine Hennessy · transcribed from score sheet'
    )
    expect(result.actor).toBe('Organizer')
    expect(result.badgeText).toBe('Score')
  })

  it('formats sign_off_judge with judge name and round number', () => {
    const entry = makeEntry({
      action: 'sign_off_judge',
      entity_type: 'round',
      entity_id: 'round-1',
      user_id: 'user-declan',
      after_data: { judge_id: 'judge-declan', action: 'add' }
    })
    const result = formatAuditEntry(entry, liveNames)
    expect(result.summary).toBe('Judge Declan Moran signed off round 1')
    expect(result.actor).toBe('Judge Declan Moran')
    expect(result.badgeText).toBe('Sign-off')
    expect(matchesFilter(entry.action, 'signoffs')).toBe(true)
  })

  it('formats a reopened sign-off', () => {
    const entry = makeEntry({
      action: 'sign_off_judge',
      entity_type: 'round',
      entity_id: 'round-2',
      user_id: 'user-org',
      after_data: { judge_id: 'judge-aine', action: 'remove' }
    })
    const result = formatAuditEntry(entry, liveNames)
    expect(result.summary).toBe('Sign-off reopened for Judge Aine Hennessy · round 2')
    expect(result.actor).toBe('Organizer')
  })

  it('handles score rows whose judge or dancer is unknown', () => {
    const entry = makeEntry({
      action: 'submit_score',
      entity_type: 'score_entry',
      entity_id: 'score-missing',
      after_data: { dancer_id: 'dancer-unknown', raw_score: 60 }
    })
    expect(formatAuditEntry(entry, liveNames).summary).toBe(
      'Score 60 entered for unknown dancer by a judge'
    )
  })
})

describe('other RPC rows', () => {
  it('formats publish_results like result_publish', () => {
    const entry = makeEntry({
      action: 'publish_results',
      user_id: 'user-org',
      after_data: { approved_by: 'Bridget' }
    })
    const result = formatAuditEntry(entry, liveNames)
    expect(result.summary).toBe('Results published by Bridget')
    expect(result.badgeText).toBe('Published')
  })

  it('formats approve_tabulation', () => {
    const entry = makeEntry({ action: 'approve_tabulation', after_data: { result_count: 12 } })
    const result = formatAuditEntry(entry, names)
    expect(result.summary).toBe('12 results approved and saved')
    expect(result.badgeText).toBe('Tabulation')
  })

  it('formats generate_recall with the new round number', () => {
    const entry = makeEntry({
      action: 'generate_recall',
      entity_type: 'round',
      entity_id: 'round-2',
      after_data: { recall_count: 3, competition_id: 'comp-1' }
    })
    expect(formatAuditEntry(entry, liveNames).summary).toBe('3 dancers recalled to round 2')
  })

  it('formats create_round and roster confirmation', () => {
    const round = makeEntry({ action: 'create_round', after_data: { round_number: 2 } })
    expect(formatAuditEntry(round, names).summary).toBe('Round 2 created')
    const roster = makeEntry({ action: 'confirm_roster', user_id: 'user-side', after_data: {} })
    const result = formatAuditEntry(roster, liveNames)
    expect(result.summary).toBe('Roster confirmed')
    expect(result.actor).toBe('Side-stage')
  })
})

describe('sortAuditEntries', () => {
  const t1 = '2026-10-14T15:00:00.000Z'
  const t2 = '2026-10-14T15:10:02.917Z'

  it('puts newest first', () => {
    const older = makeEntry({ id: 'a', created_at: t1 })
    const newer = makeEntry({ id: 'b', created_at: t2 })
    expect(sortAuditEntries([older, newer]).map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('orders one transaction as cause, then chained status changes', () => {
    const signOff = makeEntry({
      id: 'sign-off',
      action: 'sign_off_judge',
      entity_type: 'round',
      created_at: t2
    })
    const toReady = makeEntry({
      id: 'to-ready',
      created_at: t2,
      before_data: { status: 'awaiting_scores' },
      after_data: { status: 'ready_to_tabulate' }
    })
    const toAwaiting = makeEntry({
      id: 'to-awaiting',
      created_at: t2,
      before_data: { status: 'in_progress' },
      after_data: { status: 'awaiting_scores' }
    })
    for (const input of [
      [signOff, toAwaiting, toReady],
      [toAwaiting, toReady, signOff],
      [toReady, signOff, toAwaiting],
      [signOff, toReady, toAwaiting],
      [toAwaiting, signOff, toReady],
      [toReady, toAwaiting, signOff]
    ]) {
      expect(sortAuditEntries(input).map((e) => e.id)).toEqual([
        'to-ready',
        'to-awaiting',
        'sign-off'
      ])
    }
  })
})
