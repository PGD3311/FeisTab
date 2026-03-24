export function validateNextParam(next: string | null | undefined): string {
  if (!next || typeof next !== 'string') return '/'
  // Must start with single /, second char must not be /
  if (!/^\/[^/]/.test(next) && next !== '/') return '/'
  // Reject protocol schemes and credential injection
  if (next.includes('://') || next.includes('@')) return '/'
  return next
}
