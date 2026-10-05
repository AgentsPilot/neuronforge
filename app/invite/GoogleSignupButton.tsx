'use client';

/**
 * "Continue with Google" on a valid champion invite (invite-only signup,
 * Slice 3b; FR-11, FR-13, D-1, D-9, D-10, SA R-2, R-8).
 *
 * Rendered by the invite page ABOVE the code form, only for a signed-out
 * visitor, and only when `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` is set (D-9).
 *
 *   1. Google's own button (popup; no One Tap). Closing the popup does nothing:
 *      no request, no spinner. The busy state starts only when a credential
 *      arrives (D-10).
 *   2. POST /api/public/invites/signup/google { token, idToken, nonce }. The
 *      server verifies the token, checks the address against the invite, and
 *      claims, creates and finalises exactly as the code path does.
 *   3. On success the browser signs in with the SAME token through Supabase
 *      (`signInWithGoogleIdToken`), which links the Google identity. The server
 *      minted no session (D-1). Then onboarding.
 *   4. If that sign-in fails, the account still exists and is complete: the
 *      page says so and links to the normal sign-in page.
 *
 * Every refusal is keyed by the server's machine-readable code, in the
 * invite's language, and points to the emailed code as the way through (R-8).
 * The ID token and the nonce live in memory only and are never put in a URL,
 * storage or a log.
 */

import { useCallback, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';

import { signInWithGoogleIdToken } from '@/lib/client/auth-actions';
import { marketingUrl } from '@/lib/utils/origins';

import { INVITE_PRIMARY_BUTTON } from './InviteShell';
import type { InviteLocale, SignupCopy } from './invitePageCopy';
import { GOOGLE_IDENTITY_SCRIPT_SRC, useGoogleIdentity, type GoogleCredential } from './useGoogleIdentity';

interface ApiBody {
  success?: boolean;
  error?: string;
  data?: { redirectTo?: string; state?: string };
}

export interface GoogleSignupButtonProps {
  token: string;
  clientId: string;
  locale: InviteLocale;
  maskedEmail: string;
  copy: SignupCopy;
  /** The page's own "Sign in" label, for the fallback link. */
  signInLabel: string;
  /** The account now exists: the page hides the code form (the invite is used). */
  onAccountReady: () => void;
}

/** The message for a server answer, in the invite's language. */
function messageFor(body: ApiBody | null, copy: SignupCopy, maskedEmail: string): string {
  const google = copy.google.errors;
  const errors = copy.errors;
  if (body?.data?.state === 'not_recognised') return errors.no_longer_available;
  switch (body?.error) {
    case 'google_email_mismatch':
      return google.google_email_mismatch(maskedEmail);
    case 'google_email_unverified':
    case 'google_use_code':
    case 'google_token_invalid':
      return google[body.error];
    case 'existing_account':
    case 'signup_in_progress':
    case 'signed_in':
      return errors[body.error];
    case 'used':
    case 'revoked':
    case 'expired':
    case 'unavailable':
    case 'paid_invites_not_available':
      return errors.no_longer_available;
    default:
      return errors.generic;
  }
}

export function GoogleSignupButton({ token, clientId, locale, maskedEmail, copy, signInLabel, onAccountReady }: GoogleSignupButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // A second credential while one is in flight is ignored.
  const inFlight = useRef(false);

  const onCredential = useCallback(
    async ({ idToken, rawNonce }: GoogleCredential) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const response = await fetch('/api/public/invites/signup/google', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, idToken, nonce: rawNonce }),
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
        const body = (await response.json().catch(() => null)) as ApiBody | null;
        const redirectTo = body?.data?.redirectTo;
        if (response.status !== 200 || !body?.success || !redirectTo) {
          setError(messageFor(body, copy, maskedEmail));
          return;
        }

        // D-1: the browser signs in with the same token. The server minted no session.
        const signedIn = await signInWithGoogleIdToken(idToken, rawNonce);
        if (signedIn.ok) {
          router.replace(redirectTo);
          return;
        }
        setReady(true);
        onAccountReady();
      } catch {
        setError(copy.errors.generic);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [token, copy, maskedEmail, router, onAccountReady]
  );

  const identity = useGoogleIdentity({
    clientId,
    locale,
    onCredential: (credential) => void onCredential(credential),
  });

  if (ready) {
    return (
      <section data-testid="invite-google-ready" className="space-y-3">
        <h2 className="text-lg font-semibold text-emerald-800">{copy.google.readyHeading}</h2>
        <p className="text-sm text-slate-600">{copy.google.readyBody}</p>
        <a
          href={marketingUrl('/login')}
          rel="noreferrer"
          className={INVITE_PRIMARY_BUTTON}
        >
          {signInLabel}
        </a>
      </section>
    );
  }

  // D-10: a script that did not load leaves nothing behind; the code form remains.
  if (identity.failed) return null;

  return (
    <section data-testid="invite-google" className="space-y-3">
      <Script
        id="google-identity-services"
        src={GOOGLE_IDENTITY_SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={identity.onScriptReady}
        onError={identity.onScriptError}
      />
      <div data-testid="invite-google-button" ref={identity.containerRef} aria-busy={busy} className="min-h-[44px]" />
      {busy && (
        <p data-testid="invite-google-busy" className="text-sm text-slate-600">
          {copy.google.creating}
        </p>
      )}
      {/* Always mounted (a live region must exist before its text does); visually hidden while empty. */}
      <p
        data-testid="invite-google-error"
        role="alert"
        aria-live="polite"
        className={error ? 'rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700' : 'sr-only'}
      >
        {error}
      </p>
      {identity.rendered && (
        <div className="flex items-center gap-3 text-xs uppercase text-slate-500" aria-hidden="true">
          <span className="h-px flex-1 bg-slate-200" />
          {copy.google.divider}
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      )}
    </section>
  );
}
