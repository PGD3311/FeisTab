'use client'

import { ErrorBoundaryPage } from '@/components/error-boundary-page'

export default function JudgeError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBoundaryPage title="Something went wrong" {...props} />
}
