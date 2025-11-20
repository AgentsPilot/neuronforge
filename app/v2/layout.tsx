// app/v2/layout.tsx
// V2 Layout with theme provider and mockup styling

'use client'

import { V2ThemeProvider } from '@/lib/design-system-v2'
import { V2Footer } from '@/components/v2/Footer'
import { HelpBot } from '@/components/v2/HelpBot'
import { usePathname } from 'next/navigation'
import './globals-v2.css'

// Pages that have their own HelpBot implementation should not show the global one
const PAGES_WITH_OWN_HELPBOT = [
  '/v2/agents/[id]/run',
]

export default function V2RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Check if current page has its own HelpBot
  // Match pattern like /v2/agents/123/run
  const hasOwnHelpBot = pathname?.match(/\/v2\/agents\/[^/]+\/run/)

  return (
    <V2ThemeProvider>
      <div className="min-h-screen bg-[var(--v2-bg)] dark:bg-slate-900">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-5 lg:py-6 max-w-7xl">
          {children}

          {/* Global Footer */}
          <V2Footer />
        </div>

        {/* Global Help Bot - only show on pages without their own HelpBot */}
        {!hasOwnHelpBot && <HelpBot />}
      </div>
    </V2ThemeProvider>
  )
}
