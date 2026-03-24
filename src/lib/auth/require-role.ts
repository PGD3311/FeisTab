export type EventRole = 'organizer' | 'registration_desk' | 'side_stage' | 'judge'

// Organizer inherits registration_desk + side_stage but NOT judge
const ROLE_INHERITANCE: Record<string, EventRole[]> = {
  organizer: ['registration_desk', 'side_stage'],
}

export function expandRoles(userRoles: EventRole[]): EventRole[] {
  const expanded = new Set(userRoles)
  for (const role of userRoles) {
    const inherited = ROLE_INHERITANCE[role]
    if (inherited) inherited.forEach((r) => expanded.add(r))
  }
  return [...expanded]
}

export function hasRequiredRole(
  userRoles: EventRole[],
  allowedRoles: EventRole[]
): boolean {
  const expanded = expandRoles(userRoles)
  return allowedRoles.some((role) => expanded.includes(role))
}
