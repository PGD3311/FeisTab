'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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
        router.push(`/auth/login?next=${encodeURIComponent(pathname)}`)
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase, router, pathname])

  return null
}
