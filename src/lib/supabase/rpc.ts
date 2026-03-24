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
