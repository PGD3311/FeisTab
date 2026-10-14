'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildInviteEmail } from '@/lib/email/invite-email'
import { sendEmail } from '@/lib/email/send-email'
import { inviteUrl, isEventRole, normalizeInviteEmail } from '@/lib/invitations'

export type InviteActionResult =
  | { ok: true; url: string; email: string; emailed: boolean; emailProblem: string | null }
  | { ok: false; error: string }

const INVITE_LIFETIME_DAYS = 30

async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

function expiresAt(): string {
  return new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

// Emails the link; the link itself is returned either way so the organizer can text it.
async function deliverInvite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invite: { id: string; token: string; email: string; role: string; event_id: string; judge_id: string | null }
): Promise<InviteActionResult> {
  const url = inviteUrl(await siteOrigin(), invite.token)
  if (!isEventRole(invite.role)) return { ok: false, error: 'Unknown role on this invitation' }

  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('name, start_date')
    .eq('id', invite.event_id)
    .single()
  if (eventErr || !event) return { ok: false, error: 'Could not load the event for this invitation' }

  let judgeName: string | null = null
  if (invite.judge_id) {
    const { data: judge, error: judgeErr } = await supabase
      .from('judges')
      .select('first_name, last_name')
      .eq('id', invite.judge_id)
      .single()
    if (judgeErr) return { ok: false, error: 'Could not load the judge for this invitation' }
    judgeName = judge ? `${judge.first_name} ${judge.last_name}` : null
  }

  const message = buildInviteEmail({
    feisName: event.name as string,
    feisDate: (event.start_date as string | null) ?? null,
    role: invite.role,
    judgeName,
    url,
  })
  const result = await sendEmail({ to: invite.email, ...message })

  if (result.sent) {
    const admin = createAdminClient()
    const { error: stampErr } = await admin
      .from('pending_invitations')
      .update({ last_sent_at: new Date().toISOString() })
      .eq('id', invite.id)
    if (stampErr) console.error('[invite] Failed to record send time:', stampErr.message)
  }

  return {
    ok: true,
    url,
    email: invite.email,
    emailed: result.sent,
    emailProblem: result.sent
      ? null
      : result.reason === 'not_configured'
        ? "Email isn't set up yet"
        : (result.message ?? 'The email could not be sent'),
  }
}

export async function createInvitation(input: {
  eventId: string
  email: string
  role: string
  judgeId: string | null
}): Promise<InviteActionResult> {
  const email = normalizeInviteEmail(input.email)
  if (!email) return { ok: false, error: 'Enter a valid email address' }
  if (!isEventRole(input.role)) return { ok: false, error: 'Choose a role' }
  if (input.role === 'judge' && !input.judgeId) {
    return { ok: false, error: 'Choose which judge this person is' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' }

  if (input.role === 'judge' && input.judgeId) {
    const { data: judge, error: judgeErr } = await supabase
      .from('judges')
      .select('id, user_id')
      .eq('id', input.judgeId)
      .eq('event_id', input.eventId)
      .maybeSingle()
    if (judgeErr) return { ok: false, error: 'Could not check the judge' }
    if (!judge) return { ok: false, error: 'That judge is not part of this event' }
    if (judge.user_id) return { ok: false, error: 'That judge already has a login' }
  }

  // RLS only lets organizers of this event insert
  const { data: invite, error } = await supabase
    .from('pending_invitations')
    .insert({
      email,
      event_id: input.eventId,
      role: input.role,
      judge_id: input.role === 'judge' ? input.judgeId : null,
      invited_by: user.id,
      expires_at: expiresAt(),
    })
    .select('id, token, email, role, event_id, judge_id')
    .single()

  if (error || !invite) {
    if (error?.code === '23505') {
      return {
        ok: false,
        error: `${email} is already invited for this role. Use Resend in the list below.`,
      }
    }
    return { ok: false, error: 'Could not create the invitation. Only organizers can invite.' }
  }

  return deliverInvite(supabase, invite)
}

export async function resendInvitation(inviteId: string): Promise<InviteActionResult> {
  const supabase = await createClient()

  // RLS only returns invitations to organizers of the event
  const { data: invite, error } = await supabase
    .from('pending_invitations')
    .select('id, token, email, role, event_id, judge_id, accepted_at')
    .eq('id', inviteId)
    .maybeSingle()
  if (error) return { ok: false, error: 'Could not load the invitation' }
  if (!invite) return { ok: false, error: 'Invitation not found' }
  if (invite.accepted_at) return { ok: false, error: 'This invitation was already accepted' }

  // Updates are closed to clients; the organizer check above gates this write
  const admin = createAdminClient()
  const { error: extendErr } = await admin
    .from('pending_invitations')
    .update({ expires_at: expiresAt() })
    .eq('id', invite.id)
  if (extendErr) return { ok: false, error: 'Could not renew the invitation' }

  return deliverInvite(supabase, invite)
}

/** Emails for the team list. Organizer-only: RLS hides other members' roles from everyone else. */
export async function getTeamEmails(eventId: string): Promise<Record<string, string>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return {}

  const { data: roles, error } = await supabase
    .from('event_roles')
    .select('user_id, role')
    .eq('event_id', eventId)
  if (error || !roles) return {}

  const isOrganizer = roles.some((r) => r.user_id === user.id && r.role === 'organizer')
  if (!isOrganizer) return {}

  const admin = createAdminClient()
  const emails: Record<string, string> = {}
  for (const userId of new Set(roles.map((r) => r.user_id as string))) {
    const { data, error: userErr } = await admin.auth.admin.getUserById(userId)
    if (!userErr && data.user?.email) emails[userId] = data.user.email
  }
  return emails
}
