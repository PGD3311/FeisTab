'use client'

import { Button } from '@/components/ui/button'

const statuses = ['registered', 'checked_in', 'present', 'scratched', 'no_show', 'danced'] as const
type DancerStatus = typeof statuses[number]

const statusColors: Record<DancerStatus, string> = {
  registered: 'bg-gray-100',
  checked_in: 'bg-blue-100',
  present: 'bg-green-100',
  scratched: 'bg-red-100',
  no_show: 'bg-orange-100',
  danced: 'bg-emerald-200',
}

interface DancerStatusToggleProps {
  competitorNumber: string
  dancerName: string
  currentStatus: DancerStatus
  onStatusChange: (newStatus: DancerStatus) => void
}

export function DancerStatusToggle({
  competitorNumber,
  dancerName,
  currentStatus,
  onStatusChange,
}: DancerStatusToggleProps) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-md border ${statusColors[currentStatus]}`}>
      <span className="font-mono text-lg font-bold w-14 text-center">{competitorNumber}</span>
      <span className="flex-1 text-sm font-medium">{dancerName}</span>
      <div className="flex gap-1">
        {(['present', 'scratched', 'no_show', 'danced'] as DancerStatus[]).map(s => (
          <Button
            key={s}
            size="sm"
            variant={currentStatus === s ? 'default' : 'outline'}
            onClick={() => onStatusChange(s)}
            className="text-xs"
          >
            {s.replace('_', ' ')}
          </Button>
        ))}
      </div>
    </div>
  )
}
