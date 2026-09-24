// components/PlatformShell.tsx

'use client'

import { UserProvider } from '@/components/UserProvider'
import { Toaster } from 'sonner'
import { SessionRecheckOnRestore } from '@/components/SessionRecheckOnRestore'

/**
 * The platform's own runtime: auth session listeners, the user context and the
 * toast host.
 *
 * This used to live directly in the root layout, which meant it also ran on
 * every customer-facing page. A client opening a booking-cancellation link or
 * an invoice got Supabase auth listeners and the platform's toast host on top
 * of their appointment.
 *
 * It is a separate module (rather than a branch inside the layout) so that
 * `PlatformChrome` can pull it in through `next/dynamic`. That keeps this
 * chunk — Supabase auth plus sonner — out of the network waterfall entirely on
 * public pages, instead of merely rendering nothing.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        `SessionHandler` used to be mounted HERE, which meant it ran on every
        page of the platform and would adopt a Supabase `access_token` found in
        ANY url's fragment — not merely the one landing route the handoff aimed
        at. Together with the fragment persisting in browser history, that is how
        a Back button could sign someone back in after they had logged out.

        It is mounted on `/onboarding-chat` alone now, which is the only address
        a handoff has ever landed on.
      */}
      {/*
        Signing out then pressing Back used to serve the app again, empty: a
        bfcache restore re-renders nothing and re-runs no effect, so every auth
        check in this app — all of which live in effects — was skipped.
      */}
      <SessionRecheckOnRestore />

      <UserProvider>
        {children}
        <Toaster richColors position="top-center" />
      </UserProvider>
    </>
  )
}
