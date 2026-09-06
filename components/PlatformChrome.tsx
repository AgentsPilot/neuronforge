// components/PlatformChrome.tsx

'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'

const PlatformShell = dynamic(
  () => import('@/components/PlatformShell').then(m => m.PlatformShell),
  { ssr: true }
)

/**
 * Route prefixes served to the *customer of an AgentPilot user* rather than to
 * the user themselves. These get no platform chrome at all.
 *
 * `/site` is deliberately absent. The public website has the same problem and
 * would benefit from the same treatment, but it is outside the scope of this
 * change; adding it here is a one-line follow-up.
 */
const PUBLIC_PREFIXES = ['/book', '/c/', '/invoice/', '/go/'] as const

/**
 * Customer-facing pages that are NOT under a public prefix.
 *
 * The post-Stripe screens share their first segment with the owner-facing
 * `/payments` dashboard, so they have to be named exactly rather than by
 * prefix — the same distinction the middleware draws.
 */
const PUBLIC_EXACT = ['/payments/success', '/payments/cancelled'] as const

/** Whether this path is a customer-facing surface. */
export function isPublicSurfacePath(pathname: string): boolean {
  if ((PUBLIC_EXACT as readonly string[]).includes(pathname)) return true

  return PUBLIC_PREFIXES.some(prefix =>
    // `/book` is both a prefix and a page in its own right, so it is matched
    // exactly as well — the same trap that made `/book` a live 404 in the
    // middleware.
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

/**
 * Decides whether a request gets the platform runtime or nothing at all.
 *
 * `children` arrives as a prop from the (server) root layout, so page content
 * stays server-rendered on both branches — this component only chooses what is
 * mounted *around* it.
 */
export function PlatformChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (isPublicSurfacePath(pathname ?? '')) {
    return <>{children}</>
  }

  return <PlatformShell>{children}</PlatformShell>
}
