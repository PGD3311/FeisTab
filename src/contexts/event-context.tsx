'use client'

import { createContext, useContext } from 'react'
import { type CompetitionStatus } from '@/lib/competition-states'

interface EventData {
  id: string
  name: string
  start_date: string
  end_date: string | null
  location: string | null
  status: string
  registration_code: string | null
}

interface CompetitionData {
  id: string
  code: string | null
  name: string
  age_group: string
  level: string
  status: CompetitionStatus
  event_id: string
  registrations: [{ count: number }] | null
}

export type { EventData, CompetitionData }

interface EventContextValue {
  event: EventData | null
  competitions: CompetitionData[]
  loading: boolean
  reload: () => void
}

const EventContext = createContext<EventContextValue>({
  event: null,
  competitions: [],
  loading: true,
  reload: () => {},
})

export function EventProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: EventContextValue
}) {
  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
}

export function useEvent(): EventContextValue {
  return useContext(EventContext)
}
