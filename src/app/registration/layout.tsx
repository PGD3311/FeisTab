import { RunFeisLogo } from '@/components/runfeis-logo'
import { SignOutButton } from '@/components/sign-out-button'

export default function RegistrationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen feis-bg-texture">
      <header className="bg-feis-green">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="flex items-center gap-3">
            <RunFeisLogo variant="onGreen" size="sm" />
            <span className="text-sm text-white/70">Registration desk</span>
          </span>
          <SignOutButton className="h-10 px-4 text-base text-white/90 hover:text-white hover:bg-white/10" />
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
