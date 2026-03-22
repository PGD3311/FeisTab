'use client'

import { ErrorBoundaryPage } from '@/components/error-boundary-page'

export default function CheckinError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBoundaryPage title="Side-Stage Error" {...props} />
}
