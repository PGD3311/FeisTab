'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-2xl font-bold text-feis-charcoal">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-feis-green text-white rounded-md hover:bg-feis-green/90 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
