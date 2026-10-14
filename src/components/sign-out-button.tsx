'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'

interface SignOutButtonProps {
  className?: string
  variant?: 'ghost' | 'outline'
}

/** Signs out and clears any toasts so they don't carry over to the next person on this device. */
export function SignOutButton({ className, variant = 'ghost' }: SignOutButtonProps) {
  const supabase = useSupabase()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    toast.dismiss()
    try {
      await supabase.auth.signOut()
    } finally {
      router.push('/auth/login')
    }
  }

  return (
    <Button variant={variant} onClick={handleSignOut} disabled={signingOut} className={className}>
      {signingOut ? 'Signing out...' : 'Sign out'}
    </Button>
  )
}
