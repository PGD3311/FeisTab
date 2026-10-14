'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { useSupabase } from '@/hooks/use-supabase'

export function SessionMonitor() {
  const supabase = useSupabase()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        toast.dismiss()
        router.push(`/auth/login?next=${encodeURIComponent(pathname)}`)
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase, router, pathname])

  // Server-action sign-outs land here without a client SIGNED_OUT event: never carry
  // the previous person's toasts onto the login screen
  useEffect(() => {
    if (pathname.startsWith('/auth/login')) toast.dismiss()
  }, [pathname])

  return null
}
