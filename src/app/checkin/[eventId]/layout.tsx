'use client'

import { use } from 'react'
import { EventGate } from '@/components/event-gate'

export default function CheckinLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  return <EventGate eventId={eventId}>{children}</EventGate>
}
