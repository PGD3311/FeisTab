'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { label: 'Overview', path: '' },
  { label: 'Competitions', path: '/competitions' },
  { label: 'Program', path: '/program' },
  { label: 'Judges', path: '/judges' },
  { label: 'Import', path: '/import' },
  { label: 'Results', path: '/results' },
]

export function EventTabs({ eventId }: { eventId: string }) {
  const pathname = usePathname()
  const basePath = `/dashboard/events/${eventId}`

  return (
    <nav className="feis-segmented-bar">
      {tabs.map(tab => {
        const href = `${basePath}${tab.path}`
        const isActive = tab.path === ''
          ? pathname === basePath
          : pathname.startsWith(href)

        return (
          <Link
            key={tab.label}
            href={href}
            className={`feis-segmented-tab ${isActive ? 'feis-segmented-tab-active' : ''}`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
