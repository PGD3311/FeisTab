import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-feis-green">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center">
          <span className="text-lg font-bold text-white tracking-wide uppercase">
            FeisTab
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-xl w-full">
          <div className="mb-10">
            <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-2">
              Competition Tabulation System
            </p>
            <h1 className="text-3xl font-bold tracking-tight mb-1">
              Select your role
            </h1>
          </div>

          <div className="space-y-2">
            <Link
              href="/dashboard"
              className="group flex items-center justify-between p-4 rounded border border-border bg-white hover:border-feis-green transition-colors"
            >
              <div>
                <h2 className="text-base font-semibold">Organizer Dashboard</h2>
                <p className="text-sm text-muted-foreground">
                  Manage events, run tabulation, publish results
                </p>
              </div>
              <span className="text-muted-foreground group-hover:text-feis-green transition-colors text-lg">
                &rarr;
              </span>
            </Link>

            <Link
              href="/judge"
              className="group flex items-center justify-between p-4 rounded border border-border bg-white hover:border-feis-green transition-colors"
            >
              <div>
                <h2 className="text-base font-semibold">Judge Scoring</h2>
                <p className="text-sm text-muted-foreground">
                  Enter scores, flag anomalies, sign off rounds
                </p>
              </div>
              <span className="text-muted-foreground group-hover:text-feis-green transition-colors text-lg">
                &rarr;
              </span>
            </Link>

            <Link
              href="/results"
              className="group flex items-center justify-between p-4 rounded border border-border bg-white hover:border-feis-green transition-colors"
            >
              <div>
                <h2 className="text-base font-semibold">Public Results</h2>
                <p className="text-sm text-muted-foreground">
                  View published placements and scores
                </p>
              </div>
              <span className="text-muted-foreground group-hover:text-feis-green transition-colors text-lg">
                &rarr;
              </span>
            </Link>
          </div>

          <p className="text-xs text-muted-foreground mt-8">
            FeisTab &middot; Live tabulation for Irish dance competitions
          </p>
        </div>
      </main>
    </div>
  )
}
