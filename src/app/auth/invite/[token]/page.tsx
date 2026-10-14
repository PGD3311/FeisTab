import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { INVITE_ROLE_PHRASES, inviteDestination, inviteState, isEventRole } from '@/lib/invitations'
import { Button, buttonVariants } from '@/components/ui/button'
import { AcceptForm, AcceptSignedIn } from './accept-form'
import { signOutAndReturn } from './actions'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function formatDate(date: string | null): string | null {
  if (!date) return null
  const parsed = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-feis-cream flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <p className="text-center text-2xl font-bold text-feis-charcoal">FeisTab</p>
        {children}
      </div>
    </div>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <div className="feis-card bg-white p-6 space-y-3">
        <h1 className="text-xl font-semibold text-feis-charcoal">{title}</h1>
        <div className="text-base text-muted-foreground leading-relaxed space-y-4">{children}</div>
      </div>
    </Shell>
  )
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  if (!UUID_PATTERN.test(token)) {
    return (
      <Notice title="This invite link isn't valid">
        <p>Check you copied the whole link, or ask the organizer to send a new one.</p>
      </Notice>
    )
  }

  const admin = createAdminClient()
  const { data: invite, error } = await admin
    .from('pending_invitations')
    .select(
      'email, role, event_id, accepted_at, expires_at, events(name, start_date, location), judges(first_name, last_name)'
    )
    .eq('token', token)
    .maybeSingle()

  if (error) {
    return (
      <Notice title="Couldn't load your invite">
        <p>Something went wrong on our side. Refresh the page to try again.</p>
      </Notice>
    )
  }

  if (!invite || !isEventRole(invite.role)) {
    return (
      <Notice title="This invite link isn't valid">
        <p>It may have been cancelled. Ask the organizer to send a new one.</p>
      </Notice>
    )
  }

  const role = invite.role
  const event = invite.events as unknown as {
    name: string
    start_date: string | null
    location: string | null
  } | null
  const judge = invite.judges as unknown as { first_name: string; last_name: string } | null
  const judgeName = judge ? `${judge.first_name} ${judge.last_name}` : null
  const destination = inviteDestination(role, invite.event_id)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const signedInEmail = user?.email?.toLowerCase() ?? null
  const isInvitee = signedInEmail === invite.email

  const state = inviteState(invite, new Date())
  const loginHref = `/auth/login?email=${encodeURIComponent(invite.email)}&next=${encodeURIComponent(destination)}`

  if (state === 'accepted') {
    if (isInvitee) redirect(destination)
    return (
      <Notice title="You've already accepted this invite">
        <p>Sign in with {invite.email} to get to your screen.</p>
        <Link href={loginHref} className={buttonVariants({ className: 'w-full h-12 text-base' })}>
          Sign in
        </Link>
      </Notice>
    )
  }

  if (state === 'expired') {
    return (
      <Notice title="This invite has expired">
        <p>Ask the organizer to resend it from the Judges &amp; Team page. The new email will have a fresh link.</p>
      </Notice>
    )
  }

  const date = formatDate(event?.start_date ?? null)

  return (
    <Shell>
      <div className="feis-card bg-white overflow-hidden">
        <div className="bg-feis-green px-6 py-6 text-white">
          <p className="text-base text-white/80">You&apos;re invited to {INVITE_ROLE_PHRASES[role]}</p>
          <h1 className="text-3xl font-bold leading-tight mt-1 text-balance">
            {event?.name ?? 'a feis'}
          </h1>
          {(date || event?.location) && (
            <p className="text-base text-white/80 mt-2">
              {[date, event?.location].filter(Boolean).join(', ')}
            </p>
          )}
        </div>

        <div className="p-6 space-y-5">
          {judgeName && (
            <p className="text-lg text-feis-charcoal">
              You&apos;ll be judging as <span className="font-semibold">{judgeName}</span>.
            </p>
          )}

          {signedInEmail && !isInvitee ? (
            <div className="space-y-4">
              <p className="text-base text-muted-foreground leading-relaxed">
                You&apos;re signed in as {signedInEmail}, but this invite is for{' '}
                <span className="font-medium text-feis-charcoal">{invite.email}</span>. Sign out
                to accept it.
              </p>
              <form action={signOutAndReturn.bind(null, token)}>
                <Button type="submit" variant="outline" className="w-full h-12 text-base">
                  Sign out
                </Button>
              </form>
            </div>
          ) : isInvitee ? (
            <AcceptSignedIn token={token} email={invite.email} />
          ) : (
            <AcceptForm
              token={token}
              email={invite.email}
              defaultName={judgeName ?? ''}
              loginHref={loginHref}
            />
          )}
        </div>
      </div>
    </Shell>
  )
}
