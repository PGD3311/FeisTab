import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { logout, fulfillInvitations } from '@/app/auth/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

type EventRole = 'organizer' | 'registration_desk' | 'side_stage' | 'judge'

interface EventRoleRow {
  role: EventRole
  event_id: string
  events: {
    id: string
    name: string
    start_date: string
  }
}

interface EventWithRoles {
  id: string
  name: string
  start_date: string
  roles: EventRole[]
}

const ROLE_LABELS: Record<EventRole, string> = {
  organizer: 'Organizer',
  registration_desk: 'Registration Desk',
  side_stage: 'Side-Stage',
  judge: 'Judge',
}

const ROLE_BADGE_CLASSES: Record<EventRole, string> = {
  organizer: 'bg-feis-green text-white border-feis-green',
  registration_desk: 'bg-feis-green-light text-feis-green border-feis-green/30',
  side_stage: 'bg-feis-orange-light text-feis-orange border-feis-orange/30',
  judge: 'bg-muted text-feis-charcoal border-border',
}

function getActionLinks(eventId: string, roles: EventRole[]) {
  const links: { label: string; href: string }[] = []
  const hasRole = (r: EventRole) => roles.includes(r)

  if (hasRole('organizer')) {
    links.push({ label: 'Dashboard', href: `/dashboard/events/${eventId}` })
    links.push({ label: 'Check-In', href: `/registration/${eventId}` })
    links.push({ label: 'Side-Stage', href: `/checkin/${eventId}` })
    links.push({ label: 'Team', href: `/dashboard/events/${eventId}/judges` })
  } else {
    if (hasRole('registration_desk')) {
      links.push({ label: 'Check-In', href: `/registration/${eventId}` })
    }
    if (hasRole('side_stage')) {
      links.push({ label: 'Side-Stage', href: `/checkin/${eventId}` })
    }
  }

  if (hasRole('judge')) {
    links.push({ label: 'My Assignments', href: `/judge/${eventId}` })
  }

  return links
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default async function HomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { data: roleRows, error } = await supabase
    .from('event_roles')
    .select('role, event_id, events(id, name, start_date)')
    .eq('user_id', user.id)
    .order('event_id')

  if (error) {
    console.error('Failed to load event roles:', error.message)
  }

  // Group roles by event
  const eventMap = new Map<string, EventWithRoles>()
  for (const row of (roleRows as EventRoleRow[] | null) ?? []) {
    const ev = row.events
    if (!ev) continue
    if (!eventMap.has(ev.id)) {
      eventMap.set(ev.id, { id: ev.id, name: ev.name, start_date: ev.start_date, roles: [] })
    }
    eventMap.get(ev.id)!.roles.push(row.role)
  }

  const events = Array.from(eventMap.values()).sort(
    (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
  )

  return (
    <div className="min-h-screen bg-feis-cream">
      <div className="max-w-lg mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-feis-green">FeisTab</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{user.email}</p>
          </div>
          <form action={logout}>
            <Button variant="ghost" size="sm" type="submit" className="text-muted-foreground">
              Sign out
            </Button>
          </form>
        </div>

        {/* Event cards or empty state */}
        {events.length === 0 ? (
          <div className="space-y-4">
            <Card className="border-border bg-white">
              <CardContent className="pt-6 pb-6 text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  You haven&apos;t been added to any events yet.
                </p>
                <div className="flex flex-col gap-2">
                  <form action={fulfillInvitations}>
                    <Button
                      type="submit"
                      variant="outline"
                      className="w-full border-feis-green text-feis-green hover:bg-feis-green-light"
                    >
                      Check for pending invitations
                    </Button>
                  </form>
                  <form action={logout}>
                    <Button type="submit" variant="ghost" className="w-full text-muted-foreground">
                      Sign out
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => {
              const links = getActionLinks(event.id, event.roles)
              return (
                <Card key={event.id} className="border-border bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-feis-charcoal">
                      {event.name}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{formatDate(event.start_date)}</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Role badges */}
                    <div className="flex flex-wrap gap-1.5">
                      {event.roles.map((role) => (
                        <Badge
                          key={role}
                          variant="outline"
                          className={`text-xs ${ROLE_BADGE_CLASSES[role]}`}
                        >
                          {ROLE_LABELS[role]}
                        </Badge>
                      ))}
                    </div>
                    {/* Action links */}
                    {links.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {links.map((link, i) => (
                          <span key={link.href} className="flex items-center gap-3">
                            <Link
                              href={link.href}
                              className="text-sm font-medium text-feis-green hover:text-feis-green/80 transition-colors"
                            >
                              {link.label}
                            </Link>
                            {i < links.length - 1 && (
                              <span className="text-border text-sm select-none">·</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
