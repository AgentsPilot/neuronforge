// components/PlatformShell.tsx

'use client'

import { UserProvider } from '@/components/UserProvider'
import { Toaster } from 'sonner'
import { SafeSystemInitializer } from '@/components/SafeSystemInitializer'
import { SessionHandler } from '@/components/SessionHandler'

/**
 * The platform's own runtime: auth session listeners, the user context, the
 * scheduler bootstrap and the toast host.
 *
 * This used to live directly in the root layout, which meant it also ran on
 * every customer-facing page. A client opening a booking-cancellation link or
 * an invoice got Supabase auth listeners, an anonymous POST to
 * `/api/system/initialize`, and a toast reading "System Ready — NeuronForge
 * scheduler is running" on top of their appointment.
 *
 * It is a separate module (rather than a branch inside the layout) so that
 * `PlatformChrome` can pull it in through `next/dynamic`. That keeps this
 * chunk — Supabase auth plus sonner — out of the network waterfall entirely on
 * public pages, instead of merely rendering nothing.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SessionHandler />
      <UserProvider>
        <SafeSystemInitializer />
        {children}
        <Toaster richColors position="top-center" />
      </UserProvider>
    </>
  )
}
