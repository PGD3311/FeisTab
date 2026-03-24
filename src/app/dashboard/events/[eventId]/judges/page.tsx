'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { showSuccess, showError } from '@/lib/feedback'
import { canTransition, type CompetitionStatus } from '@/lib/competition-states'
import { logAudit } from '@/lib/audit'
import { useSupabase } from '@/hooks/use-supabase'
import { useEvent } from '@/contexts/event-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { type JudgeInfo } from '@/types/shared'

interface Judge extends JudgeInfo {
  access_code: string | null
}

interface Competition {
  id: string
  code: string | null
  name: string
  age_group: string | null
  level: string | null
  stage_id: string | null
}

interface Stage {
  id: string
  name: string
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
  const { reload } = useEvent()
  const [judges, setJudges] = useState<Judge[]>([])
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Assignment state
  const [, setStages] = useState<Stage[]>([])
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

  // Team management state
  const [teamMembers, setTeamMembers] = useState<Array<{
    id: string
    user_id: string
    role: string
    created_at: string
    user_email?: string
  }>>([])
  const [pendingInvites, setPendingInvites] = useState<Array<{
    id: string
    email: string
    role: string
    created_at: string
    accepted_at: string | null
  }>>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('registration_desk')
  const [inviteJudgeId, setInviteJudgeId] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

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

  const loadStages = useCallback(async () => {
    const { data, error } = await supabase
      .from('stages')
      .select('id, name')
      .eq('event_id', eventId)
      .order('display_order')
    if (!error) setStages((data as Stage[]) ?? [])
  }, [supabase, eventId])

  const loadCompetitions = useCallback(async () => {
    const { data, error } = await supabase
      .from('competitions')
      .select('id, code, name, age_group, level, stage_id')
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

  const loadTeamData = useCallback(async () => {
    const { data: roles } = await supabase
      .from('event_roles')
      .select('id, user_id, role, created_at')
      .eq('event_id', eventId)
      .order('created_at')

    const { data: invites } = await supabase
      .from('pending_invitations')
      .select('id, email, role, created_at, accepted_at')
      .eq('event_id', eventId)
      .order('created_at')

    if (roles) setTeamMembers(roles)
    if (invites) setPendingInvites(invites)
  }, [supabase, eventId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void loadJudges()
    void loadCompetitions()
    void loadAssignmentCounts()
    void loadStages()
    void loadTeamData()
  }, [loadJudges, loadCompetitions, loadAssignmentCounts, loadStages, loadTeamData])

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

  /**
   * After any judge assignment mutation, check if affected competitions that
   * were `ready_to_tabulate` now have incomplete sign-offs. If so, revert
   * their status to `awaiting_scores` and audit-log the change.
   */
  async function revertStaleReadyToTabulate(competitionIds: string[]) {
    if (competitionIds.length === 0) return

    // 1. Find which of these competitions are currently ready_to_tabulate
    const { data: comps, error: compErr } = await supabase
      .from('competitions')
      .select('id, status')
      .in('id', competitionIds)
      .eq('status', 'ready_to_tabulate')
    if (compErr) {
      console.error('Failed to check competition statuses:', compErr.message)
      return
    }
    if (!comps || comps.length === 0) return

    for (const comp of comps as Array<{ id: string; status: string }>) {
      // 2. Get the latest round's sign-offs
      const { data: rounds, error: roundErr } = await supabase
        .from('rounds')
        .select('id, judge_sign_offs')
        .eq('competition_id', comp.id)
        .order('round_number', { ascending: false })
        .limit(1)
      if (roundErr) {
        console.error(`Failed to load rounds for ${comp.id}:`, roundErr.message)
        continue
      }
      const latestRound = rounds?.[0] as
        | { id: string; judge_sign_offs: Record<string, string> | null }
        | undefined
      const signOffs = latestRound?.judge_sign_offs ?? {}

      // 3. Get the NEW assignment list for this competition
      const { data: assignments, error: assignErr } = await supabase
        .from('judge_assignments')
        .select('judge_id')
        .eq('competition_id', comp.id)
      if (assignErr) {
        console.error(`Failed to load assignments for ${comp.id}:`, assignErr.message)
        continue
      }

      const assignedJudgeIds = (assignments ?? []).map(
        (a: { judge_id: string }) => a.judge_id
      )

      // 4. Check if every assigned judge has signed off
      const allSignedOff =
        assignedJudgeIds.length > 0 &&
        assignedJudgeIds.every((id: string) => signOffs[id])

      if (!allSignedOff) {
        const from = comp.status as CompetitionStatus
        const to: CompetitionStatus = 'awaiting_scores'

        if (!canTransition(from, to)) {
          console.error(
            `Cannot transition competition ${comp.id} from ${from} to ${to}`
          )
          continue
        }

        const { error: updateErr } = await supabase
          .from('competitions')
          .update({ status: to })
          .eq('id', comp.id)
        if (updateErr) {
          console.error(
            `Failed to revert competition ${comp.id} status:`,
            updateErr.message
          )
          continue
        }

        await logAudit(supabase, {
          userId: null,
          entityType: 'competition',
          entityId: comp.id,
          action: 'status_change',
          beforeData: { status: from },
          afterData: {
            status: to,
            reason: 'Judge assignment changed — sign-offs no longer complete',
          },
        })

        console.log(
          `Reverted competition ${comp.id} from ${from} to ${to} due to assignment change`
        )
      }
    }
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

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      const { error } = await supabase.from('pending_invitations').insert({
        email: inviteEmail.toLowerCase().trim(),
        event_id: eventId,
        role: inviteRole,
        judge_id: inviteRole === 'judge' ? inviteJudgeId : null,
        invited_by: (await supabase.auth.getUser()).data.user?.id,
      })
      if (error) throw error
      showSuccess('Invitation sent')
      setInviteEmail('')
      setInviteJudgeId(null)
      await loadTeamData()
    } catch {
      showError('Failed to send invitation')
    }
    setInviting(false)
  }

  async function handleRemoveRole(roleId: string) {
    const { error } = await supabase.from('event_roles').delete().eq('id', roleId)
    if (error) {
      showError('Failed to remove role')
      return
    }
    showSuccess('Role removed')
    await loadTeamData()
  }

  async function handleRevokeInvite(inviteId: string) {
    const { error } = await supabase.from('pending_invitations').delete().eq('id', inviteId)
    if (error) {
      showError('Failed to revoke invitation')
      return
    }
    showSuccess('Invitation revoked')
    await loadTeamData()
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
    await revertStaleReadyToTabulate(newIds)
    void reload()
    setAssigningBatch(false)
  }

  async function handleRemoveAssignment(assignmentId: string, judgeId: string) {
    // Capture affected competition before deleting
    const affected = judgeAssignments.find((a) => a.id === assignmentId)
    const affectedCompIds = affected ? [affected.competition_id] : []

    const { error } = await supabase.from('judge_assignments').delete().eq('id', assignmentId)
    if (error) {
      showError('Failed to remove assignment', { description: error.message })
      return
    }
    showSuccess('Assignment removed')
    await loadJudgeAssignments(judgeId)
    void loadAssignmentCounts()
    await revertStaleReadyToTabulate(affectedCompIds)
    void reload()
  }

  async function handleClearAll(judgeId: string) {
    // Capture affected competition IDs before clearing
    const affectedCompIds = judgeAssignments.map((a) => a.competition_id)

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
    await revertStaleReadyToTabulate(affectedCompIds)
    void reload()
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

  const ROLE_LABELS: Record<string, string> = {
    organizer: 'Organizer',
    registration_desk: 'Registration Desk',
    side_stage: 'Side Stage',
    judge: 'Judge',
  }

  function roleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' | 'destructive' {
    switch (role) {
      case 'organizer':
        return 'default'
      case 'registration_desk':
        return 'secondary'
      case 'side_stage':
        return 'outline'
      case 'judge':
        return 'destructive'
      default:
        return 'secondary'
    }
  }

  // Judges not yet linked to an invite (for judge role invite dropdown)
  const unlinkedJudges = judges.filter(
    (j) => !pendingInvites.some((inv) => inv.role === 'judge' && inv.accepted_at === null)
  )

  // Derive unique levels and age groups for dropdowns
  const uniqueLevels = [...new Set(competitions.map((c) => c.level).filter(Boolean))] as string[]
  const uniqueAgeGroups = [
    ...new Set(competitions.map((c) => c.age_group).filter(Boolean)),
  ] as string[]

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>

  if (loadError) {
    return (
      <div className="max-w-2xl">
        <div className="p-3 rounded-md bg-feis-orange-light border border-feis-orange/20 text-feis-orange text-sm">
          Could not load judges. Try refreshing.
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      {/* Event Team Section */}
      <Card className="feis-card mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Event Team</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Invite Form */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Invite Team Member</h4>
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="inviteEmail" className="text-xs">
                  Email
                </Label>
                <Input
                  id="inviteEmail"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="team@example.com"
                />
              </div>
              <div className="w-48">
                <Label htmlFor="inviteRole" className="text-xs">
                  Role
                </Label>
                <select
                  id="inviteRole"
                  value={inviteRole}
                  onChange={(e) => {
                    setInviteRole(e.target.value)
                    if (e.target.value !== 'judge') setInviteJudgeId(null)
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="registration_desk">Registration Desk</option>
                  <option value="side_stage">Side Stage</option>
                  <option value="judge">Judge</option>
                  <option value="organizer">Organizer</option>
                </select>
              </div>
              {inviteRole === 'judge' && (
                <div className="w-48">
                  <Label htmlFor="inviteJudgeId" className="text-xs">
                    Link to Judge
                  </Label>
                  <select
                    id="inviteJudgeId"
                    value={inviteJudgeId ?? ''}
                    onChange={(e) => setInviteJudgeId(e.target.value || null)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select judge...</option>
                    {unlinkedJudges.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.first_name} {j.last_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button onClick={() => void handleInvite()} disabled={inviting || !inviteEmail.trim()}>
                {inviting ? 'Sending...' : 'Invite'}
              </Button>
            </div>
          </div>

          {/* Current Team Members */}
          {teamMembers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Current Members</h4>
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2 font-medium">Role</th>
                      <th className="text-left p-2 font-medium">User ID</th>
                      <th className="text-left p-2 font-medium">Added</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamMembers.map((member) => (
                      <tr key={member.id} className="border-b last:border-b-0">
                        <td className="p-2">
                          <Badge variant={roleBadgeVariant(member.role)}>
                            {ROLE_LABELS[member.role] ?? member.role}
                          </Badge>
                        </td>
                        <td className="p-2 font-mono text-xs text-muted-foreground">
                          {member.user_id.slice(0, 8)}...
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {new Date(member.created_at).toLocaleDateString()}
                        </td>
                        <td className="p-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => void handleRemoveRole(member.id)}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pending Invitations */}
          {pendingInvites.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Pending Invitations</h4>
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2 font-medium">Email</th>
                      <th className="text-left p-2 font-medium">Role</th>
                      <th className="text-left p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Sent</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingInvites.map((invite) => (
                      <tr key={invite.id} className="border-b last:border-b-0">
                        <td className="p-2">{invite.email}</td>
                        <td className="p-2">
                          <Badge variant={roleBadgeVariant(invite.role)}>
                            {ROLE_LABELS[invite.role] ?? invite.role}
                          </Badge>
                        </td>
                        <td className="p-2">
                          {invite.accepted_at ? (
                            <Badge variant="default" className="text-xs">
                              Accepted
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              Pending
                            </Badge>
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {new Date(invite.created_at).toLocaleDateString()}
                        </td>
                        <td className="p-2 text-right">
                          {!invite.accepted_at && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                              onClick={() => void handleRevokeInvite(invite.id)}
                            >
                              Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {teamMembers.length === 0 && pendingInvites.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No team members or invitations yet. Invite people above to give them access to this
              event.
            </p>
          )}
        </CardContent>
      </Card>

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
                                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
