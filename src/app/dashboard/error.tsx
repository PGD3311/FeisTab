'use client'

import Link from 'next/link'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold text-feis-charcoal">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="px-4 py-2 bg-feis-green text-white rounded-md hover:bg-feis-green/90 transition-colors"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="px-4 py-2 border rounded-md hover:bg-feis-cream transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
