'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface Tab {
  label: string
  href: (basePath: string, eventId: string) => string
  isActive: (pathname: string, basePath: string) => boolean
  external?: boolean
}

const tabs: Tab[] = [
  {
    label: 'Overview',
    href: (bp) => bp,
    isActive: (pn, bp) => pn === bp,
  },
  {
    label: 'Schedule',
    href: (bp) => `${bp}/program`,
    isActive: (pn, bp) => pn.startsWith(`${bp}/program`),
  },
  {
    label: 'Side-Stage',
    href: (_, id) => `/checkin/${id}`,
    isActive: () => false,
    external: true,
  },
  {
    label: 'Judges',
    href: (bp) => `${bp}/judges`,
    isActive: (pn, bp) => pn.startsWith(`${bp}/judges`),
  },
  {
    label: 'Comments',
    href: (bp) => `${bp}/comments`,
    isActive: (pn, bp) => pn.startsWith(`${bp}/comments`),
  },
  {
    label: 'Import',
    href: (bp) => `${bp}/import`,
    isActive: (pn, bp) => pn.startsWith(`${bp}/import`),
  },
  {
    label: 'Results',
    href: (bp) => `${bp}/results`,
    isActive: (pn, bp) => pn.startsWith(`${bp}/results`),
  },
]

export function EventTabs({ eventId }: { eventId: string }) {
  const pathname = usePathname()
  const basePath = `/dashboard/events/${eventId}`

  return (
    <nav className="feis-segmented-bar">
      {tabs.map(tab => (
        <Link
          key={tab.label}
          href={tab.href(basePath, eventId)}
          target={tab.external ? '_blank' : undefined}
          className={`feis-segmented-tab ${tab.isActive(pathname, basePath) ? 'feis-segmented-tab-active' : ''}`}
        >
          {tab.label}{tab.external ? ' \u2197' : ''}
        </Link>
      ))}
    </nav>
  )
}
