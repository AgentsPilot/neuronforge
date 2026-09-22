'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { usePathname } from 'next/navigation';
import { marketingLoginUrl } from '@/lib/utils/marketingUrl';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'SessionHandler' });

export function SessionHandler() {
  const pathname = usePathname();

  useEffect(() => {
    // Check for tokens in URL hash (from marketing site login)
    const hash = window.location.hash;

    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');

      if (access_token && refresh_token) {
        logger.debug('Session handoff detected; adopting it');

        supabase.auth.setSession({
          access_token,
          refresh_token,
        }).then(({ data, error }) => {
          if (error) {
            logger.error({ err: error }, 'Session handoff failed');
            // Back to where the handoff came from: the marketing site's login,
            // on its own origin. `router.push` would 404 inside this app.
            window.location.href = marketingLoginUrl('?error=session_failed');
          } else {
            /*
             * Ids only, never the address.
             *
             * This logged `data.user?.email` at every sign-in, putting the
             * owner's address into the browser console — where a screen share,
             * a screenshot or a support session picks it up. The user id
             * identifies the same person for debugging and identifies nobody to
             * a reader.
             */
            logger.debug({ userId: data.user?.id }, 'Session established from handoff');

            // Clear hash from URL
            window.history.replaceState(null, '', pathname);

            /*
             * No `router.refresh()` here, and that omission is the point.
             *
             * `setSession` resolves at the same moment the landing page is
             * deciding where to send an already-onboarded business — it reads
             * the session, finds `onboarding_completed`, and calls
             * `router.push('/business-os')`. A refresh fired now ABORTS that
             * in-flight RSC request and re-fetches the route the user is
             * standing on instead. The push never lands, the page that issued
             * it had already returned without clearing its loading flag, and
             * the result was a spinner on `/onboarding-chat` that never ended
             * — with the server log showing middleware allowing `/business-os`
             * through and no page render ever following it.
             *
             * Nothing is lost. `UserProvider` subscribes to
             * `onAuthStateChange`, which `setSession` fires, so the session
             * reaches React without being asked twice; the handoff only ever
             * lands on `/onboarding-chat`, whose tree reads auth on the client.
             */
          }
        });
      }
    }
  }, [pathname]);

  return null;
}
