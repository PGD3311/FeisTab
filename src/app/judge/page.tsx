import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

interface JudgeEvent {
  event_id: string
  event_name: string
  judge_name: string
}

export default async function JudgePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login?next=/judge')
  }

  // Find events where this user has a judge role
  const { data: roleRows, error: roleErr } = await supabase
    .from('event_roles')
    .select('event_id, events(id, name, start_date)')
    .eq('user_id', user.id)
    .eq('role', 'judge')

  if (roleErr) {
    console.error('Failed to load judge roles:', roleErr.message)
  }

  // Get judge names for these events
  const { data: judges, error: judgeErr } = await supabase
    .from('judges')
    .select('event_id, first_name, last_name')
    .eq('user_id', user.id)

  if (judgeErr) {
    console.error('Failed to load judges:', judgeErr.message)
  }

  const judgeNameMap = new Map<string, string>()
  for (const j of judges ?? []) {
    judgeNameMap.set(j.event_id, `${j.first_name} ${j.last_name}`)
  }

  const judgeEvents: JudgeEvent[] = []
  for (const row of (roleRows as unknown as Array<{
    event_id: string
    events: { id: string; name: string; start_date: string }
  }>) ?? []) {
    const ev = row.events
    if (!ev) continue
    judgeEvents.push({
      event_id: ev.id,
      event_name: ev.name,
      judge_name: judgeNameMap.get(ev.id) ?? user.email ?? 'Judge',
    })
  }

  // If exactly one event, go straight to it
  if (judgeEvents.length === 1) {
    redirect(`/judge/${judgeEvents[0].event_id}`)
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-sm space-y-4">
        <div className="px-2">
          <Link href="/" className="text-sm text-muted-foreground hover:text-feis-green transition-colors">
            &larr; Back
          </Link>
        </div>
        <Card className="feis-card">
          <CardHeader className="text-center">
            <CardTitle className="text-xl font-semibold">Judge Events</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Select an event to score</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {judgeEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                You have not been assigned as a judge to any events.
              </p>
            ) : (
              judgeEvents.map((je) => (
                <Link
                  key={je.event_id}
                  href={`/judge/${je.event_id}`}
                  className="block p-4 rounded-md border hover:border-feis-green/50 hover:bg-feis-green-light/30 transition-colors"
                >
                  <p className="font-medium">{je.event_name}</p>
                  <p className="text-sm text-muted-foreground">{je.judge_name}</p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
