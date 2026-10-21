// app/v2/layout.tsx
// V2 Layout with theme provider and mockup styling

import { V2ThemeProvider } from '@/lib/design-system-v2'
import { V2Footer } from '@/components/v2/Footer'
import './globals-v2.css'
import '@/lib/design-system-v2/v2-theme-tokens.css'
import { V2ThemeScript } from '@/lib/design-system-v2/V2ThemeScript'
import { V2CustomTokensStyle } from '@/lib/design-system-v2/V2CustomTokensStyle'
import { readV2CustomTokens } from '@/lib/design-system-v2/server/readV2CustomTokens'

/*
 * A server layout, rendered per request (TH-1, SA R2-Q3 option A).
 *
 * It was a client layout only by habit: it uses no hooks, and the provider and
 * footer are client components of their own. It reads the platform's custom
 * design tokens on the server like the owner layouts do. It must be
 * force-dynamic: as a static layout the read would run once at build and the
 * tokens would be baked into the HTML until the next deploy (guard G-9).
 * `/v2` is legacy and unlinked, so the per-request render costs little.
 */
export const dynamic = 'force-dynamic'

export default async function V2RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // No payment hold here, so nothing to overlap; the read's own deadline bounds it.
  const { tokens: customTokens, known: customTokensKnown } = await readV2CustomTokens()

  return (
    <>
      {/* First, outside every provider (TH-1). */}
      <V2ThemeScript />
      <V2CustomTokensStyle tokens={customTokens} />
      <V2ThemeProvider customTokens={customTokens} customTokensKnown={customTokensKnown}>
        <div className="min-h-screen bg-[var(--v2-bg)] dark:bg-slate-900">
          <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-5 lg:py-6 max-w-7xl">
            {children}

            {/* Global Footer */}
            <V2Footer />
          </div>
        </div>
      </V2ThemeProvider>
    </>
  )
}
