'use client'

import { useEffect, useState, use } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useSupabase } from '@/hooks/use-supabase'
import { useEvent } from '@/contexts/event-context'
import { showSuccess, showError } from '@/lib/feedback'
import { type CompetitionStatus } from '@/lib/competition-states'
import { CompetitionStatusBadge } from '@/components/competition-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Stage {
  id: string
  name: string
  display_order: number
}

interface Competition {
  id: string
  code: string | null
  name: string
  age_group: string | null
  level: string | null
  status: string
  stage_id: string | null
  schedule_position: number | null
  dance_type: string | null
  group_size: number | null
  registrations: { count: number }[] | null
}

export default function ProgramPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = use(params)
  const supabase = useSupabase()
  const { reload } = useEvent()
  const [stages, setStages] = useState<Stage[]>([])
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loading, setLoading] = useState(true)
  const [reordering, setReordering] = useState(false)
  const [dragCompId, setDragCompId] = useState<string | null>(null)
  const [dragOverCompId, setDragOverCompId] = useState<string | null>(null)

  async function loadData() {
    const [stagesRes, compsRes] = await Promise.all([
      supabase
        .from('stages')
        .select('id, name, display_order')
        .eq('event_id', eventId)
        .order('display_order'),
      supabase
        .from('competitions')
        .select('id, code, name, age_group, level, status, stage_id, schedule_position, dance_type, group_size, registrations(count)')
        .eq('event_id', eventId)
        .order('schedule_position', { nullsFirst: false }),
    ])

    if (stagesRes.error) {
      console.error('Failed to load stages:', stagesRes.error.message)
    }
    if (compsRes.error) {
      console.error('Failed to load competitions:', compsRes.error.message)
    }

    setStages(stagesRes.data ?? [])
    setCompetitions((compsRes.data as Competition[] | null) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadData depends on supabase/eventId which are stable
  }, [eventId])

  function getCompsForStage(stageId: string): Competition[] {
    return competitions
      .filter(c => c.stage_id === stageId)
      .sort((a, b) => (a.schedule_position ?? 9999) - (b.schedule_position ?? 9999))
  }

  function getUnassignedComps(): Competition[] {
    return competitions
      .filter(c => !c.stage_id)
      .sort((a, b) => {
        const codeA = a.code ?? ''
        const codeB = b.code ?? ''
        return codeA.localeCompare(codeB)
      })
  }

  async function handleReorder(stageId: string, compId: string, direction: 'up' | 'down') {
    const stageComps = getCompsForStage(stageId)
    const idx = stageComps.findIndex(c => c.id === compId)
    if (direction === 'up' && idx <= 0) return
    if (direction === 'down' && (idx < 0 || idx >= stageComps.length - 1)) return

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const newOrder = [...stageComps]
    const temp = newOrder[idx]
    newOrder[idx] = newOrder[swapIdx]
    newOrder[swapIdx] = temp

    // Optimistic update — instant UI
    setCompetitions((prev) =>
      prev.map((c) => {
        const newIdx = newOrder.findIndex((n) => n.id === c.id)
        if (newIdx >= 0) return { ...c, schedule_position: newIdx + 1 }
        return c
      })
    )

    // Save in background
    try {
      for (const c of newOrder) {
        await supabase.from('competitions').update({ schedule_position: null }).eq('id', c.id)
      }
      for (let i = 0; i < newOrder.length; i++) {
        await supabase.from('competitions').update({ schedule_position: i + 1 }).eq('id', newOrder[i].id)
      }
    } catch {
      showError('Failed to save — refresh to retry')
      await loadData()
    }
  }

  async function handleDrop(stageId: string, targetCompId: string) {
    if (!dragCompId || dragCompId === targetCompId) return

    const stageComps = getCompsForStage(stageId)
    const fromIdx = stageComps.findIndex((c) => c.id === dragCompId)
    const toIdx = stageComps.findIndex((c) => c.id === targetCompId)
    if (fromIdx < 0 || toIdx < 0) return

    const newOrder = [...stageComps]
    const [moved] = newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, moved)

    // Optimistic update — instant UI
    setCompetitions((prev) =>
      prev.map((c) => {
        const newIdx = newOrder.findIndex((n) => n.id === c.id)
        if (newIdx >= 0) return { ...c, schedule_position: newIdx + 1 }
        return c
      })
    )
    setDragCompId(null)
    setDragOverCompId(null)

    // Save in background
    try {
      // Clear then set — sequential but non-blocking
      for (const c of newOrder) {
        await supabase.from('competitions').update({ schedule_position: null }).eq('id', c.id)
      }
      for (let i = 0; i < newOrder.length; i++) {
        await supabase.from('competitions').update({ schedule_position: i + 1 }).eq('id', newOrder[i].id)
      }
    } catch {
      showError('Failed to save order — refresh to retry')
      await loadData()
    }
  }

  async function handleQuickAssign(compId: string, stageId: string) {
    const stageComps = getCompsForStage(stageId)
    const nextPosition = stageComps.length > 0
      ? Math.max(...stageComps.map(c => c.schedule_position ?? 0)) + 1
      : 1

    const { error } = await supabase
      .from('competitions')
      .update({ stage_id: stageId, schedule_position: nextPosition })
      .eq('id', compId)

    if (error) {
      showError('Failed to assign stage', { description: error.message })
      return
    }

    await loadData()
    void reload()
    showSuccess('Stage assigned')
  }

  function formatDanceType(dt: string | null): string {
    if (!dt) return ''
    return dt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  const [addingStageName, setAddingStageName] = useState('')
  const [addingStage, setAddingStage] = useState(false)
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editingStageName, setEditingStageName] = useState('')

  async function handleAddStage() {
    if (!addingStageName.trim()) return
    setAddingStage(true)
    const nextOrder = stages.length > 0 ? Math.max(...stages.map(s => s.display_order)) + 1 : 1
    const { error } = await supabase.from('stages').insert({
      event_id: eventId,
      name: addingStageName.trim(),
      display_order: nextOrder,
    })
    if (error) {
      showError('Failed to add stage', { description: error.message })
    } else {
      setAddingStageName('')
      await loadData()
      showSuccess('Stage added')
    }
    setAddingStage(false)
  }

  async function handleRenameStage(stageId: string) {
    if (!editingStageName.trim()) return
    const { error } = await supabase
      .from('stages')
      .update({ name: editingStageName.trim() })
      .eq('id', stageId)
    if (error) {
      showError('Failed to rename stage', { description: error.message })
    } else {
      setEditingStageId(null)
      await loadData()
      showSuccess('Stage renamed')
    }
  }

  async function handleDeleteStage(stageId: string) {
    const stageComps = getCompsForStage(stageId)
    if (stageComps.length > 0) {
      showError('Cannot delete a stage that has competitions assigned')
      return
    }
    const { error } = await supabase.from('stages').delete().eq('id', stageId)
    if (error) {
      showError('Failed to delete stage', { description: error.message })
    } else {
      await loadData()
      showSuccess('Stage deleted')
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  const unassigned = getUnassignedComps()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Schedule</h2>
        <span className="text-sm text-muted-foreground">
          {competitions.length} competition{competitions.length !== 1 ? 's' : ''} total
        </span>
      </div>

      {/* Stage sections */}
      {stages.map(stage => {
        const stageComps = getCompsForStage(stage.id)
        const isEditing = editingStageId === stage.id

        return (
          <Card key={stage.id} className="feis-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center justify-between">
                {isEditing ? (
                  <form onSubmit={(e) => { e.preventDefault(); handleRenameStage(stage.id) }} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingStageName}
                      onChange={(e) => setEditingStageName(e.target.value)}
                      className="border rounded px-2 py-1 text-sm w-40"
                      autoFocus
                    />
                    <Button size="sm" type="submit">Save</Button>
                    <Button size="sm" variant="outline" type="button" onClick={() => setEditingStageId(null)}>Cancel</Button>
                  </form>
                ) : (
                  <span
                    className="cursor-pointer hover:text-feis-green transition-colors"
                    onClick={() => { setEditingStageId(stage.id); setEditingStageName(stage.name) }}
                    title="Click to rename"
                  >
                    {stage.name}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  {stageComps.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-muted-foreground"
                      disabled={reordering}
                      onClick={async () => {
                        setReordering(true)
                        try {
                          const sorted = [...stageComps].sort((a, b) => {
                            const numA = parseInt(a.code ?? '', 10)
                            const numB = parseInt(b.code ?? '', 10)
                            // Both numeric codes — sort numerically
                            if (!isNaN(numA) && !isNaN(numB)) return numA - numB
                            // One numeric, one not — numbers first
                            if (!isNaN(numA)) return -1
                            if (!isNaN(numB)) return 1
                            // Both non-numeric — sort by name
                            return (a.name ?? '').localeCompare(b.name ?? '')
                          })
                          for (const c of sorted) {
                            await supabase.from('competitions').update({ schedule_position: null }).eq('id', c.id)
                          }
                          for (let i = 0; i < sorted.length; i++) {
                            await supabase.from('competitions').update({ schedule_position: i + 1 }).eq('id', sorted[i].id)
                          }
                          await loadData()
                          showSuccess('Sorted by number')
                        } catch {
                          showError('Failed to sort')
                        } finally {
                          setReordering(false)
                        }
                      }}
                    >
                      Sort by #
                    </Button>
                  )}
                  <Badge variant="outline">
                    {stageComps.length} competition{stageComps.length !== 1 ? 's' : ''}
                  </Badge>
                  {stageComps.length === 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteStage(stage.id)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stageComps.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No competitions assigned to this stage yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {stageComps.map((comp, idx) => (
                    <div
                      key={comp.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragCompId(comp.id) }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCompId(comp.id) }}
                      onDragEnd={() => { setDragCompId(null); setDragOverCompId(null) }}
                      onDrop={(e) => { e.preventDefault(); handleDrop(stage.id, comp.id) }}
                      className={`flex items-center justify-between p-2.5 rounded-lg transition-colors group cursor-grab active:cursor-grabbing ${
                        dragOverCompId === comp.id && dragCompId !== comp.id
                          ? 'bg-feis-green-light/50 border-2 border-feis-green/30 border-dashed'
                          : dragCompId === comp.id
                            ? 'opacity-40'
                            : 'hover:bg-feis-green-light/30'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-sm font-semibold text-feis-green w-6 text-right tabular-nums shrink-0">
                          {comp.code ?? idx + 1}
                        </span>
                        <div className="min-w-0">
                          <span className="font-medium text-sm">
                            {comp.name}
                          </span>
                          {comp.dance_type && (
                            <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">
                              {formatDanceType(comp.dance_type)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <span className="text-xs text-muted-foreground hidden sm:inline tabular-nums">
                          {comp.registrations?.[0]?.count ?? 0}
                        </span>
                        {comp.group_size && comp.group_size !== 2 && (
                          <Badge variant="outline" className="text-xs">
                            grp {comp.group_size}
                          </Badge>
                        )}
                        <CompetitionStatusBadge status={comp.status as CompetitionStatus} />
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0"
                            disabled={idx === 0 || reordering}
                            onClick={() => handleReorder(stage.id, comp.id, 'up')}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0"
                            disabled={idx === stageComps.length - 1 || reordering}
                            onClick={() => handleReorder(stage.id, comp.id, 'down')}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1 text-[10px] text-muted-foreground hover:text-destructive"
                            onClick={async () => {
                              const { error } = await supabase
                                .from('competitions')
                                .update({ stage_id: null, schedule_position: null })
                                .eq('id', comp.id)
                              if (error) {
                                showError('Failed to unassign', { description: error.message })
                                return
                              }
                              await loadData()
                              void reload()
                              showSuccess('Unassigned from stage')
                            }}
                          >
                            ✕
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* Unassigned competitions */}
      {unassigned.length > 0 && (
        <Card className="feis-card border-feis-orange/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Unassigned</span>
              <Badge variant="outline" className="border-feis-orange/40 text-feis-orange">
                {unassigned.length} competition{unassigned.length !== 1 ? 's' : ''}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stages.length > 0 && (
              <div className="flex items-center gap-2 mb-4 pb-3 border-b">
                <span className="text-sm text-muted-foreground">Assign all to:</span>
                {stages.map(s => (
                  <Button
                    key={s.id}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const ids = unassigned.map(c => c.id)
                      // Assign all with sequential positions
                      const existingCount = getCompsForStage(s.id).length
                      for (let i = 0; i < ids.length; i++) {
                        const { error } = await supabase
                          .from('competitions')
                          .update({ stage_id: s.id, schedule_position: existingCount + i + 1 })
                          .eq('id', ids[i])
                        if (error) {
                          showError('Failed to assign', { description: error.message })
                          break
                        }
                      }
                      await loadData()
                      void reload()
                      showSuccess(`${ids.length} competitions assigned to ${s.name}`)
                    }}
                  >
                    {s.name}
                  </Button>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              {unassigned.map(comp => (
                <div
                  key={comp.id}
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-feis-orange/5 transition-colors"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-sm">
                      {comp.code && (
                        <span className="font-mono text-feis-green/50 mr-1.5">
                          {comp.code}
                        </span>
                      )}
                      {comp.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <CompetitionStatusBadge status={comp.status as CompetitionStatus} />
                    {stages.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            handleQuickAssign(comp.id, e.target.value)
                          }
                        }}
                        className="text-xs border rounded px-2 py-1"
                      >
                        <option value="">Assign to...</option>
                        {stages.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Stage */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={addingStageName}
          onChange={(e) => setAddingStageName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddStage() }}
          placeholder="New stage name..."
          className="border rounded-md px-3 py-2 text-sm flex-1"
        />
        <Button
          onClick={handleAddStage}
          disabled={!addingStageName.trim() || addingStage}
          size="sm"
        >
          {addingStage ? 'Adding...' : 'Add Stage'}
        </Button>
      </div>

      {/* Save confirmation */}
      {competitions.length > 0 && (
        <Button
          className="w-full"
          onClick={async () => {
            await loadData()
            showSuccess('Schedule saved')
          }}
        >
          Save Schedule
        </Button>
      )}

      {competitions.length === 0 && (
        <p className="text-center text-muted-foreground py-8">
          No competitions yet. Import competitions first.
        </p>
      )}
    </div>
  )
}
