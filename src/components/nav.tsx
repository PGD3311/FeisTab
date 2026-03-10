'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useSupabase } from '@/hooks/use-supabase'
import { Button } from '@/components/ui/button'

export function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = useSupabase()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="feis-nav-accent bg-feis-green">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="font-serif text-2xl font-bold text-white tracking-tight">
              FeisTab
            </span>
          </Link>
          <nav className="flex gap-6">
            <Link
              href="/dashboard"
              className={`text-sm font-medium transition-colors ${
                pathname === '/dashboard'
                  ? 'text-white'
                  : 'text-white/60 hover:text-white/90'
              }`}
            >
              Events
            </Link>
          </nav>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-white/70 hover:text-white hover:bg-white/10"
        >
          Sign out
        </Button>
      </div>
    </header>
  )
}
