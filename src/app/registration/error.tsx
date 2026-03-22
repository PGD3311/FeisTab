'use client'

import { ErrorBoundaryPage } from '@/components/error-boundary-page'

export default function RegistrationError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBoundaryPage title="Registration Desk Error" {...props} />
}
