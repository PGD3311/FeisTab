import { type CompetitionStatus } from '@/lib/competition-states'

const statusColors: Record<CompetitionStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  imported: 'bg-blue-100 text-blue-700',
  ready_for_day_of: 'bg-indigo-100 text-indigo-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  awaiting_scores: 'bg-orange-100 text-orange-700',
  ready_to_tabulate: 'bg-purple-100 text-purple-700',
  recalled_round_pending: 'bg-pink-100 text-pink-700',
  complete_unpublished: 'bg-emerald-100 text-emerald-700',
  published: 'bg-green-100 text-green-700',
  locked: 'bg-gray-200 text-gray-600',
}

const statusLabels: Record<CompetitionStatus, string> = {
  draft: 'Draft',
  imported: 'Imported',
  ready_for_day_of: 'Ready',
  in_progress: 'In Progress',
  awaiting_scores: 'Awaiting Scores',
  ready_to_tabulate: 'Ready to Tab',
  recalled_round_pending: 'Recall Pending',
  complete_unpublished: 'Complete',
  published: 'Published',
  locked: 'Locked',
}

export function CompetitionStatusBadge({ status }: { status: CompetitionStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColors[status]}`}>
      {statusLabels[status]}
    </span>
  )
}
