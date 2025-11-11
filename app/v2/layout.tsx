// app/v2/layout.tsx
// V2 Layout with theme provider and mockup styling

import type { Metadata } from 'next'
import { V2ThemeProvider } from '@/lib/design-system-v2'
import { V2Footer } from '@/components/v2/Footer'
import './globals-v2.css'

export const metadata: Metadata = {
  title: 'NeuronForge V2',
  description: 'AI Agent Platform - Version 2',
}

export default function V2RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <V2ThemeProvider>
      <div className="min-h-screen bg-[var(--v2-bg)] dark:bg-slate-900">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-5 lg:py-6 max-w-7xl">
          {children}

          {/* Global Footer */}
          <V2Footer />
        </div>
      </div>
    </V2ThemeProvider>
  )
}
