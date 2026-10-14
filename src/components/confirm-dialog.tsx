'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
}

/**
 * In-page "Are you sure?" step. Replaces window.confirm(), which is tiny on tablets,
 * styled by the browser, and blocks the page.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md gap-5 p-6" showCloseButton={false}>
        <DialogHeader className="gap-3">
          <DialogTitle className="text-xl font-semibold leading-snug">{title}</DialogTitle>
          <DialogDescription className="text-base text-feis-charcoal/80">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="-mx-6 -mb-6 p-4 gap-3">
          <Button
            variant="outline"
            className="h-12 min-w-[120px] text-base"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            className="h-12 min-w-[120px] text-base font-semibold"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
