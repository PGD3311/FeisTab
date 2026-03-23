import { type SupabaseClient } from '@supabase/supabase-js'

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
