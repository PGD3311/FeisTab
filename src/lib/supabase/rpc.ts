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

export async function guardedStatusUpdate(
  supabase: SupabaseClient,
  compId: string,
  expectedStatus: CompetitionStatus,
  newStatus: CompetitionStatus,
  extraFields?: Record<string, unknown>
): Promise<void> {
  const { data, error } = await supabase
    .from('competitions')
    .update({ status: newStatus, ...extraFields })
    .eq('id', compId)
    .eq('status', expectedStatus)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to update status: ${error.message}`)
  if (!data) throw new Error(`Competition status changed — refresh and try again`)
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
    p_recall_rows: JSON.stringify(recallRows),
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
    p_result_rows: JSON.stringify(resultRows),
  })
  if (error) throw new Error(`Tabulation approval failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Write RPCs (026_write_rpcs.sql)
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
  if (error) throw new Error(`Check-in failed: ${error.message}`)
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
    p_round_type: params.round_type ?? 'normal',
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

export async function updateStageStatus(
  supabase: SupabaseClient,
  params: { event_id: string; dancer_id: string; competition_id: string; status: string }
): Promise<void> {
  const { error } = await supabase.rpc('update_stage_status', {
    p_event_id: params.event_id,
    p_dancer_id: params.dancer_id,
    p_competition_id: params.competition_id,
    p_status: params.status,
  })
  if (error) throw new Error(`Update stage status failed: ${error.message}`)
}
