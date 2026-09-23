import { type SupabaseClient } from '@supabase/supabase-js'
import { type CompetitionStatus } from '@/lib/competition-states'

export async function signOffJudge(
  supabase: SupabaseClient,
  roundId: string,
  judgeId: string,
  competitionId: string,
  action: 'add' | 'remove' = 'add'
): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('sign_off_judge', {
    p_round_id: roundId,
    p_judge_id: judgeId,
    p_competition_id: competitionId,
    p_action: action,
  })
  if (error) throw new Error(`Sign-off failed: ${error.message}`)
  return data as Record<string, string>
}

/**
 * Status change that fails if another device moved the competition first.
 * The database validates the transition and the caller's role.
 */
export async function guardedStatusUpdate(
  supabase: SupabaseClient,
  compId: string,
  expectedStatus: CompetitionStatus,
  newStatus: CompetitionStatus
): Promise<void> {
  const { error } = await supabase.rpc('transition_competition_status', {
    p_competition_id: compId,
    p_new_status: newStatus,
    p_expected_status: expectedStatus,
  })
  if (error) throw new Error(`Failed to update status: ${error.message}`)
}

export async function unlockForCorrection(
  supabase: SupabaseClient,
  params: { competition_id: string; judge_id: string; reason: string; note?: string }
): Promise<void> {
  const { error } = await supabase.rpc('unlock_for_correction', {
    p_competition_id: params.competition_id,
    p_judge_id: params.judge_id,
    p_reason: params.reason,
    p_note: params.note ?? null,
  })
  if (error) throw new Error(`Unlock failed: ${error.message}`)
}

export async function publishResults(
  supabase: SupabaseClient,
  competitionId: string,
  approvedBy: string
): Promise<void> {
  const { error } = await supabase.rpc('publish_results', {
    p_competition_id: competitionId,
    p_approved_by: approvedBy,
  })
  if (error) throw new Error(`Publish failed: ${error.message}`)
}

export async function unpublishResults(
  supabase: SupabaseClient,
  competitionId: string,
  unpublishedBy: string
): Promise<void> {
  const { error } = await supabase.rpc('unpublish_results', {
    p_competition_id: competitionId,
    p_unpublished_by: unpublishedBy,
  })
  if (error) throw new Error(`Unpublish failed: ${error.message}`)
}

export async function generateRecall(
  supabase: SupabaseClient,
  competitionId: string,
  recallRows: { dancer_id: string; source_round_id: string }[],
  nextRoundNumber: number,
  expectedStatus: CompetitionStatus = 'ready_to_tabulate' as CompetitionStatus
): Promise<string> {
  const { data, error } = await supabase.rpc('generate_recall', {
    p_competition_id: competitionId,
    p_recall_rows: recallRows,
    p_next_round_number: nextRoundNumber,
    p_expected_status: expectedStatus,
  })
  if (error) throw new Error(`Recall generation failed: ${error.message}`)
  return data as string
}

export async function approveTabulation(
  supabase: SupabaseClient,
  competitionId: string,
  resultRows: {
    dancer_id: string
    final_rank: number
    display_place: string
    calculated_payload: unknown
  }[]
): Promise<void> {
  const { error } = await supabase.rpc('approve_tabulation', {
    p_competition_id: competitionId,
    p_result_rows: resultRows,
  })
  if (error) throw new Error(`Tabulation approval failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Write RPCs (026_write_rpcs.sql, 032_phase1_unbreak_chain.sql)
// ---------------------------------------------------------------------------

export async function createEvent(
  supabase: SupabaseClient,
  params: { name: string; start_date: string; end_date: string; location?: string }
): Promise<string> {
  const { data, error } = await supabase.rpc('create_event', {
    p_name: params.name,
    p_start_date: params.start_date,
    p_end_date: params.end_date,
    p_location: params.location ?? null,
  })
  if (error) throw new Error(`Create event failed: ${error.message}`)
  return data as string
}

export async function submitScore(
  supabase: SupabaseClient,
  params: {
    competition_id: string
    round_id: string
    dancer_id: string
    raw_score: number
    flagged?: boolean
    flag_reason?: string
    comment_data?: Record<string, unknown>
  }
): Promise<string> {
  const { data, error } = await supabase.rpc('submit_score', {
    p_competition_id: params.competition_id,
    p_round_id: params.round_id,
    p_dancer_id: params.dancer_id,
    p_raw_score: params.raw_score,
    p_flagged: params.flagged ?? false,
    p_flag_reason: params.flag_reason ?? null,
    p_comment_data: params.comment_data ?? null,
  })
  if (error) throw new Error(`Submit score failed: ${error.message}`)
  return data as string
}

export async function tabulatorEnterScore(
  supabase: SupabaseClient,
  params: {
    competition_id: string
    round_id: string
    dancer_id: string
    judge_id: string
    raw_score: number
    flagged?: boolean
    flag_reason?: string
  }
): Promise<string> {
  const { data, error } = await supabase.rpc('tabulator_enter_score', {
    p_competition_id: params.competition_id,
    p_round_id: params.round_id,
    p_dancer_id: params.dancer_id,
    p_judge_id: params.judge_id,
    p_raw_score: params.raw_score,
    p_flagged: params.flagged ?? false,
    p_flag_reason: params.flag_reason ?? null,
  })
  if (error) throw new Error(`Tabulator enter score failed: ${error.message}`)
  return data as string
}

export async function checkInDancer(
  supabase: SupabaseClient,
  params: { event_id: string; dancer_id: string; competitor_number: number }
): Promise<string> {
  const { data, error } = await supabase.rpc('check_in_dancer', {
    p_event_id: params.event_id,
    p_dancer_id: params.dancer_id,
    p_competitor_number: params.competitor_number,
  })
  // Keep the Postgres code in the message: the desk retries the next number on 23505
  if (error) throw new Error(`Check-in failed (${error.code}): ${error.message}`)
  return data as string
}

export async function transitionCompetitionStatus(
  supabase: SupabaseClient,
  competitionId: string,
  newStatus: string
): Promise<void> {
  const { error } = await supabase.rpc('transition_competition_status', {
    p_competition_id: competitionId,
    p_new_status: newStatus,
  })
  if (error) throw new Error(`Transition status failed: ${error.message}`)
}

export async function confirmRoster(
  supabase: SupabaseClient,
  competitionId: string
): Promise<void> {
  const { error } = await supabase.rpc('confirm_roster', {
    p_competition_id: competitionId,
  })
  if (error) throw new Error(`Confirm roster failed: ${error.message}`)
}

export async function createRound(
  supabase: SupabaseClient,
  params: { competition_id: string; round_number: number; round_type?: string }
): Promise<string> {
  const { data, error } = await supabase.rpc('create_round', {
    p_competition_id: params.competition_id,
    p_round_number: params.round_number,
    p_round_type: params.round_type ?? 'standard',
  })
  if (error) throw new Error(`Create round failed: ${error.message}`)
  return data as string
}

export async function updateHeatSnapshot(
  supabase: SupabaseClient,
  roundId: string,
  snapshot: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.rpc('update_heat_snapshot', {
    p_round_id: roundId,
    p_snapshot: snapshot,
  })
  if (error) throw new Error(`Update heat snapshot failed: ${error.message}`)
}

export async function registerDancer(
  supabase: SupabaseClient,
  params: { event_id: string; competition_id: string; dancer_id: string }
): Promise<string | null> {
  const { data, error } = await supabase.rpc('register_dancer', {
    p_event_id: params.event_id,
    p_competition_id: params.competition_id,
    p_dancer_id: params.dancer_id,
  })
  if (error) throw new Error(`Register dancer failed: ${error.message}`)
  return data as string | null
}

export async function setRegistrationStatus(
  supabase: SupabaseClient,
  registrationId: string,
  status: string
): Promise<void> {
  const { error } = await supabase.rpc('set_registration_status', {
    p_registration_id: registrationId,
    p_status: status,
  })
  if (error) throw new Error(`Status update failed: ${error.message}`)
}

export async function unconfirmRoster(
  supabase: SupabaseClient,
  competitionId: string
): Promise<void> {
  const { error } = await supabase.rpc('unconfirm_roster', {
    p_competition_id: competitionId,
  })
  if (error) throw new Error(`Un-confirm roster failed: ${error.message}`)
}

export async function undoCheckIn(
  supabase: SupabaseClient,
  eventId: string,
  dancerId: string
): Promise<void> {
  const { error } = await supabase.rpc('undo_check_in', {
    p_event_id: eventId,
    p_dancer_id: dancerId,
  })
  if (error) throw new Error(`Undo check-in failed: ${error.message}`)
}

export interface ImportRowInput {
  first_name: string
  last_name: string
  school_name?: string | null
  teacher_name?: string | null
  date_of_birth?: string | null
  competition_code: string
  competition_name?: string | null
  age_group?: string | null
  level?: string | null
  dance_type?: string | null
  competitor_number?: string | null
}

export interface ImportResult {
  competitions_created: number
  registrations: number
  check_ins: number
  /** Dancer ids whose competitor number conflicted and was not assigned */
  conflicts: string[]
}

export async function importEventRows(
  supabase: SupabaseClient,
  eventId: string,
  rows: ImportRowInput[]
): Promise<ImportResult> {
  const { data, error } = await supabase.rpc('import_event_rows', {
    p_event_id: eventId,
    p_rows: rows,
  })
  if (error) throw new Error(`Import failed: ${error.message}`)
  return data as ImportResult
}

export async function deleteEvent(supabase: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_event', { p_event_id: eventId })
  if (error) throw new Error(`Delete event failed: ${error.message}`)
}

export async function removeJudge(supabase: SupabaseClient, judgeId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_judge', { p_judge_id: judgeId })
  if (error) throw new Error(`Remove judge failed: ${error.message}`)
}
