'use client'

import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UNPUBLISH_REASONS, UnpublishReason } from '@/lib/unpublish-reasons'

interface UnpublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  compCode: string
  compName: string
  onUnpublish: (unpublishedBy: string, reason: string, note: string | null) => void
}

export function UnpublishDialog({
  open,
  onOpenChange,
  compCode,
  compName,
  onUnpublish,
}: UnpublishDialogProps) {
  const [unpublishedBy, setUnpublishedBy] = React.useState('')
  const [reason, setReason] = React.useState<UnpublishReason | ''>('')
  const [note, setNote] = React.useState('')

  const requiresNote = reason === 'other'
  const canSubmit =
    reason !== '' &&
    unpublishedBy.trim().length > 0 &&
    (!requiresNote || note.trim().length > 0)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setUnpublishedBy('')
      setReason('')
      setNote('')
    }
    onOpenChange(nextOpen)
  }

  function handleSubmit() {
    if (!canSubmit) return
    onUnpublish(unpublishedBy.trim(), reason, requiresNote ? note.trim() : null)
    setUnpublishedBy('')
    setReason('')
    setNote('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Unpublish Results</DialogTitle>
          <DialogDescription>
            {compCode} — {compName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <p className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-800 border border-amber-200">
            Published results will be removed from the public page. Parents and teachers may have
            already seen them.
          </p>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="unpublish-reason" className="text-sm font-medium">
              Reason
            </label>
            <select
              id="unpublish-reason"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={reason}
              onChange={(e) => setReason(e.target.value as UnpublishReason | '')}
            >
              <option value="" disabled>
                Select reason...
              </option>
              {UNPUBLISH_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {requiresNote && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="unpublish-note" className="text-sm font-medium">
                Note
              </label>
              <textarea
                id="unpublish-note"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                placeholder="Describe the reason..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="unpublished-by" className="text-sm font-medium">
              Unpublished by
            </label>
            <Input
              id="unpublished-by"
              type="text"
              placeholder="Full name"
              value={unpublishedBy}
              onChange={(e) => setUnpublishedBy(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter showCloseButton>
          <Button variant="destructive" disabled={!canSubmit} onClick={handleSubmit}>
            Unpublish Results
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
