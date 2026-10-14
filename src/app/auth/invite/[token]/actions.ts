'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fulfillInvitations } from '@/app/auth/actions'
import { inviteDestination, inviteState, isEventRole } from '@/lib/invitations'

export type AcceptResult = { error: string; accountExists?: boolean } | undefined

const MIN_PASSWORD_LENGTH = 8

async function loadOpenInvite(token: string) {
  const admin = createAdminClient()
  const { data: invite, error } = await admin
    .from('pending_invitations')
    .select('id, email, role, event_id, accepted_at, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (error || !invite) return { error: "This invite link isn't valid. Ask the organizer for a new one." }
  const state = inviteState(invite, new Date())
  if (state === 'expired') return { error: 'This invite has expired. Ask the organizer to resend it.' }
  if (state === 'accepted') return { error: 'This invite has already been accepted. Sign in instead.' }
  if (!isEventRole(invite.role)) return { error: "This invite link isn't valid." }
  return { invite: { ...invite, role: invite.role } }
}

async function finish(token: string, eventId: string, role: Parameters<typeof inviteDestination>[0]) {
  await fulfillInvitations()

  const admin = createAdminClient()
  const { data: check } = await admin
    .from('pending_invitations')
    .select('accepted_at')
    .eq('token', token)
    .maybeSingle()
  if (!check?.accepted_at) {
    return {
      error:
        "You're signed in, but we couldn't connect you to the event. Try again, or ask the organizer to resend the invite.",
    }
  }
  redirect(inviteDestination(role, eventId))
}

/** New person: create their account from the invite, sign them in, connect them to the event. */
export async function acceptInvitation(token: string, formData: FormData): Promise<AcceptResult> {
  const fullName = String(formData.get('full_name') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm_password') ?? '')

  if (!fullName) return { error: 'Enter your name' }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password` }
  }
  if (password !== confirm) return { error: "The two passwords don't match" }

  const loaded = await loadOpenInvite(token)
  if (!loaded.invite) return { error: loaded.error }
  const { invite } = loaded

  // The link went to this address, so the email counts as confirmed
  const admin = createAdminClient()
  const { error: createErr } = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createErr) {
    if (createErr.code === 'email_exists' || createErr.status === 422) {
      return { error: 'You already have a RunFeis account.', accountExists: true }
    }
    console.error('[invite] Failed to create account:', createErr.message)
    return { error: 'Could not create your account. Try again.' }
  }

  const supabase = await createClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: invite.email,
    password,
  })
  if (signInErr) {
    return { error: 'Your account was created, but signing in failed. Sign in with your new password.' }
  }

  return finish(token, invite.event_id, invite.role)
}

/** Already signed in as the invited email: just connect them. */
export async function acceptAsSignedIn(token: string): Promise<AcceptResult> {
  const loaded = await loadOpenInvite(token)
  if (!loaded.invite) return { error: loaded.error }
  const { invite } = loaded

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email || user.email.toLowerCase() !== invite.email) {
    return { error: `This invite is for ${invite.email}. Sign in with that email to accept it.` }
  }

  return finish(token, invite.event_id, invite.role)
}

export async function signOutAndReturn(token: string): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect(`/auth/invite/${token}`)
}
