export default function RegistrationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen feis-bg-texture">
      <header className="bg-feis-green">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <span className="text-lg font-bold text-white tracking-wide uppercase">
            FeisTab <span className="font-normal text-white/60 normal-case tracking-normal text-sm ml-1">Registration</span>
          </span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
