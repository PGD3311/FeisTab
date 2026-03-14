// src/lib/check-in-sync.ts
//
// DB write helper — temporary compatibility bridge.
// Separated from check-in.ts to keep that file pure (CLAUDE.md rule 1.4).
//
// This is the ONLY path that writes registrations.competitor_number
// in new code. Must be called as part of the primary action, not
// fire-and-forget.

import { type SupabaseClient } from '@supabase/supabase-js'

export async function syncCompetitorNumberToRegistrations(
  supabase: SupabaseClient,
  eventId: string,
  dancerId: string,
  competitorNumber: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('registrations')
    .update({ competitor_number: competitorNumber })
    .eq('event_id', eventId)
    .eq('dancer_id', dancerId)

  if (error) {
    return { error: new Error(error.message) }
  }
  return { error: null }
}
