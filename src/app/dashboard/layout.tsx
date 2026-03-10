import { Nav } from '@/components/nav'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen feis-bg-texture">
      <Nav />
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
