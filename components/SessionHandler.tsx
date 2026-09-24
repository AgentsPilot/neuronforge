'use client';

/**
 * The LEGACY sign-in handoff: Supabase tokens in a URL fragment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Sign-in now arrives as a single-use code at `/auth/handoff`. Nothing this
 * project deploys writes an `access_token` into a URL any more.
 *
 * This is kept for the rollout window only — a tab opened before the change, or
 * a marketing deployment not yet updated — and it is guarded twice:
 *
 *   1. It is mounted on `/onboarding-chat` alone. It used to live in
 *      `PlatformShell`, so it ran on EVERY page and would adopt an
 *      `access_token` from any url it found one in.
 *   2. A fragment is ignored outright when a session already exists.
 *
 * The second guard is the one that matters for the bug this came from: a
 * fragment persists in browser history, so a Back button could re-establish a
 * session that had just been deliberately signed out.
 *
 * DELETE THIS COMPONENT once the marketing site has been on the code flow long
 * enough that no live link can still carry a fragment.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { usePathname } from 'next/navigation';
import { marketingLoginUrl } from '@/lib/utils/marketingUrl';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'SessionHandler' });

export function SessionHandler() {
  const pathname = usePathname();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token')) return;

    const params = new URLSearchParams(hash.substring(1));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');

    if (!access_token || !refresh_token) return;

    const clearHash = () => window.history.replaceState(null, '', pathname);

    const adopt = async () => {
      /*
       * Never over an existing session. See the header: this is what stops a
       * stale fragment in history from undoing a sign-out.
       */
      const { data: existing } = await supabase.auth.getSession();
      if (existing?.session) {
        logger.debug('Ignoring a legacy token fragment; a session already exists');
        clearHash();
        return;
      }

      logger.debug('Adopting a legacy session fragment');

      const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });

      if (error) {
        logger.error({ err: error }, 'Legacy session handoff failed');
        // Back to where the handoff came from: the marketing site's login, on
        // its own origin. `router.push` would 404 inside this app.
        window.location.href = marketingLoginUrl('?error=session_failed');
        return;
      }

      /*
       * Ids only, never the address.
       *
       * This logged `data.user?.email` at every sign-in, putting the owner's
       * address into the browser console — where a screen share, a screenshot or
       * a support session picks it up. The user id identifies the same person
       * for debugging and identifies nobody to a reader.
       */
      logger.debug({ userId: data.user?.id }, 'Session established from a legacy fragment');

      clearHash();

      /*
       * No `router.refresh()` here, and that omission is the point.
       *
       * `setSession` resolves at the same moment the landing page is deciding
       * where to send an already-onboarded business — it reads the session,
       * finds `onboarding_completed`, and calls `router.push('/business-os')`. A
       * refresh fired now ABORTS that in-flight RSC request and re-fetches the
       * route the user is standing on instead. The push never lands, the page
       * that issued it had already returned without clearing its loading flag,
       * and the result was a spinner on `/onboarding-chat` that never ended —
       * with the server log showing middleware allowing `/business-os` through
       * and no page render ever following it.
       *
       * Nothing is lost. `UserProvider` subscribes to `onAuthStateChange`, which
       * `setSession` fires, so the session reaches React without being asked
       * twice; the handoff only ever lands on `/onboarding-chat`, whose tree
       * reads auth on the client.
       */
    };

    void adopt();
  }, [pathname]);

  return null;
}
