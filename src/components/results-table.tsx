'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

interface JudgeScoreData {
  judge_id: string
  judge_name: string
  raw_score: number
  rank: number
  irish_points: number
  flagged?: boolean
  flag_reason?: string
}

interface CalculatedPayloadData {
  total_points?: number
  individual_ranks?: { judge_id: string; rank: number; irish_points: number }[]
  judge_scores?: JudgeScoreData[]
  rules_snapshot?: {
    score_min: number
    score_max: number
    scoring_method: string
    tie_breaker: string
    recall_top_percent: number
    drop_high: boolean
    drop_low: boolean
  }
  tie_break_applied?: boolean
  tie_break_note?: string | null
  drop_applied?: boolean
  drop_note?: string | null
}

interface ResultRow {
  final_rank: number
  dancer_id?: string
  dancers: { first_name: string; last_name: string } | null
  calculated_payload: CalculatedPayloadData | null
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function formatRulesFooter(
  rules: CalculatedPayloadData['rules_snapshot'],
): string | null {
  if (!rules) return null
  return `Irish Points scoring (1st=100, 2nd=75, 3rd=65...) · Score range: ${rules.score_min}–${rules.score_max}`
}

function isExpandable(payload: CalculatedPayloadData | null): boolean {
  if (!payload) return false
  return (
    (payload.judge_scores !== undefined && payload.judge_scores.length > 0) ||
    (payload.individual_ranks !== undefined && payload.individual_ranks.length > 0)
  )
}

function BreakdownPanel({ row, eventId }: { row: ResultRow; eventId?: string }) {
  const payload = row.calculated_payload
  if (!payload) return null

  const hasJudgeScores = payload.judge_scores && payload.judge_scores.length > 0
  const hasIndividualRanks =
    payload.individual_ranks && payload.individual_ranks.length > 0
  const showTieBreak =
    payload.tie_break_applied === true ||
    (typeof payload.tie_break_note === 'string' &&
      payload.tie_break_note.includes('Tied'))
  const rulesFooter = formatRulesFooter(payload.rules_snapshot)

  return (
    <tr>
      <td colSpan={3} className="p-0">
        <div className="bg-feis-green-light/30 px-4 py-3">
          <div className="bg-white border rounded-md p-4">
            {/* Top summary */}
            <p className="text-base font-semibold text-feis-charcoal">
              Total Irish Points: {payload.total_points ?? '—'} &middot; Final
              Place: {ordinal(row.final_rank)}
            </p>

            {/* Tie-break banner */}
            {showTieBreak && (
              <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-md p-2 mt-2">
                Tie-break applied
                {payload.tie_break_note ? ` — ${payload.tie_break_note}` : ''}
              </div>
            )}

            {/* Per-judge table — full breakdown */}
            {hasJudgeScores && payload.judge_scores && (
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium pb-1">Judge</th>
                    <th className="text-right font-mono font-medium pb-1">Raw Score</th>
                    <th className="text-right font-mono font-medium pb-1">Rank</th>
                    <th className="text-right font-mono font-medium pb-1">Irish Points</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.judge_scores.map((js) => (
                    <Fragment key={js.judge_id}>
                      <tr>
                        <td className="py-0.5">
                          {js.flagged && (
                            <span className="text-orange-500 mr-1">⚠</span>
                          )}
                          {js.judge_name}
                        </td>
                        <td
                          className={`text-right font-mono py-0.5 ${js.flagged ? 'line-through text-muted-foreground' : ''}`}
                        >
                          {js.raw_score}
                        </td>
                        <td
                          className={`text-right font-mono py-0.5 ${js.flagged ? 'line-through text-muted-foreground' : ''}`}
                        >
                          {ordinal(js.rank)}
                        </td>
                        <td
                          className={`text-right font-mono py-0.5 ${js.flagged ? 'line-through text-muted-foreground' : ''}`}
                        >
                          {js.irish_points}
                        </td>
                      </tr>
                      {js.flagged && js.flag_reason && (
                        <tr>
                          <td
                            colSpan={4}
                            className="text-xs text-muted-foreground pb-1 pl-4"
                          >
                            {js.flag_reason}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan={3} className="pt-1 font-medium">
                      Total
                    </td>
                    <td className="text-right font-mono pt-1 font-medium">
                      {payload.total_points ?? '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            {/* Per-judge table — partial breakdown (no judge_scores, only individual_ranks) */}
            {!hasJudgeScores && hasIndividualRanks && payload.individual_ranks && (
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium pb-1">Judge</th>
                    <th className="text-right font-mono font-medium pb-1">Rank</th>
                    <th className="text-right font-mono font-medium pb-1">Irish Points</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.individual_ranks.map((ir) => (
                    <tr key={ir.judge_id}>
                      <td className="py-0.5">{ir.judge_id}</td>
                      <td className="text-right font-mono py-0.5">{ordinal(ir.rank)}</td>
                      <td className="text-right font-mono py-0.5">{ir.irish_points}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan={2} className="pt-1 font-medium">
                      Total
                    </td>
                    <td className="text-right font-mono pt-1 font-medium">
                      {payload.total_points ?? '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            {/* Feedback sheet link (organizer view only) */}
            {eventId && row.dancer_id && (
              <div className="mt-3 pt-2 border-t">
                <Link
                  href={`/dashboard/events/${eventId}/comments/${row.dancer_id}`}
                  className="text-xs text-feis-green hover:underline font-medium"
                >
                  View comment sheet &rarr;
                </Link>
              </div>
            )}

            {/* Rules footer */}
            {rulesFooter && (
              <p className="text-xs text-muted-foreground mt-3 pt-2 border-t">
                {rulesFooter}
              </p>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

export function ResultsTable({ results, eventId, publicMode }: { results: ResultRow[]; eventId?: string; publicMode?: boolean }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  function handleRowClick(i: number, payload: CalculatedPayloadData | null) {
    if (publicMode) return // No expansion on public results
    if (!isExpandable(payload)) return
    setExpandedIndex(expandedIndex === i ? null : i)
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="feis-thead">
          <tr>
            <th className="px-4 py-2 text-left w-16">Place</th>
            <th className="px-4 py-2 text-left">Dancer</th>
            <th className="px-4 py-2 text-right">Points</th>
          </tr>
        </thead>
        <tbody className="feis-tbody">
          {results.map((r, i) => {
            const expandable = !publicMode && isExpandable(r.calculated_payload)
            const expanded = expandedIndex === i
            return (
              <Fragment key={i}>
                <tr
                  className={`border-t${expandable ? ' cursor-pointer hover:bg-feis-green-light/20' : ''}`}
                  onClick={() => handleRowClick(i, r.calculated_payload)}
                >
                  <td
                    className={`px-4 py-2 font-bold font-mono ${
                      r.final_rank === 1
                        ? 'feis-place-1'
                        : r.final_rank === 2
                          ? 'feis-place-2'
                          : r.final_rank === 3
                            ? 'feis-place-3'
                            : ''
                    }`}
                  >
                    {r.final_rank}
                  </td>
                  <td className="px-4 py-2">
                    {r.dancers?.first_name} {r.dancers?.last_name}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex items-center gap-1 justify-end font-mono">
                      {r.calculated_payload?.total_points ?? '—'}
                      {expandable && (
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
                        />
                      )}
                    </span>
                  </td>
                </tr>
                {expanded && <BreakdownPanel row={r} eventId={eventId} />}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
