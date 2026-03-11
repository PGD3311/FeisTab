export default function JudgeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen feis-bg-texture">
      <header className="bg-feis-green">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <span className="font-serif text-xl font-bold text-white tracking-tight">
            FeisTab — Judge
          </span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
