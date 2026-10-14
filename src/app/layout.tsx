import type { Metadata } from 'next'
import { Archivo } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { SessionMonitor } from '@/components/session-monitor'
import './globals.css'

// Brand type: Archivo 400/500/700 for body, 900 italic for the logo and headlines
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '900'],
  style: ['normal', 'italic'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'RunFeis',
  description: 'Live tabulation and results engine for Irish dance competitions',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="font-sans">
        <SessionMonitor />
        {children}
        <Toaster />
      </body>
    </html>
  )
}
