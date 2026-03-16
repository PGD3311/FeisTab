import Link from 'next/link'

export default function ResultsLandingPage() {
  return (
    <div className="min-h-screen bg-feis-cream flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold text-feis-charcoal">FeisTab Results</h1>
        <p className="text-muted-foreground text-sm">
          Results are shared by your event organizer via a direct link.
        </p>
        <Link href="/" className="text-sm text-feis-green hover:underline">
          &larr; Back to FeisTab
        </Link>
      </div>
    </div>
  )
}
