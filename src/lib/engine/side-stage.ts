// Side-stage marks every dancer present, no-show or scratched before a competition goes to the
// judge. These statuses mean side-stage hasn't marked the dancer yet.
const AWAITING_SIDE_STAGE = new Set(['registered', 'checked_in'])

/** How many dancers on a roster side-stage still has to mark. */
export function countAwaitingSideStage(statuses: readonly string[]): number {
  return statuses.filter((s) => AWAITING_SIDE_STAGE.has(s)).length
}

/** Why the roster can't be confirmed yet, or null when every dancer is marked. */
export function sideStageBlockReason(statuses: readonly string[]): string | null {
  const n = countAwaitingSideStage(statuses)
  if (n === 0) return null
  return `${n} dancer${n === 1 ? '' : 's'} not checked in at side-stage yet. Mark each one Present, No Show or Scratched first.`
}
