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

interface ApprovalChecks {
  reviewed_preview: boolean
  judge_signoffs_complete: boolean
  anomalies_reviewed: boolean
}

interface ApprovalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  compCode: string
  compName: string
  onApprove: (approvedBy: string, checks: ApprovalChecks) => void
}

const DEFAULT_CHECKS: ApprovalChecks = {
  reviewed_preview: false,
  judge_signoffs_complete: false,
  anomalies_reviewed: false,
}

export function ApprovalDialog({
  open,
  onOpenChange,
  compCode,
  compName,
  onApprove,
}: ApprovalDialogProps) {
  const [approvedBy, setApprovedBy] = React.useState('')
  const [checks, setChecks] = React.useState<ApprovalChecks>(DEFAULT_CHECKS)

  const allChecked = checks.reviewed_preview && checks.judge_signoffs_complete && checks.anomalies_reviewed
  const canSubmit = approvedBy.trim().length > 0 && allChecked

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setApprovedBy('')
      setChecks(DEFAULT_CHECKS)
    }
    onOpenChange(nextOpen)
  }

  function handleCheckChange(key: keyof ApprovalChecks) {
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleSubmit() {
    if (!canSubmit) return
    onApprove(approvedBy.trim(), checks)
    setApprovedBy('')
    setChecks(DEFAULT_CHECKS)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve &amp; Publish Results</DialogTitle>
          <DialogDescription>
            {compCode} — {compName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="approved-by" className="text-sm font-medium">
              Approved by
            </label>
            <Input
              id="approved-by"
              type="text"
              placeholder="Full name"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 accent-feis-green"
                checked={checks.reviewed_preview}
                onChange={() => handleCheckChange('reviewed_preview')}
              />
              <span className="text-sm">I reviewed the results preview</span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 accent-feis-green"
                checked={checks.judge_signoffs_complete}
                onChange={() => handleCheckChange('judge_signoffs_complete')}
              />
              <span className="text-sm">All judge sign-offs are complete</span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 accent-feis-green"
                checked={checks.anomalies_reviewed}
                onChange={() => handleCheckChange('anomalies_reviewed')}
              />
              <span className="text-sm">Any anomalies or warnings were reviewed</span>
            </label>
          </div>
        </div>

        <DialogFooter showCloseButton>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            Approve &amp; Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
