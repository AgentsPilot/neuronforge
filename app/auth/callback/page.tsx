'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { marketingLoginUrl } from '@/lib/utils/marketingUrl';
import { safeNextPath } from '@/lib/utils/safeNextPath';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'AuthCallback' });

/*
 * Every "please try logging in" below crosses an origin: sign-in is a page on
 * the marketing site, not a route in this app. `router.push('/login')` used to
 * land people on a 404 three seconds after being told what went wrong.
 *
 * `?next=<path>` asks to come back to a particular page instead of the default
 * landing spot. Whoever starts the sign-in sets it — the Business OS test
 * harness does, so a persona switch returns to the harness rather than dumping
 * the tester on `/business-os`. It is read from `window.location.search` rather
 * than `useSearchParams` so this page needs no Suspense boundary, and it is
 * validated by `safeNextPath` because an unchecked redirect target read from
 * the URL is an open redirect: a real sign-in, on a real link, ending on
 * someone else's page.
 *
 * It only ever overrides the ALREADY-ONBOARDED destination. Someone who has not
 * finished onboarding still goes to `/onboarding-chat`; a query parameter must
 * not be a way around it.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'verifying' | 'redirecting' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      try {
        logger.info('Auth callback started');
        setStatus('verifying');

        const { data, error } = await supabase.auth.getSession();

        /*
         * Whether there is a session, never the session itself. The line this
         * replaced was `console.log('Session data:', data)`, which printed the
         * access and refresh tokens into the browser console in full.
         */
        logger.debug({ hasSession: !!data.session }, 'Session resolved');

        if (error) {
          logger.error({ err: error }, 'Failed to read session');
          setStatus('error');
          setErrorMessage('Failed to verify email. Please try logging in.');
          setTimeout(() => { window.location.href = marketingLoginUrl('?error=verification_failed'); }, 3000);
          return;
        }

        const user = data.session?.user;

        if (!user) {
          logger.error('No user in session');
          setStatus('error');
          setErrorMessage('No active session found. Please try logging in.');
          setTimeout(() => { window.location.href = marketingLoginUrl('?error=no_session'); }, 3000);
          return;
        }

        logger.info({ userId: user.id, createdAt: user.created_at }, 'User resolved from session');

        /*
         * No "ensure the profile row exists" step here any more, and none is
         * needed: `create_user_settings_trigger` on `auth.users` (AFTER INSERT,
         * FOR EACH ROW) inserts `public.profiles (id) … ON CONFLICT DO NOTHING`
         * inside the signup transaction. The row exists before this page can
         * run, which is also why the block that used to be here never fired.
         *
         * It was a client component reading and writing `profiles` directly —
         * against Mandatory Rule 1 — and it could not be pointed at a
         * repository, because repositories are server-only. The database was
         * already doing the job, transactionally and without a race between two
         * tabs finishing the callback at once.
         *
         * What it appeared to add, it did not: `full_name` from OAuth metadata
         * was only written on the branch that never ran, and every reader
         * (`lib/user-context/builders.ts`, the onboarding hook) already falls
         * back to auth metadata. It also wrote `role: 'user'`, which is not a
         * value that column takes — `profiles.role` holds an onboarding PERSONA
         * (business_owner, consultant, …), and the literal "user" would have
         * been fed to LLM personalization as if it meant something.
         *
         * The one dependency this creates: the trigger lives in the Supabase
         * project, not in `supabase/migrations/`. A new environment needs it
         * codified, or it will have no profile-creation path at all.
         */

        // Check onboarding status from user metadata
        const onboardingCompleted = user.user_metadata?.onboarding_completed;

        logger.debug({ userId: user.id, onboardingCompleted }, 'Onboarding status read');

        // AUDIT TRAIL: Log OAuth login
        try {
          const provider = user.app_metadata?.provider || 'unknown';
          await fetch('/api/audit/log', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id
            },
            body: JSON.stringify({
              action: 'USER_LOGIN',
              entityType: 'user',
              entityId: user.id,
              userId: user.id,
              resourceName: user.email || 'Unknown',
              details: {
                email: user.email,
                timestamp: new Date().toISOString(),
                login_method: 'oauth',
                provider: provider
              },
              severity: 'info',
              complianceFlags: ['SOC2']
            })
          });
        } catch (auditError) {
          logger.error({ err: auditError, userId: user.id }, 'Login audit failed (non-blocking)');
        }

        setStatus('redirecting');

        if (onboardingCompleted === false || onboardingCompleted === undefined) {
          // User hasn't completed onboarding - redirect to onboarding
          logger.info({ userId: user.id }, 'Onboarding incomplete — redirecting to /onboarding-chat');
          setTimeout(() => router.push('/onboarding-chat'), 1000);
        } else {
          /*
           * `/business-os`, not `/dashboard`.
           *
           * While the V2 rewrite was in place this landed on `/v2/dashboard` —
           * the old interface. With the rewrite gone it would have resolved to
           * the older one still. Business OS is the product, and it is where
           * `/onboarding-chat` sends a business that has already onboarded.
           *
           * A valid `?next=` takes precedence; an invalid one is ignored and
           * lands here, which is the safe direction to fail in.
           */
          const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
          const destination = next || '/business-os';
          logger.info({ userId: user.id, destination }, 'Onboarding complete — redirecting');
          setTimeout(() => router.push(destination), 1000);
        }
      } catch (err) {
        logger.error({ err }, 'Unexpected error in auth callback');
        setStatus('error');
        setErrorMessage('An unexpected error occurred. Please try logging in.');
        setTimeout(() => { window.location.href = marketingLoginUrl(); }, 3000);
      }
    }

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
      <div className="text-center">
        {status === 'verifying' && (
          <>
            <div className="w-12 h-12 mx-auto mb-4">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <p className="text-lg">Verifying your email...</p>
          </>
        )}
        {status === 'redirecting' && (
          <>
            <div className="w-12 h-12 mx-auto mb-4">
              <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg">Success! Redirecting...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-12 h-12 mx-auto mb-4">
              <svg className="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-lg text-red-400">{errorMessage}</p>
            <p className="text-sm text-slate-400 mt-2">Redirecting to login...</p>
          </>
        )}
      </div>
    </div>
  );
}