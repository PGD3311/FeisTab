'use client'

import { ErrorBoundaryPage } from '@/components/error-boundary-page'

export default function ResultsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBoundaryPage title="Results Error" {...props} />
}
