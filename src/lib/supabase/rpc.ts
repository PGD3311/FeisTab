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
  nextRoundNumber: number
): Promise<string> {
  const { data, error } = await supabase.rpc('generate_recall', {
    p_competition_id: competitionId,
    p_recall_rows: JSON.stringify(recallRows),
    p_next_round_number: nextRoundNumber,
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
