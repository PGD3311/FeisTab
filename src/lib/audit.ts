import { type SupabaseClient } from '@supabase/supabase-js'

export type AuditAction =
  | 'import'
  | 'score_submit'
  | 'score_edit'
  | 'score_transcribe'
  | 'sign_off'
  | 'tabulate'
  | 'status_change'
  | 'result_publish'
  | 'result_unpublish'
  | 'competition_update'
  | 'recall_generate'
  | 'scratch'
  | 'disqualify'
  | 'unlock_for_correction'

export async function logAudit(
  supabase: SupabaseClient,
  params: {
    userId: string | null
    entityType: string
    entityId: string
    action: AuditAction
    beforeData?: Record<string, unknown>
    afterData?: Record<string, unknown>
  }
) {
  const { error } = await supabase.from('audit_log').insert({
    user_id: params.userId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    before_data: params.beforeData ?? null,
    after_data: params.afterData ?? null,
  })

  if (error) {
    console.error('Failed to write audit log:', error)
  }
}
