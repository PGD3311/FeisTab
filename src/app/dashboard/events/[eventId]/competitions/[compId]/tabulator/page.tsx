'use client'

import { useEffect, useReducer, useRef, useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

import { useSupabase } from '@/hooks/use-supabase'
import { logAudit } from '@/lib/audit'
import { signOffJudge } from '@/lib/supabase/rpc'
import { canEnterScores, type EntryMode } from '@/lib/entry-mode'
import { type FlagReason } from '@/lib/engine/flag-reasons'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { getCurrentHeat, type HeatSnapshot } from '@/lib/engine/heats'
import {
  COMMENT_CODES,
  hasCommentContent,
  validateCommentData,
  type CommentData,
} from '@/lib/comment-codes'
import { showSuccess, showCritical } from '@/lib/feedback'
import {
  scoreReducer,
  buildInitialRows,
  isEditable,
  getEnteredCount,
  getActiveTotal,
  getFailedCount,
  getFirstEmptyEditableId,
  canSignOff,
  allSaved,
  type ScoreRow,
} from '@/lib/engine/tabulator-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { type RegistrationStatus } from '@/lib/engine/anomalies/types'
import { type JudgeInfo } from '@/types/shared'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface Registration {
  id: string
  dancer_id: string
  competitor_number: string
  status: RegistrationStatus | null
  dancers: { first_name: string; last_name: string } | null
}

interface Round {
  id: string
  round_number: number
  round_type: string
  judge_sign_offs: Record<string, string> | null
  heat_snapshot: HeatSnapshot | null
}

interface ScoreEntry {
  id: string
  dancer_id: string
  raw_score: number
  flagged: boolean
  flag_reason: string | null
  entry_mode: EntryMode
  comment_data: Record<string, unknown> | null
  comments: string | null
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function TabulatorEntryPage({
  params,
}: {
  params: Promise<{ eventId: string; compId: string }>
}) {
  const { eventId, compId } = use(params)
  const supabase = useSupabase()

  // --- Base state (unchanged from original) ---
  const [judges, setJudges] = useState<JudgeInfo[]>([])
  const [selectedJudgeId, setSelectedJudgeId] = useState<string>('')
  const [compCode, setCompCode] = useState('')
  const [compStatus, setCompStatus] = useState<CompetitionStatus>('draft')
  const [ruleConfig, setRuleConfig] = useState<{
    score_min: number
    score_max: number
  } | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [round, setRound] = useState<Round | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [packetBlocked, setPacketBlocked] = useState<string | null>(null)
  const [signedOff, setSignedOff] = useState(false)

  // --- Reducer-based score state ---
  const [rows, dispatch] = useReducer(scoreReducer, [])
  const saveSeqRef = useRef(0)
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const savedByKeydownRef = useRef<Set<string>>(new Set())

  // --- Flag/comment expand ---
  const [expandedDancerId, setExpandedDancerId] = useState<string | null>(null)

  // --- Submission guard ---
  const [isSubmitting, setIsSubmitting] = useState(false)
  const didAutoFocusRef = useRef(false)

  // --- Derived values ---
  const scoreMin = ruleConfig?.score_min ?? 0
  const scoreMax = ruleConfig?.score_max ?? 100
  const enteredCount = getEnteredCount(rows)
  const activeTotal = getActiveTotal(rows)
  const failedCount = getFailedCount(rows)
  const allAreSaved = allSaved(rows)
  const canDoSignOff = canSignOff(rows)
  const selectedJudge = judges.find(j => j.id === selectedJudgeId)

  // Heat info
  const heatSnapshot = round?.heat_snapshot ?? null
  const editableRows = rows.filter(isEditable)
  const savedDancerIds = new Set(
    rows.filter(r => r.status === 'saved').map(r => r.dancerId)
  )
  const currentHeat = heatSnapshot
    ? getCurrentHeat(heatSnapshot, savedDancerIds)
    : null
  const totalHeats = heatSnapshot?.heats.length ?? 0

  // Ordered list of editable dancer IDs for keyboard navigation
  const editableIds = editableRows.map(r => r.dancerId)

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async function loadBase() {
    const [compRes, judgesRes, regRes, roundRes] = await Promise.all([
      supabase
        .from('competitions')
        .select('*, rule_sets(*)')
        .eq('id', compId)
        .single(),
      supabase
        .from('judges')
        .select('id, first_name, last_name')
        .eq('event_id', eventId),
      supabase
        .from('registrations')
        .select(
          'id, dancer_id, competitor_number, status, dancers(first_name, last_name)'
        )
        .eq('competition_id', compId)
        .order('competitor_number'),
      supabase
        .from('rounds')
        .select('*')
        .eq('competition_id', compId)
        .order('round_number', { ascending: false })
        .limit(1)
        .single(),
    ])

    if (compRes.error) {
      setError(`Failed to load competition: ${compRes.error.message}`)
      setLoading(false)
      return
    }
    if (judgesRes.error) {
      setError(`Failed to load judges: ${judgesRes.error.message}`)
      setLoading(false)
      return
    }
    if (regRes.error) {
      setError(`Failed to load registrations: ${regRes.error.message}`)
      setLoading(false)
      return
    }
    if (roundRes.error) {
      if (roundRes.error.code !== 'PGRST116') {
        setError(`Failed to load round: ${roundRes.error.message}`)
        setLoading(false)
        return
      }
    }

    const status = (compRes.data?.status as CompetitionStatus) ?? 'draft'
    setCompCode(compRes.data?.code ?? '')
    setCompStatus(status)
    setRuleConfig(compRes.data?.rule_sets?.config ?? null)
    setJudges(judgesRes.data ?? [])
    setRegistrations((regRes.data as unknown as Registration[]) ?? [])
    setRound(roundRes.data as Round | null)
    setLoading(false)
  }

  async function loadJudgeScores(judgeId: string) {
    if (!round) return

    setPacketBlocked(null)
    setSignedOff(false)

    if (round.judge_sign_offs?.[judgeId]) {
      setSignedOff(true)
    }

    const { data: existingScores, error: scoresErr } = await supabase
      .from('score_entries')
      .select(
        'id, dancer_id, raw_score, flagged, flag_reason, entry_mode, comment_data, comments'
      )
      .eq('round_id', round.id)
      .eq('judge_id', judgeId)

    if (scoresErr) {
      setError(`Failed to load scores: ${scoresErr.message}`)
      return
    }

    const entries = (existingScores ?? []) as ScoreEntry[]

    const existingModes = entries.map(s => s.entry_mode)
    const check = canEnterScores(existingModes, 'tabulator_transcription')
    if (!check.allowed) {
      setPacketBlocked(check.reason ?? 'Packet locked to another entry mode.')
      dispatch({ type: 'LOAD_EXISTING', rows: [] })
      return
    }

    // Build initial rows from registrations + existing scores
    const regInputs = registrations.map(r => ({
      dancerId: r.dancer_id,
      dancerName: `${r.dancers?.first_name ?? ''} ${r.dancers?.last_name ?? ''}`,
      competitorNumber: r.competitor_number,
      registrationStatus: r.status ?? 'registered',
    }))

    const existingForReducer = entries.map(e => ({
      dancerId: e.dancer_id,
      rawScore: e.raw_score,
      flagged: e.flagged,
      flagReason: e.flag_reason as FlagReason | null,
      commentData: e.comment_data as CommentData | null,
    }))

    const initialRows = buildInitialRows(regInputs, existingForReducer)
    dispatch({ type: 'LOAD_EXISTING', rows: initialRows })
  }

  useEffect(() => {
    loadBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Clear rows synchronously BEFORE async load
    dispatch({ type: 'LOAD_EXISTING', rows: [] })
    setPacketBlocked(null)
    setSignedOff(false)
    setExpandedDancerId(null)
    setIsSubmitting(false)
    didAutoFocusRef.current = false

    if (selectedJudgeId && round) {
      loadJudgeScores(selectedJudgeId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJudgeId, round])

  // Auto-focus first empty editable after loading (fires once per judge load)
  useEffect(() => {
    if (rows.length === 0 || didAutoFocusRef.current) return
    didAutoFocusRef.current = true
    const firstEmpty = getFirstEmptyEditableId(rows)
    if (firstEmpty) {
      requestAnimationFrame(() => {
        inputRefs.current.get(firstEmpty)?.focus()
      })
    }
  }, [rows])

  // ---------------------------------------------------------------------------
  // saveRow
  // ---------------------------------------------------------------------------

  function saveRow(dancerId: string) {
    const row = rows.find(r => r.dancerId === dancerId)
    if (
      !row ||
      (row.status !== 'dirty' && row.status !== 'failed') ||
      !round ||
      !selectedJudgeId
    )
      return

    const num = parseFloat(row.score)
    if (isNaN(num) || num < scoreMin || num > scoreMax) return

    const seq = ++saveSeqRef.current
    dispatch({ type: 'MARK_SAVING', dancerId, saveSeq: seq })

    supabase
      .from('score_entries')
      .upsert(
        {
          round_id: round.id,
          competition_id: compId,
          dancer_id: dancerId,
          judge_id: selectedJudgeId,
          raw_score: num,
          flagged: row.flagged,
          flag_reason: row.flagged ? row.flagReason : null,
          entry_mode: 'tabulator_transcription' as EntryMode,
          comment_data: validateCommentData(row.commentData),
        },
        { onConflict: 'round_id,dancer_id,judge_id' }
      )
      .then(({ error: upsertErr }) => {
        if (upsertErr) {
          dispatch({ type: 'MARK_FAILED', dancerId, saveSeq: seq })
        } else {
          dispatch({
            type: 'MARK_SAVED',
            dancerId,
            dbScore: num,
            saveSeq: seq,
          })
        }
      })

    // Audit: fire-and-forget
    void logAudit(supabase, {
      userId: null,
      entityType: 'score_entry',
      entityId: compId,
      action: 'score_transcribe',
      afterData: {
        dancer_id: dancerId,
        judge_id: selectedJudgeId,
        raw_score: num,
        flagged: row.flagged,
        entry_mode: 'tabulator_transcription',
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Keyboard navigation helpers
  // ---------------------------------------------------------------------------

  function focusNext(currentDancerId: string) {
    const idx = editableIds.indexOf(currentDancerId)
    if (idx < 0) return
    const nextId = editableIds[idx + 1]
    if (nextId) {
      inputRefs.current.get(nextId)?.focus()
    }
  }

  function focusPrev(currentDancerId: string) {
    const idx = editableIds.indexOf(currentDancerId)
    if (idx <= 0) return
    const prevId = editableIds[idx - 1]
    if (prevId) {
      inputRefs.current.get(prevId)?.focus()
    }
  }

  function focusFirstEmpty() {
    const firstEmpty = getFirstEmptyEditableId(rows)
    if (firstEmpty) {
      inputRefs.current.get(firstEmpty)?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, dancerId: string) {
    if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter') {
      e.preventDefault()
      savedByKeydownRef.current.add(dancerId)
      saveRow(dancerId)
      focusNext(dancerId)
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      const row = rows.find(r => r.dancerId === dancerId)
      if (row && (row.status === 'dirty' || row.status === 'failed')) {
        savedByKeydownRef.current.add(dancerId)
        saveRow(dancerId)
      }
      focusPrev(dancerId)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      focusFirstEmpty()
    }
  }

  function handleBlur(dancerId: string) {
    if (savedByKeydownRef.current.has(dancerId)) {
      savedByKeydownRef.current.delete(dancerId)
      return
    }
    saveRow(dancerId)
  }

  // ---------------------------------------------------------------------------
  // Retry all failed
  // ---------------------------------------------------------------------------

  async function retryAllFailed() {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const failedRows = rows.filter(r => r.status === 'failed')
      for (const row of failedRows) {
        saveRow(row.dancerId)
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Sign off with server revalidation
  // ---------------------------------------------------------------------------

  async function handleSignOff() {
    if (!selectedJudgeId || !round || isSubmitting) return
    setIsSubmitting(true)

    try {
      // Re-fetch score entries for revalidation (include dancer_id for ID-level check)
      const { data: dbScores, error: revalidateErr } = await supabase
        .from('score_entries')
        .select('id, dancer_id')
        .eq('round_id', round.id)
        .eq('judge_id', selectedJudgeId)

      if (revalidateErr) {
        showCritical('Revalidation failed', {
          description: revalidateErr.message,
        })
        return
      }

      // Compare dancer IDs, not just count
      const dbDancerIds = new Set(
        (dbScores ?? []).map((s: { dancer_id: string }) => s.dancer_id)
      )
      const localEnteredIds = new Set(
        rows
          .filter(r => isEditable(r) && r.score !== '')
          .map(r => r.dancerId)
      )

      if (dbDancerIds.size !== localEnteredIds.size ||
          [...localEnteredIds].some(id => !dbDancerIds.has(id))) {
        showCritical('Sign-off blocked: data changed since you started entering scores.', {
          description: `Local: ${localEnteredIds.size} dancers, Server: ${dbDancerIds.size}. Refresh and verify.`,
        })
        return
      }

      // Re-fetch competition status
      const { data: freshComp, error: compErr } = await supabase
        .from('competitions')
        .select('status')
        .eq('id', compId)
        .single()

      if (compErr) {
        showCritical('Failed to verify competition status', {
          description: compErr.message,
        })
        return
      }

      const freshStatus = freshComp?.status as CompetitionStatus
      if (
        freshStatus !== 'awaiting_scores' &&
        freshStatus !== 'in_progress'
      ) {
        showCritical('Competition status changed', {
          description: `Status is now "${freshStatus}". Cannot sign off.`,
        })
        return
      }

      // Lock scores
      const { error: lockErr } = await supabase
        .from('score_entries')
        .update({ locked_at: new Date().toISOString() })
        .eq('round_id', round.id)
        .eq('judge_id', selectedJudgeId)

      if (lockErr)
        throw new Error(`Failed to lock scores: ${lockErr.message}`)

      // Atomically record sign-off
      const updatedSignOffs = await signOffJudge(supabase, round.id, selectedJudgeId, compId)

      // Auto-advance status if all judges done
      const allDone =
        judges.length > 0 && judges.every(j => updatedSignOffs[j.id])

      if (allDone) {
        // Use CompetitionStatus to allow full transition chain
        // (freshStatus is narrowed to 'awaiting_scores' | 'in_progress' by guard above,
        // but canTransition may advance it through intermediate states)
        let status = freshStatus as CompetitionStatus
        if (status === 'ready_to_tabulate') {
          // Already there
        } else {
          if (
            canTransition(status, 'awaiting_scores') &&
            !canTransition(status, 'ready_to_tabulate')
          ) {
            const { error: midErr } = await supabase
              .from('competitions')
              .update({ status: 'awaiting_scores' })
              .eq('id', compId)
            if (midErr)
              throw new Error(`Failed to update status: ${midErr.message}`)
            void logAudit(supabase, {
              userId: null,
              entityType: 'competition',
              entityId: compId,
              action: 'status_change',
              afterData: {
                from: status,
                to: 'awaiting_scores',
                trigger: 'auto_advance_on_sign_off',
              },
            })
            status = 'awaiting_scores' as CompetitionStatus
          }
          if (canTransition(status, 'ready_to_tabulate')) {
            const { error: statusErr } = await supabase
              .from('competitions')
              .update({ status: 'ready_to_tabulate' })
              .eq('id', compId)
            if (statusErr)
              throw new Error(`Failed to update status: ${statusErr.message}`)
            void logAudit(supabase, {
              userId: null,
              entityType: 'competition',
              entityId: compId,
              action: 'status_change',
              afterData: {
                from: status,
                to: 'ready_to_tabulate',
                trigger: 'auto_advance_on_sign_off',
              },
            })
          }
        }
      }

      void logAudit(supabase, {
        userId: null,
        entityType: 'round',
        entityId: round.id,
        action: 'sign_off',
        afterData: {
          judge_id: selectedJudgeId,
          competition_id: compId,
          entry_mode: 'tabulator_transcription',
          all_judges_done: allDone,
        },
      })

      setSignedOff(true)
      setRound({ ...round, judge_sign_offs: updatedSignOffs })
      const judge = judges.find(j => j.id === selectedJudgeId)
      showSuccess(`Scores signed off for ${judge?.first_name ?? 'judge'}`)
    } catch (err) {
      showCritical('Sign-off failed', {
        description:
          err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Inline row rendering
  // ---------------------------------------------------------------------------

  function renderRow(row: ScoreRow) {
    const editable = isEditable(row)
    const isExpanded = expandedDancerId === row.dancerId

    // Status indicator
    let statusIndicator: React.ReactNode = null
    if (row.status === 'saved') {
      statusIndicator = (
        <span className="text-feis-green font-bold text-sm" aria-label="Saved">
          &#10003;
        </span>
      )
    } else if (row.status === 'saving') {
      statusIndicator = (
        <span
          className="inline-block w-2 h-2 rounded-full bg-feis-green animate-pulse"
          aria-label="Saving"
        />
      )
    } else if (row.status === 'failed') {
      statusIndicator = (
        <span className="text-destructive font-bold text-xs" aria-label="Failed">
          !
        </span>
      )
    }

    const hasComments = hasCommentContent(row.commentData, null)

    return (
      <div key={row.dancerId} className="space-y-0">
        <div
          className={`flex items-center gap-2 sm:gap-3 p-2 rounded-md border transition-colors ${
            !editable
              ? 'opacity-40 bg-muted/30 border-border/30'
              : row.status === 'failed'
                ? 'border-destructive/60 bg-destructive/5'
                : row.flagged
                  ? 'border-feis-orange/60 bg-feis-orange/5'
                  : 'border-border/40 hover:bg-feis-green-light/30'
          }`}
        >
          {/* Competitor number */}
          <button
            type="button"
            onClick={() =>
              editable &&
              setExpandedDancerId(
                isExpanded ? null : row.dancerId
              )
            }
            className={`flex flex-col items-center justify-center min-w-[56px] select-none rounded-md px-1 py-0.5 ${
              editable
                ? 'cursor-pointer hover:bg-feis-green-light/30'
                : 'cursor-default'
            }`}
            tabIndex={-1}
            aria-label={`Toggle details for competitor ${row.competitorNumber}`}
          >
            <span
              className={`feis-number font-mono text-2xl font-bold tabular-nums ${
                editable ? 'text-feis-green' : 'text-muted-foreground line-through'
              }`}
            >
              {row.competitorNumber}
            </span>
            {editable && (
              <span className="text-[10px] text-muted-foreground leading-tight">
                {isExpanded
                  ? 'close'
                  : hasComments || row.flagged
                    ? '\u2713 notes'
                    : 'notes'}
              </span>
            )}
          </button>

          {/* Name */}
          <span
            className={`text-sm flex-1 min-w-0 truncate ${
              !editable ? 'line-through text-muted-foreground' : ''
            }`}
          >
            {row.dancerName}
          </span>

          {/* Score input or non-editable indicator */}
          {editable ? (
            <Input
              ref={el => {
                if (el) {
                  inputRefs.current.set(row.dancerId, el)
                } else {
                  inputRefs.current.delete(row.dancerId)
                }
              }}
              type="number"
              min={scoreMin}
              max={scoreMax}
              step="0.1"
              value={row.score}
              onChange={e =>
                dispatch({
                  type: 'SET_SCORE',
                  dancerId: row.dancerId,
                  score: e.target.value,
                })
              }
              onKeyDown={e => handleKeyDown(e, row.dancerId)}
              onBlur={() => handleBlur(row.dancerId)}
              disabled={signedOff}
              className={`w-24 text-center font-mono text-lg h-11 ${
                row.status === 'failed'
                  ? 'border-destructive'
                  : row.score !== '' &&
                      (isNaN(parseFloat(row.score)) ||
                        parseFloat(row.score) < scoreMin ||
                        parseFloat(row.score) > scoreMax)
                    ? 'border-destructive'
                    : ''
              }`}
            />
          ) : (
            <span className="w-24 text-center font-mono text-lg text-muted-foreground">
              &mdash;
            </span>
          )}

          {/* Status indicator */}
          <span className="w-5 flex items-center justify-center">
            {statusIndicator}
          </span>
        </div>

        {/* Expanded flag/comment panel */}
        {isExpanded && editable && (
          <div className="ml-[60px] mr-2 mb-1 p-3 border border-t-0 border-border/40 rounded-b-md bg-muted/10 space-y-2">
            {/* Flag */}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={row.flagged}
                onChange={e =>
                  dispatch({
                    type: 'SET_FLAG',
                    dancerId: row.dancerId,
                    flagged: e.target.checked,
                    flagReason: e.target.checked
                      ? row.flagReason
                      : null,
                  })
                }
                disabled={signedOff}
                className="accent-feis-orange w-5 h-5"
                tabIndex={-1}
              />
              <span className="text-xs text-muted-foreground">Flag</span>
            </label>
            {row.flagged && (
              <select
                value={row.flagReason ?? ''}
                onChange={e =>
                  dispatch({
                    type: 'SET_FLAG',
                    dancerId: row.dancerId,
                    flagged: true,
                    flagReason: (e.target.value as FlagReason) || null,
                  })
                }
                disabled={signedOff}
                className="text-xs border rounded px-2 py-2 w-full"
                tabIndex={-1}
              >
                <option value="">Reason...</option>
                <option value="early_start">Early Start</option>
                <option value="did_not_complete">Did Not Complete</option>
                <option value="other">Other</option>
              </select>
            )}

            {/* Comment codes */}
            <div className="flex flex-wrap gap-1.5">
              {COMMENT_CODES.map(cc => {
                const isSelected =
                  row.commentData?.codes.includes(cc.code) ?? false
                return (
                  <button
                    key={cc.code}
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      const currentCodes =
                        row.commentData?.codes ?? []
                      const newCodes = isSelected
                        ? currentCodes.filter(c => c !== cc.code)
                        : [...currentCodes, cc.code]
                      dispatch({
                        type: 'SET_COMMENT',
                        dancerId: row.dancerId,
                        commentData: {
                          codes: newCodes,
                          note: row.commentData?.note ?? null,
                        },
                      })
                    }}
                    disabled={signedOff}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      isSelected
                        ? 'bg-feis-green-light text-feis-green border-feis-green/40 font-medium'
                        : 'bg-feis-cream-dark text-muted-foreground border hover:border-feis-charcoal/30'
                    } ${signedOff ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {isSelected && '\u2713 '}
                    {cc.label}
                  </button>
                )
              })}
            </div>

            {/* Note textarea */}
            <textarea
              value={row.commentData?.note ?? ''}
              onChange={e => {
                dispatch({
                  type: 'SET_COMMENT',
                  dancerId: row.dancerId,
                  commentData: {
                    codes: row.commentData?.codes ?? [],
                    note: e.target.value || null,
                  },
                })
              }}
              placeholder="Optional note..."
              disabled={signedOff}
              rows={2}
              tabIndex={-1}
              className="w-full text-xs border rounded-md px-2 py-1.5 resize-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Heat grouping
  // ---------------------------------------------------------------------------

  function renderHeatGrouped() {
    if (!heatSnapshot) return null

    return (
      <div className="space-y-4">
        {heatSnapshot.heats.map(heat => {
          const heatDancerIds = new Set(
            heat.slots.map(s => s.dancer_id)
          )
          const heatRows = rows.filter(r =>
            heatDancerIds.has(r.dancerId)
          )
          const isCurrentHeat =
            heat.heat_number === currentHeat?.heat_number
          const heatActiveRows = heatRows.filter(isEditable)
          const heatScoredCount = heatActiveRows.filter(
            r => r.status === 'saved'
          ).length
          const isHeatComplete =
            heatScoredCount === heatActiveRows.length &&
            heatActiveRows.length > 0
          const hasFailed = heatRows.some(r => r.status === 'failed')

          // Collapse rule: only collapse if every active row is saved or empty, and no failed
          const canCollapse =
            isHeatComplete &&
            !isCurrentHeat &&
            !hasFailed

          return (
            <div
              key={heat.heat_number}
              className={`rounded-lg border-2 ${
                isCurrentHeat
                  ? 'border-feis-green bg-feis-green-light/30'
                  : isHeatComplete
                    ? 'border-border/50 bg-muted/30 opacity-60'
                    : 'border-border/30'
              }`}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                <div className="flex items-center gap-2">
                  {isCurrentHeat && (
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-feis-green animate-pulse" />
                  )}
                  <span
                    className={`text-base font-semibold ${
                      isCurrentHeat
                        ? 'text-feis-green'
                        : 'text-muted-foreground'
                    }`}
                  >
                    Heat {heat.heat_number} of {totalHeats}
                  </span>
                </div>
                <Badge
                  variant={
                    isHeatComplete
                      ? 'secondary'
                      : isCurrentHeat
                        ? 'default'
                        : 'outline'
                  }
                >
                  {isHeatComplete
                    ? 'Complete'
                    : `${heatScoredCount}/${heatActiveRows.length}`}
                </Badge>
              </div>
              {!canCollapse && (
                <div className="p-2 space-y-1">
                  {heatRows.map(row => renderRow(row))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  function renderFlatList() {
    return (
      <div className="space-y-1">{rows.map(row => renderRow(row))}</div>
    )
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  const canScore =
    compStatus === 'awaiting_scores' || compStatus === 'in_progress'

  if (!canScore) {
    return (
      <div className="space-y-6">
        <Link
          href={`/dashboard/events/${eventId}/competitions/${compId}`}
          className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Competition
        </Link>
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              Score entry is not available. Competition status: {compStatus}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!round) {
    return (
      <div className="space-y-6">
        <Link
          href={`/dashboard/events/${eventId}/competitions/${compId}`}
          className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Competition
        </Link>
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              No round available for scoring yet.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 pb-28">
      <Link
        href={`/dashboard/events/${eventId}/competitions/${compId}`}
        className="text-sm text-muted-foreground hover:text-feis-charcoal inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" /> Back to Competition
      </Link>

      <div>
        <h1 className="text-3xl font-bold">
          {compCode && `${compCode} `}Tabulator Entry
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter scores from paper score sheets on behalf of a judge
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline text-destructive"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Judge selection — unchanged */}
      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Select Judge</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={selectedJudgeId}
            onChange={e => {
              dispatch({ type: 'LOAD_EXISTING', rows: [] })
              setSelectedJudgeId(e.target.value)
            }}
            className="w-full max-w-md border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Choose a judge...</option>
            {judges.map(j => {
              const judgeSignedOff = round?.judge_sign_offs?.[j.id]
              return (
                <option key={j.id} value={j.id}>
                  {j.first_name} {j.last_name}
                  {judgeSignedOff ? ' (signed off)' : ''}
                </option>
              )
            })}
          </select>
          {selectedJudge && (
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="outline">
                Entering for: {selectedJudge.first_name}{' '}
                {selectedJudge.last_name}
              </Badge>
              <Badge variant="outline">
                Round {round?.round_number ?? '\u2014'}
              </Badge>
              <Badge variant="outline">
                {enteredCount}/{activeTotal} scored
              </Badge>
              {heatSnapshot && totalHeats > 0 && (
                <Badge variant="outline">
                  Heat{' '}
                  {currentHeat
                    ? currentHeat.heat_number
                    : totalHeats}{' '}
                  of {totalHeats}
                </Badge>
              )}
              <Badge variant="secondary">Tabulator Mode</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Packet blocked */}
      {packetBlocked && selectedJudgeId && (
        <Card className="border-destructive/20 bg-destructive/10">
          <CardContent className="py-6 text-center">
            <p className="text-sm font-medium text-destructive">
              {packetBlocked}
            </p>
            <p className="text-xs text-destructive/80 mt-1">
              This judge has already started entering scores via their own
              device. One entry path per judge per round.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Signed off */}
      {signedOff && selectedJudgeId && !packetBlocked && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-feis-green">
              Scores signed off for {selectedJudge?.first_name}{' '}
              {selectedJudge?.last_name}.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Select another judge to continue, or go back to the
              competition.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Score entry area */}
      {selectedJudgeId && !packetBlocked && !signedOff && (
        <>{heatSnapshot ? renderHeatGrouped() : renderFlatList()}</>
      )}

      {/* No judge selected */}
      {!selectedJudgeId && (
        <Card className="feis-card">
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>
              Select a judge above to begin entering scores from their paper
              sheet.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Sticky bottom bar */}
      {selectedJudgeId && !packetBlocked && !signedOff && rows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-feis-green bg-card p-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 flex-wrap">
            {/* Left: judge info */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {selectedJudge?.first_name} {selectedJudge?.last_name}
              </span>
              <Badge variant="secondary" className="text-xs">
                Tabulator Mode
              </Badge>
            </div>

            {/* Center: progress + save state */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {enteredCount}/{activeTotal} entered
              </span>
              {failedCount > 0 ? (
                <span className="flex items-center gap-2">
                  <span className="text-sm text-destructive font-medium">
                    {failedCount} unsaved
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={retryAllFailed}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Retrying...' : 'Retry All'}
                  </Button>
                </span>
              ) : allAreSaved && enteredCount > 0 ? (
                <span className="text-sm text-feis-green font-medium">
                  All saved &#10003;
                </span>
              ) : rows.some(r => r.status === 'saving') ? (
                <span className="text-sm text-muted-foreground">
                  Saving...
                </span>
              ) : null}
            </div>

            {/* Right: sign off */}
            <Button
              onClick={handleSignOff}
              disabled={!canDoSignOff || isSubmitting}
              size="lg"
              className="font-semibold"
            >
              {isSubmitting ? 'Signing off...' : 'Sign Off'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
