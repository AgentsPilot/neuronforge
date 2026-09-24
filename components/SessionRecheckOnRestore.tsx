'use client';

/**
 * Don't show a signed-out person the app they just left.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS FOR
 *
 * Sign out, then press Back: the browser served the CRM again — chrome, tabs
 * and all — with no data in it, because there was no session left to fetch any.
 * A page that looks like the app but can load nothing reads as the app being
 * broken, not as "you are signed out".
 *
 * It happens because of the back/forward cache. A page restored from bfcache is
 * not re-rendered and its effects do not re-run: the browser resurrects the
 * whole document, JavaScript heap included, exactly as it was. Every auth check
 * in this app runs inside a React effect, so on that path not one of them fires.
 *
 * `pageshow` with `persisted: true` is the only event that reports a bfcache
 * restore, which makes it the one place this can be caught.
 *
 * The sign-out controls now also `location.replace` rather than `href`, so the
 * page someone just left is not in history at all. That covers one tap of Back.
 * This covers the rest of the stack — everything they visited before it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Mounted in `PlatformShell`, so it guards the platform's own pages and not the
 * customer-facing ones, which have no session and must never be redirected.
 */

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { marketingLoginUrl } from '@/lib/utils/marketingUrl';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'SessionRecheckOnRestore' });

export function SessionRecheckOnRestore() {
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      /*
       * Only a bfcache restore. A normal load already ran every effect on the
       * page, including whatever auth check it has, so re-checking here would
       * duplicate that work on every single navigation.
       */
      if (!event.persisted) return;

      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session) return;

          logger.debug('Restored a platform page with no session; leaving for sign-in');

          /*
           * `replace`, so this dead entry is overwritten rather than adding
           * another one — otherwise Back from the login page returns straight
           * to the same signed-out screen, and the person is stuck in a loop
           * between two pages neither of which works.
           */
          window.location.replace(marketingLoginUrl());
        } catch (error) {
          /*
           * Deliberately does nothing on failure. If the session cannot be
           * read, throwing someone out of a page they may legitimately be
           * signed in to is the worse mistake — their own page's auth check
           * still applies on any real navigation.
           */
          logger.warn({ err: error }, 'Could not re-check the session after a restore');
        }
      })();
    };

    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  return null;
}
