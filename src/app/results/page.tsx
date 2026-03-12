import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function ResultsLandingPage() {
  const supabase = await createClient()

  const { data: events } = await supabase
    .from('events')
    .select('id, name, start_date, location')
    .eq('status', 'active')
    .order('start_date', { ascending: false })

  return (
    <div className="min-h-screen feis-bg-texture">
      <header className="bg-feis-green">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold text-white tracking-wide uppercase">
            FeisTab
          </Link>
          <span className="text-white/70 text-sm">Results</span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-6">Results</h1>
        {(!events || events.length === 0) ? (
          <p className="text-muted-foreground">No events with published results yet.</p>
        ) : (
          <div className="space-y-3">
            {events.map(event => (
              <Link key={event.id} href={`/results/${event.id}`}>
                <Card className="feis-card cursor-pointer">
                  <CardContent className="pt-4 pb-4">
                    <p className="font-medium">{event.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {event.start_date} {event.location && `· ${event.location}`}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
