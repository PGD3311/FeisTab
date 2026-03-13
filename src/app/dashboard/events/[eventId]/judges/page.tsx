'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { showSuccess, showError } from '@/lib/feedback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Judge {
  id: string
  first_name: string
  last_name: string
  access_code: string | null
}

interface Competition {
  id: string
  code: string | null
  name: string
  age_group: string | null
  level: string | null
}

interface AssignmentCounts {
  [judgeId: string]: number
}

interface JudgeAssignment {
  id: string
  competition_id: string
  competition: Competition
}

function generateAccessCode(lastName: string): string {
  const pin = Math.floor(1000 + Math.random() * 9000).toString()
  const name = lastName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8)
  return `${name}-${pin}`
}

function parseCodeAsNumber(code: string | null): number | null {
  if (!code) return null
  const n = parseInt(code, 10)
  return isNaN(n) ? null : n
}

export default function JudgeManagementPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const [judges, setJudges] = useState<Judge[]>([])
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Assignment state
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [assignmentCounts, setAssignmentCounts] = useState<AssignmentCounts>({})
  const [expandedJudgeId, setExpandedJudgeId] = useState<string | null>(null)
  const [judgeAssignments, setJudgeAssignments] = useState<JudgeAssignment[]>([])
  const [loadingAssignments, setLoadingAssignments] = useState(false)
  const [assigningBatch, setAssigningBatch] = useState(false)

  // Batch assign controls
  const [codeStart, setCodeStart] = useState('')
  const [codeEnd, setCodeEnd] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [filterAgeGroup, setFilterAgeGroup] = useState('')

  const loadJudges = useCallback(async () => {
    const { data, error } = await supabase
      .from('judges')
      .select('id, first_name, last_name, access_code')
      .eq('event_id', eventId)
      .order('created_at')
    if (error) {
      console.error('Failed to load judges:', error.message)
      setLoadError(true)
      setLoading(false)
      return
    }
    setLoadError(false)
    setJudges((data as Judge[]) ?? [])
    setLoading(false)
  }, [supabase, eventId])

  const loadCompetitions = useCallback(async () => {
    const { data, error } = await supabase
      .from('competitions')
      .select('id, code, name, age_group, level')
      .eq('event_id', eventId)
      .order('code')
    if (error) {
      console.error('Failed to load competitions:', error.message)
      return
    }
    setCompetitions((data as Competition[]) ?? [])
  }, [supabase, eventId])

  const loadAssignmentCounts = useCallback(async () => {
    // Get all assignments for this event's judges, then count per judge
    const { data: judgeIds, error: judgeError } = await supabase
      .from('judges')
      .select('id')
      .eq('event_id', eventId)
    if (judgeError) {
      console.error('Failed to load judge IDs for counts:', judgeError.message)
      return
    }
    if (!judgeIds || judgeIds.length === 0) {
      setAssignmentCounts({})
      return
    }

    const ids = (judgeIds as Array<{ id: string }>).map((j) => j.id)
    const { data, error } = await supabase
      .from('judge_assignments')
      .select('judge_id')
      .in('judge_id', ids)
    if (error) {
      console.error('Failed to load assignment counts:', error.message)
      return
    }

    const counts: AssignmentCounts = {}
    for (const row of (data as Array<{ judge_id: string }>) ?? []) {
      counts[row.judge_id] = (counts[row.judge_id] ?? 0) + 1
    }
    setAssignmentCounts(counts)
  }, [supabase, eventId])

  useEffect(() => {
    void loadJudges()
    void loadCompetitions()
    void loadAssignmentCounts()
  }, [loadJudges, loadCompetitions, loadAssignmentCounts])

  async function loadJudgeAssignments(judgeId: string) {
    setLoadingAssignments(true)
    const { data, error } = await supabase
      .from('judge_assignments')
      .select('id, competition_id, competitions(id, code, name, age_group, level)')
      .eq('judge_id', judgeId)
    if (error) {
      showError('Failed to load assignments', { description: error.message })
      setLoadingAssignments(false)
      return
    }

    // Supabase returns joined relations; cast through unknown for safety
    const rawRows = (data ?? []) as unknown as Array<{
      id: string
      competition_id: string
      competitions: Competition
    }>

    const assignments: JudgeAssignment[] = rawRows.map((row) => ({
      id: row.id,
      competition_id: row.competition_id,
      competition: row.competitions,
    }))

    // Sort by competition code numerically
    assignments.sort((a, b) => {
      const codeA = parseCodeAsNumber(a.competition.code)
      const codeB = parseCodeAsNumber(b.competition.code)
      if (codeA !== null && codeB !== null) return codeA - codeB
      if (codeA !== null) return -1
      if (codeB !== null) return 1
      return (a.competition.code ?? '').localeCompare(b.competition.code ?? '')
    })

    setJudgeAssignments(assignments)
    setLoadingAssignments(false)
  }

  function toggleExpanded(judgeId: string) {
    if (expandedJudgeId === judgeId) {
      setExpandedJudgeId(null)
      setJudgeAssignments([])
      return
    }
    setExpandedJudgeId(judgeId)
    setCodeStart('')
    setCodeEnd('')
    setFilterLevel('')
    setFilterAgeGroup('')
    void loadJudgeAssignments(judgeId)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) return
    setSaving(true)

    const code = generateAccessCode(lastName)

    const { error: err } = await supabase.from('judges').insert({
      event_id: eventId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      access_code: code,
    })

    if (err) {
      showError('Failed to add judge', { description: err.message })
    } else {
      showSuccess('Judge added')
      setFirstName('')
      setLastName('')
      await loadJudges()
    }
    setSaving(false)
  }

  async function handleRegenCode(judgeId: string, lastName: string) {
    const code = generateAccessCode(lastName)
    const { error } = await supabase.from('judges').update({ access_code: code }).eq('id', judgeId)
    if (error) {
      showError('Failed to regenerate code', { description: error.message })
      return
    }
    showSuccess('Access code regenerated')
    void loadJudges()
  }

  async function handleRemove(judgeId: string) {
    const { error } = await supabase.from('judges').delete().eq('id', judgeId)
    if (error) {
      showError('Failed to remove judge', { description: error.message })
      return
    }
    showSuccess('Judge removed')
    if (expandedJudgeId === judgeId) {
      setExpandedJudgeId(null)
      setJudgeAssignments([])
    }
    void loadJudges()
    void loadAssignmentCounts()
  }

  async function assignCompetitions(judgeId: string, competitionIds: string[]) {
    if (competitionIds.length === 0) return

    // Filter out already-assigned competitions
    const existingIds = new Set(judgeAssignments.map((a) => a.competition_id))
    const newIds = competitionIds.filter((id) => !existingIds.has(id))
    if (newIds.length === 0) {
      showSuccess('All selected competitions already assigned')
      return
    }

    setAssigningBatch(true)
    const rows = newIds.map((compId) => ({
      judge_id: judgeId,
      competition_id: compId,
    }))

    const { error } = await supabase.from('judge_assignments').insert(rows)
    if (error) {
      showError('Failed to assign competitions', { description: error.message })
      setAssigningBatch(false)
      return
    }

    showSuccess(`Assigned ${newIds.length} competition${newIds.length === 1 ? '' : 's'}`)
    await loadJudgeAssignments(judgeId)
    void loadAssignmentCounts()
    setAssigningBatch(false)
  }

  async function handleRemoveAssignment(assignmentId: string, judgeId: string) {
    const { error } = await supabase.from('judge_assignments').delete().eq('id', assignmentId)
    if (error) {
      showError('Failed to remove assignment', { description: error.message })
      return
    }
    showSuccess('Assignment removed')
    await loadJudgeAssignments(judgeId)
    void loadAssignmentCounts()
  }

  async function handleClearAll(judgeId: string) {
    const { error } = await supabase
      .from('judge_assignments')
      .delete()
      .eq('judge_id', judgeId)
    if (error) {
      showError('Failed to clear assignments', { description: error.message })
      return
    }
    showSuccess('All assignments cleared')
    await loadJudgeAssignments(judgeId)
    void loadAssignmentCounts()
  }

  function handleAssignByCodeRange(judgeId: string) {
    const start = parseInt(codeStart, 10)
    const end = parseInt(codeEnd, 10)
    if (isNaN(start) || isNaN(end) || start > end) {
      showError('Invalid code range', { description: 'Enter valid start and end numbers' })
      return
    }

    const matchingIds = competitions
      .filter((c) => {
        const num = parseCodeAsNumber(c.code)
        return num !== null && num >= start && num <= end
      })
      .map((c) => c.id)

    if (matchingIds.length === 0) {
      showError('No competitions found in that code range')
      return
    }

    void assignCompetitions(judgeId, matchingIds)
  }

  function handleAssignByLevel(judgeId: string) {
    if (!filterLevel) return
    const matchingIds = competitions.filter((c) => c.level === filterLevel).map((c) => c.id)
    if (matchingIds.length === 0) {
      showError(`No competitions found for level "${filterLevel}"`)
      return
    }
    void assignCompetitions(judgeId, matchingIds)
  }

  function handleAssignByAgeGroup(judgeId: string) {
    if (!filterAgeGroup) return
    const matchingIds = competitions.filter((c) => c.age_group === filterAgeGroup).map((c) => c.id)
    if (matchingIds.length === 0) {
      showError(`No competitions found for age group "${filterAgeGroup}"`)
      return
    }
    void assignCompetitions(judgeId, matchingIds)
  }

  function handleAssignAll(judgeId: string) {
    const allIds = competitions.map((c) => c.id)
    void assignCompetitions(judgeId, allIds)
  }

  // Derive unique levels and age groups for dropdowns
  const uniqueLevels = [...new Set(competitions.map((c) => c.level).filter(Boolean))] as string[]
  const uniqueAgeGroups = [
    ...new Set(competitions.map((c) => c.age_group).filter(Boolean)),
  ] as string[]

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>

  if (loadError) {
    return (
      <div className="max-w-2xl">
        <div className="p-3 rounded-md bg-orange-50 border border-orange-200 text-orange-800 text-sm">
          Could not load judges. Try refreshing.
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <Card className="feis-card mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Add Judge</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-3 items-end">
            <div className="flex-1">
              <Label htmlFor="firstName" className="text-sm font-medium">
                First Name
              </Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="lastName" className="text-sm font-medium">
                Last Name
              </Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Adding...' : 'Add Judge'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="feis-card">
        <CardHeader>
          <CardTitle className="text-lg">Judge List ({judges.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {judges.length === 0 ? (
            <p className="text-muted-foreground text-sm">No judges added yet.</p>
          ) : (
            <div className="space-y-3">
              {judges.map((judge) => (
                <div key={judge.id} className="rounded-md border">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer"
                    onClick={() => toggleExpanded(judge.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleExpanded(judge.id)
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium">
                          {judge.first_name} {judge.last_name}
                        </p>
                        <p className="font-mono text-lg tracking-widest text-feis-green font-bold mt-0.5">
                          {judge.access_code ?? 'No code'}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {assignmentCounts[judge.id] ?? 0} comp
                        {(assignmentCounts[judge.id] ?? 0) === 1 ? '' : 's'} assigned
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRegenCode(judge.id, judge.last_name)
                        }}
                      >
                        New Code
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRemove(judge.id)
                        }}
                        className="text-destructive hover:text-destructive"
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  {expandedJudgeId === judge.id && (
                    <div className="border-t px-3 pb-3 pt-3 space-y-4">
                      {/* Current Assignments */}
                      <div>
                        <h4 className="text-sm font-medium mb-2">Current Assignments</h4>
                        {loadingAssignments ? (
                          <p className="text-muted-foreground text-sm">Loading assignments...</p>
                        ) : judgeAssignments.length === 0 ? (
                          <p className="text-muted-foreground text-sm">
                            No competitions assigned yet.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {judgeAssignments.map((assignment) => (
                              <div
                                key={assignment.id}
                                className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted text-sm"
                              >
                                <span>
                                  <span className="font-mono font-medium">
                                    {assignment.competition.code ?? '—'}
                                  </span>{' '}
                                  {assignment.competition.name}
                                  {assignment.competition.level && (
                                    <span className="text-muted-foreground">
                                      {' '}
                                      ({assignment.competition.level})
                                    </span>
                                  )}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                                  onClick={() =>
                                    void handleRemoveAssignment(assignment.id, judge.id)
                                  }
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                            <div className="pt-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => void handleClearAll(judge.id)}
                              >
                                Clear All Assignments
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Batch Assign Controls */}
                      {competitions.length > 0 && (
                        <div className="border-t pt-3">
                          <h4 className="text-sm font-medium mb-3">Assign Competitions</h4>
                          <div className="space-y-3">
                            {/* By Code Range */}
                            <div className="flex items-end gap-2">
                              <div className="w-20">
                                <Label className="text-xs">From Code</Label>
                                <Input
                                  value={codeStart}
                                  onChange={(e) => setCodeStart(e.target.value)}
                                  placeholder="1"
                                  className="h-8"
                                />
                              </div>
                              <div className="w-20">
                                <Label className="text-xs">To Code</Label>
                                <Input
                                  value={codeEnd}
                                  onChange={(e) => setCodeEnd(e.target.value)}
                                  placeholder="50"
                                  className="h-8"
                                />
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={assigningBatch || !codeStart || !codeEnd}
                                onClick={() => handleAssignByCodeRange(judge.id)}
                              >
                                Assign Range
                              </Button>
                            </div>

                            {/* By Level */}
                            {uniqueLevels.length > 0 && (
                              <div className="flex items-end gap-2">
                                <div className="w-48">
                                  <Label className="text-xs">By Level</Label>
                                  <select
                                    value={filterLevel}
                                    onChange={(e) => setFilterLevel(e.target.value)}
                                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                  >
                                    <option value="">Select level...</option>
                                    {uniqueLevels.map((level) => (
                                      <option key={level} value={level}>
                                        {level}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={assigningBatch || !filterLevel}
                                  onClick={() => handleAssignByLevel(judge.id)}
                                >
                                  Assign Level
                                </Button>
                              </div>
                            )}

                            {/* By Age Group */}
                            {uniqueAgeGroups.length > 0 && (
                              <div className="flex items-end gap-2">
                                <div className="w-48">
                                  <Label className="text-xs">By Age Group</Label>
                                  <select
                                    value={filterAgeGroup}
                                    onChange={(e) => setFilterAgeGroup(e.target.value)}
                                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                  >
                                    <option value="">Select age group...</option>
                                    {uniqueAgeGroups.map((ag) => (
                                      <option key={ag} value={ag}>
                                        {ag}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={assigningBatch || !filterAgeGroup}
                                  onClick={() => handleAssignByAgeGroup(judge.id)}
                                >
                                  Assign Age Group
                                </Button>
                              </div>
                            )}

                            {/* Assign All */}
                            <div>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={assigningBatch}
                                onClick={() => handleAssignAll(judge.id)}
                              >
                                Assign All Competitions ({competitions.length})
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {competitions.length === 0 && (
                        <p className="text-muted-foreground text-sm">
                          No competitions imported yet. Import competitions first, then assign them
                          to judges.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
