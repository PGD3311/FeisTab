import { type CompetitionStatus } from '@/lib/competition-states'

const statusColors: Record<CompetitionStatus, string> = {
  draft: 'bg-feis-cream-dark text-feis-charcoal/60',
  imported: 'bg-feis-green-light text-feis-green',
  ready_for_day_of: 'bg-feis-green-light text-feis-green-600',
  released_to_judge: 'bg-feis-orange-light text-feis-orange',
  in_progress: 'bg-feis-orange-light text-feis-orange',
  awaiting_scores: 'bg-feis-orange-light text-feis-orange',
  ready_to_tabulate: 'bg-amber-50 text-amber-700',
  recalled_round_pending: 'bg-feis-orange-light text-feis-orange',
  complete_unpublished: 'bg-feis-green-light text-feis-green',
  published: 'bg-feis-green text-white',
  locked: 'bg-feis-cream-dark text-feis-charcoal/50',
}

const statusLabels: Record<CompetitionStatus, string> = {
  draft: 'Draft',
  imported: 'Imported',
  ready_for_day_of: 'Ready',
  released_to_judge: 'With Judge',
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium tracking-wide uppercase ${statusColors[status]}`}>
      {statusLabels[status]}
    </span>
  )
}
