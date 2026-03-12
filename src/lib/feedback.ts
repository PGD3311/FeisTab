import { toast } from 'sonner'

/**
 * Action completed successfully. Auto-dismiss after 3s.
 */
export function showSuccess(message: string, options?: { description?: string }) {
  toast.success(message, {
    description: options?.description,
    duration: 3000,
  })
}

/**
 * Action failed, but state is clear and user can retry. Auto-dismiss after 8s.
 */
export function showError(message: string, options?: { description?: string }) {
  toast.error(message, {
    description: options?.description,
    duration: 8000,
  })
}

/**
 * Action failed and user may be unsure what persisted. Must be manually dismissed.
 */
export function showCritical(message: string, options?: { description?: string }) {
  toast.error(message, {
    description: options?.description,
    duration: Infinity,
  })
}
