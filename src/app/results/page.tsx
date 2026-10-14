import Link from 'next/link'
import { RunFeisLogo } from '@/components/runfeis-logo'

export default function ResultsLandingPage() {
  return (
    <div className="min-h-screen bg-feis-cream flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <h1 className="flex flex-col items-center gap-2">
          <RunFeisLogo size="md" />
          <span className="text-xl font-semibold text-feis-charcoal">Results</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Results are shared by your event organizer via a direct link.
        </p>
        <Link href="/" className="text-sm text-feis-green hover:underline">
          &larr; Back to RunFeis
        </Link>
      </div>
    </div>
  )
}
