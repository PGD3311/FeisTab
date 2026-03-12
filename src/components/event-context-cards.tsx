'use client'

import { type CompetitionStatus, ACTIVE_STATUSES, BLOCKED_STATUSES } from '@/lib/competition-states'

interface Competition {
  status: CompetitionStatus
}

interface EventContextCardsProps {
  competitions: Competition[]
}

export function EventContextCards({ competitions }: EventContextCardsProps) {
  const total = competitions.length
  const published = competitions.filter((c) => c.status === 'published').length
  const inProgress = competitions.filter((c) => ACTIVE_STATUSES.includes(c.status)).length
  const blocked = competitions.filter((c) => BLOCKED_STATUSES.includes(c.status)).length

  const cards = [
    { label: 'Competitions', value: total, orange: false },
    { label: 'Published', value: published, orange: false },
    { label: 'In Progress', value: inProgress, orange: false },
    { label: 'Blocked', value: blocked, orange: blocked > 0 },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="feis-context-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
            {card.label}
          </p>
          <p className={`feis-stat ${card.orange ? 'text-feis-orange' : ''}`}>{card.value}</p>
        </div>
      ))}
    </div>
  )
}
