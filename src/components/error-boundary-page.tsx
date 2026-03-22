'use client'

export function ErrorBoundaryPage({
  title = 'Something went wrong',
  error,
  reset,
}: {
  title?: string
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        <h2 className="text-xl font-bold text-feis-charcoal">{title}</h2>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={reset}
          className="w-full px-4 py-3 bg-feis-green text-white rounded-md hover:bg-feis-green/90 transition-colors text-lg"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
