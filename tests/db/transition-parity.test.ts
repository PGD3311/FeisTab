import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type CompetitionStatus, getNextStates } from '@/lib/competition-states'

// The database enforces the same state machine (is_valid_transition in migration 032,
// used by trg_competition_status_guard). If the two drift, the UI offers transitions
// the database rejects, or the database allows ones the UI never would.

const ALL_STATUSES: CompetitionStatus[] = [
  'draft',
  'imported',
  'ready_for_day_of',
  'released_to_judge',
  'in_progress',
  'awaiting_scores',
  'ready_to_tabulate',
  'recalled_round_pending',
  'complete_unpublished',
  'published',
  'locked',
]

function dbTransitions(): string[] {
  const sql = readFileSync(
    join(__dirname, '../../supabase/migrations/032_phase1_unbreak_chain.sql'),
    'utf8'
  )
  const fn = sql.match(/FUNCTION is_valid_transition[\s\S]*?\$\$([\s\S]*?)\$\$/)
  if (!fn) throw new Error('is_valid_transition not found in migration 032')
  return [...fn[1].matchAll(/\('(\w+)',\s*'(\w+)'\)/g)].map((m) => `${m[1]}->${m[2]}`).sort()
}

function appTransitions(): string[] {
  return ALL_STATUSES.flatMap((from) => getNextStates(from).map((to) => `${from}->${to}`)).sort()
}

describe('competition state machine parity', () => {
  it('database transitions match competition-states.ts exactly', () => {
    expect(dbTransitions()).toEqual(appTransitions())
  })

  it('covers every status the app defines', () => {
    expect(appTransitions().length).toBeGreaterThan(0)
    for (const status of ALL_STATUSES) {
      expect(getNextStates(status)).toBeDefined()
    }
  })
})
