'use client';

/**
 * Where a sign-in from the marketing site lands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This replaces `/onboarding-chat#access_token=…&refresh_token=…`.
 *
 * The address now carries a code, not a credential: single-use, sixty seconds,
 * and worthless once redeemed — so this URL sitting in browser history cannot
 * sign anybody back in, which is what the fragment version did after a logout.
 *
 * The exchange happens here rather than on the server because the session has to
 * end up in THIS origin's browser storage, and only the browser can put it
 * there. What crosses the network is a one-time token hash.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { clientLogger } from '@/lib/logger/client';
import { marketingLoginUrl } from '@/lib/utils/marketingUrl';
import { requestDeduplicator } from '@/lib/utils/request-deduplication';

const logger = clientLogger.child({ module: 'AuthHandoff' });

function HandoffInner() {
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const code = searchParams.get('code');

    if (!code) {
      window.location.replace(marketingLoginUrl('?error=no_session'));
      return;
    }

    const exchange = async () => {
      try {
        /*
         * ─────────────────────────────────────────────────────────────────────
         * DEDUPLICATED, BECAUSE THE CODE CAN ONLY BE SPENT ONCE.
         *
         * React StrictMode invokes this effect TWICE in development — mount,
         * clean up, mount again. That fired two redemptions of the same code:
         * the first consumed it and the second was correctly refused as spent,
         * and the refused one is what redirected to `?error=session_failed`.
         * Signing in failed every time locally while being sound in production,
         * where StrictMode does not double-invoke.
         *
         * BOTH steps go inside the one promise, not just the redemption. The
         * code is single-use and so is the token hash it returns, so each has to
         * happen exactly once — deduplicating only the first would move the bug
         * rather than fix it, leaving two runs to call `verifyOtp` with the same
         * hash and the second to fail exactly as the second redemption did.
         *
         * It returns a verdict rather than navigating, so the navigation stays
         * with the run that is still live: a cancelled run must not redirect a
         * page that has already moved on.
         *
         * Not a dev-only workaround. A double-submit from any source — a retry,
         * a fast refresh, a browser replaying the navigation — spends the code
         * the same way.
         * ─────────────────────────────────────────────────────────────────────
         */
        const outcome = await requestDeduplicator.deduplicate(
          `auth-handoff:${code}`,
          async (): Promise<'signed-in' | 'refused'> => {
            const response = await fetch('/api/auth/handoff/redeem', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code }),
            });

            const body = await response.json().catch(() => null);

            if (!response.ok || !body?.success || !body.tokenHash) {
              logger.warn('Handoff code was refused');
              return 'refused';
            }

            const { error } = await supabase.auth.verifyOtp({
              token_hash: body.tokenHash,
              type: 'magiclink',
            });

            if (error) {
              logger.error({ err: error }, 'Could not establish the session from a handoff');
              return 'refused';
            }

            return 'signed-in';
          },
          60_000
        );

        if (cancelled) return;

        if (outcome === 'refused') {
          window.location.replace(marketingLoginUrl('?error=session_failed'));
          return;
        }

        /*
         * `/onboarding-chat` settles where to go next: it reads
         * `business_profiles.onboarding_completed` and sends an existing
         * business straight on to `/business-os`. Deciding that here would put
         * a second copy of the rule in the codebase.
         *
         * `replace`, not `assign`: this URL holds a spent code, and leaving it
         * in history invites a Back button onto a page that can only fail.
         */
        window.location.replace('/onboarding-chat');
      } catch (error) {
        logger.error({ err: error }, 'Handoff exchange threw');
        if (!cancelled) setFailed(true);
      }
    };

    exchange();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4" />
        <p className="text-sm text-slate-500">Signing you in…</p>

        {failed && (
          <p className="mt-6 text-sm text-slate-400">
            That did not work.{' '}
            <a href={marketingLoginUrl()} className="text-blue-500 underline">
              Try signing in again
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

/*
 * `useSearchParams` needs a Suspense boundary, or the whole route opts into
 * client-side rendering at build time and Next fails the page.
 */
export default function AuthHandoffPage() {
  return (
    <Suspense fallback={null}>
      <HandoffInner />
    </Suspense>
  );
}
