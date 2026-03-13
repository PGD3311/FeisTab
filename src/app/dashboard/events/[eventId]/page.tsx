'use client'

import Link from 'next/link'
import { useEvent } from '@/contexts/event-context'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
import { ACTIVE_STATUSES } from '@/lib/competition-states'
import { type CompetitionStatus } from '@/lib/competition-states'

export default function EventOverviewPage() {
  const { event, competitions } = useEvent()

  if (!event) return null

  const eventId = event.id

  const totalDancers = competitions.reduce(
    (sum, c) => sum + (c.registrations?.[0]?.count ?? 0),
    0
  )

  const statusGroups = {
    published: competitions.filter(c => c.status === 'published' || c.status === 'locked'),
    active: competitions.filter(c => ACTIVE_STATUSES.includes(c.status)),
    notStarted: competitions.filter(
      c => c.status === 'draft' || c.status === 'imported' || c.status === 'ready_for_day_of'
    ),
  }

  const needsAttention = competitions.filter(c =>
    c.status === 'awaiting_scores' ||
    c.status === 'ready_to_tabulate' ||
    c.status === 'recalled_round_pending' ||
    c.status === 'complete_unpublished'
  )

  // Weighted progress — reflects workflow completion, not just publication
  const STATUS_WEIGHT: Record<CompetitionStatus, number> = {
    draft: 0,
    imported: 10,
    ready_for_day_of: 15,
    released_to_judge: 20,
    in_progress: 30,
    awaiting_scores: 40,
    ready_to_tabulate: 60,
    recalled_round_pending: 55,
    complete_unpublished: 80,
    published: 100,
    locked: 100,
  }

  const progressPct = competitions.length > 0
    ? Math.round(
        competitions.reduce((sum, c) => sum + (STATUS_WEIGHT[c.status] ?? 0), 0) /
        (competitions.length * 100) * 100
      )
    : 0

  // Group competitions by status phase for the pipeline
  const pipeline: { label: string; statuses: CompetitionStatus[]; color: string; count: number }[] = [
    { label: 'Setup', statuses: ['draft', 'imported', 'ready_for_day_of'], color: 'bg-feis-cream-dark', count: statusGroups.notStarted.length },
    { label: 'Scoring', statuses: ['in_progress', 'awaiting_scores'], color: 'bg-feis-orange-light', count: competitions.filter(c => c.status === 'in_progress' || c.status === 'awaiting_scores').length },
    { label: 'Tabulation', statuses: ['ready_to_tabulate', 'recalled_round_pending', 'complete_unpublished'], color: 'bg-amber-50', count: competitions.filter(c => c.status === 'ready_to_tabulate' || c.status === 'recalled_round_pending' || c.status === 'complete_unpublished').length },
    { label: 'Done', statuses: ['published', 'locked'], color: 'bg-feis-green', count: statusGroups.published.length },
  ]

  return (
    <div className="space-y-5">
      {/* Progress + Stats Hero */}
      <div className="feis-card rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-1">
              Event Progress
            </p>
            <p className="text-3xl font-bold text-feis-green leading-none tabular-nums">
              {progressPct}%
              <span className="text-base font-normal text-muted-foreground ml-2">
                complete
              </span>
            </p>
          </div>
          <div className="flex gap-6">
            <div className="text-right">
              <p className="feis-stat text-2xl">{competitions.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">competitions</p>
            </div>
            <div className="text-right">
              <p className="feis-stat text-2xl">{totalDancers}</p>
              <p className="text-xs text-muted-foreground mt-0.5">dancers</p>
            </div>
            <div className="text-right">
              <p className="feis-stat text-2xl">{statusGroups.published.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">published</p>
            </div>
          </div>
        </div>

        {/* Pipeline bar */}
        <div className="w-full h-3 rounded-full bg-feis-cream-dark flex overflow-hidden">
          {pipeline.map(phase => {
            const pct = competitions.length > 0
              ? (phase.count / competitions.length) * 100
              : 0
            if (pct === 0) return null
            return (
              <div
                key={phase.label}
                className={`${phase.color} ${phase.label === 'Done' ? 'text-white' : ''} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            )
          })}
        </div>
        <div className="flex justify-between mt-2">
          {pipeline.map(phase => (
            <div key={phase.label} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${phase.color} ${phase.label === 'Done' ? '' : 'border border-black/10'}`} />
              <span className="text-xs text-muted-foreground">
                {phase.label} ({phase.count})
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Links — share with side-stage person or open in another tab */}
      <div className="flex gap-3">
        <Link
          href={`/checkin/${eventId}`}
          target="_blank"
          className="feis-card flex-1 flex items-center justify-between p-3.5 rounded-lg hover:border-feis-green/40 transition-all group"
        >
          <div>
            <p className="font-medium text-sm group-hover:text-feis-green transition-colors">Side-Stage</p>
            <p className="text-xs text-muted-foreground">Roster confirm + send to judge</p>
          </div>
          <span className="text-xs text-muted-foreground">↗</span>
        </Link>
        <Link
          href={`/registration/${eventId}`}
          target="_blank"
          className="feis-card flex-1 flex items-center justify-between p-3.5 rounded-lg hover:border-feis-green/40 transition-all group"
        >
          <div>
            <p className="font-medium text-sm group-hover:text-feis-green transition-colors">Registration Desk</p>
            <p className="text-xs text-muted-foreground">Check-in + number assignment</p>
          </div>
          <span className="text-xs text-muted-foreground">↗</span>
        </Link>
      </div>

      {/* Needs Attention */}
      {needsAttention.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-feis-orange animate-pulse" />
            <h2 className="text-base font-semibold">Needs Attention</h2>
            <span className="text-xs text-muted-foreground">
              {needsAttention.length} competition{needsAttention.length !== 1 ? 's' : ''} waiting on you
            </span>
          </div>
          <div className="space-y-2">
            {needsAttention.map(comp => (
              <Link
                key={comp.id}
                href={`/dashboard/events/${eventId}/competitions/${comp.id}`}
                className="feis-card feis-accent-orange flex items-center justify-between p-3.5 rounded-lg hover:border-feis-orange/40 transition-all group"
              >
                <div className="min-w-0">
                  <span className="font-medium text-sm group-hover:text-feis-green transition-colors">
                    {comp.code && <span className="font-mono text-feis-green/50 mr-1.5">{comp.code}</span>}
                    {comp.name}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">
                    {comp.age_group} · {comp.level}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {comp.registrations?.[0]?.count ?? 0} dancers
                  </span>
                  <CompetitionStatusBadge status={comp.status} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* All Competitions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">All Competitions</h2>
          <Link
            href={`/dashboard/events/${eventId}/competitions`}
            className="text-xs text-feis-green hover:underline font-medium"
          >
            Full table view →
          </Link>
        </div>
        {competitions.length === 0 ? (
          <div className="feis-card rounded-lg p-8 text-center">
            <p className="text-muted-foreground text-sm">
              No competitions yet. Head to <Link href={`/dashboard/events/${eventId}/import`} className="text-feis-green hover:underline font-medium">Import</Link> to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {competitions.map(comp => (
              <Link
                key={comp.id}
                href={`/dashboard/events/${eventId}/competitions/${comp.id}`}
                className="feis-card flex items-center justify-between p-3 rounded-lg transition-all group"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-sm group-hover:text-feis-green transition-colors">
                    {comp.code && <span className="font-mono text-feis-green/50 mr-1.5">{comp.code}</span>}
                    {comp.name}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">
                    {comp.age_group} · {comp.level}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:inline tabular-nums">
                    {comp.registrations?.[0]?.count ?? 0}
                  </span>
                  <CompetitionStatusBadge status={comp.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
