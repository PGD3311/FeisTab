import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen feis-bg-texture flex flex-col">
      <header className="bg-feis-green">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center">
          <span className="font-serif text-2xl font-bold text-white tracking-tight">
            FeisTab
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-3xl w-full">
          <div className="text-center mb-10">
            <h1 className="font-serif text-4xl font-bold text-feis-charcoal mb-2">
              Welcome to FeisTab
            </h1>
            <p className="text-muted-foreground">
              Live tabulation and results for Irish dance competitions
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link
              href="/dashboard"
              className="group p-6 rounded-lg border-2 border-feis-green/20 bg-white hover:border-feis-green/50 hover:shadow-md transition-all"
            >
              <h2 className="font-serif text-xl font-bold text-feis-charcoal mb-1">
                Organizer
              </h2>
              <p className="text-sm text-muted-foreground">
                Set up events, manage competitions, run tabulation, publish results
              </p>
            </Link>

            <Link
              href="/judge"
              className="group p-6 rounded-lg border-2 border-feis-green/20 bg-white hover:border-feis-green/50 hover:shadow-md transition-all"
            >
              <h2 className="font-serif text-xl font-bold text-feis-charcoal mb-1">
                Judge
              </h2>
              <p className="text-sm text-muted-foreground">
                Sign in with your access code, score dancers, sign off rounds
              </p>
            </Link>

            <Link
              href="/results"
              className="group p-6 rounded-lg border-2 border-feis-green/20 bg-white hover:border-feis-green/50 hover:shadow-md transition-all"
            >
              <h2 className="font-serif text-xl font-bold text-feis-charcoal mb-1">
                Results
              </h2>
              <p className="text-sm text-muted-foreground">
                View published competition results and placements
              </p>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
