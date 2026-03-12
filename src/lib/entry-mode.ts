export type EntryMode = 'judge_self_service' | 'tabulator_transcription'

/**
 * Check whether a given entry mode can be used for a judge+round combination.
 * Rule: one judge's scores for one round must have one active entry path.
 */
export function canEnterScores(
  existingEntryModes: EntryMode[],
  requestedMode: EntryMode
): { allowed: boolean; reason?: string } {
  if (existingEntryModes.length === 0) return { allowed: true }

  const conflicting = existingEntryModes.find(mode => mode !== requestedMode)
  if (conflicting) {
    return {
      allowed: false,
      reason: `Scores already being entered via ${conflicting}. One entry path per judge per round.`,
    }
  }

  return { allowed: true }
}
