'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateNextParam } from '@/lib/auth/validate-next'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const next = validateNextParam(formData.get('next') as string)

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return { error: error.message }
  }

  await fulfillInvitations()
  redirect(next)
}

export async function signup(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) {
    return { error: error.message }
  }

  return { success: 'Check your email for a confirmation link.' }
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/auth/login')
}

export async function fulfillInvitations() {
  const supabase = await createClient()
  const admin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return

  const normalizedEmail = user.email.toLowerCase().trim()

  const { data: invitations } = await admin
    .from('pending_invitations')
    .select('*')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)

  if (!invitations?.length) return

  // Fulfill via RPC for transactional safety
  // The fulfill_invitation RPC will be created in migration 026
  // For now, do sequential writes with idempotency
  for (const inv of invitations) {
    await admin
      .from('event_roles')
      .upsert(
        {
          user_id: user.id,
          event_id: inv.event_id,
          role: inv.role,
          created_by: inv.invited_by,
        },
        { onConflict: 'user_id,event_id,role' }
      )

    if (inv.judge_id) {
      await admin
        .from('judges')
        .update({ user_id: user.id })
        .eq('id', inv.judge_id)
    }

    await admin
      .from('pending_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', inv.id)
  }
}
