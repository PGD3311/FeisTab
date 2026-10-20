/**
 * Invitation rules shared by the organizer's team page and the invite link page.
 * Pure functions — no Supabase, no React.
 */

import { type EventRole } from '@/lib/auth/require-role'

export const INVITE_ROLE_LABELS: Record<EventRole, string> = {
  organizer: 'Organizer',
  registration_desk: 'Registration Desk',
  side_stage: 'Side Stage',
  judge: 'Judge',
}

/** How the role reads in "You're invited to …" */
export const INVITE_ROLE_PHRASES: Record<EventRole, string> = {
  organizer: 'help organize',
  registration_desk: 'work the registration desk at',
  side_stage: 'run side-stage at',
  judge: 'judge at',
}

export function isEventRole(value: string): value is EventRole {
  return value in INVITE_ROLE_LABELS
}

/** Where someone lands after accepting, so a judge goes straight to their competitions. */
export function inviteDestination(role: EventRole, eventId: string): string {
  switch (role) {
    case 'judge':
      return `/judge/${eventId}`
    case 'registration_desk':
      return `/registration/${eventId}`
    case 'side_stage':
      return `/checkin/${eventId}`
    case 'organizer':
      return `/dashboard/events/${eventId}`
  }
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/auth/invite/${token}`
}

export type InviteState = 'open' | 'accepted' | 'expired'

export function inviteState(
  invite: { accepted_at: string | null; expires_at: string },
  now: Date
): InviteState {
  if (invite.accepted_at) return 'accepted'
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'open'
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeInviteEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase()
  return EMAIL_PATTERN.test(normalized) ? normalized : null
}

export type JudgeLoginStatus = 'can_sign_in' | 'invited' | 'paper_only'

export const JUDGE_LOGIN_LABELS: Record<JudgeLoginStatus, string> = {
  can_sign_in: 'Can sign in',
  invited: 'Invited',
  paper_only: 'Paper only'
}

/** A judge's login status from their linked user and the invites linked to them. */
export function judgeLoginStatus(
  judge: { id: string; user_id: string | null },
  invites: Array<{ judge_id: string | null; accepted_at: string | null }>
): JudgeLoginStatus {
  if (judge.user_id) return 'can_sign_in'
  const linked = invites.filter((inv) => inv.judge_id === judge.id)
  if (linked.some((inv) => inv.accepted_at !== null)) return 'can_sign_in'
  if (linked.length > 0) return 'invited'
  return 'paper_only'
}
