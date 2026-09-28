'use client';

/**
 * The public invite page (invite-only signup, Slice 0; FR-8 to FR-10, C-4, T-7).
 *
 * ── The token never touches a URL the server sees ───────────────────────────
 * The link is `/invite#t=<token>`. A fragment is never sent to a server, so it
 * cannot reach an access log. On first run this page reads the fragment, then
 * IMMEDIATELY replaces the address with plain `/invite` (D-11), before any
 * request is made, so the token also leaves the address bar and the current
 * history entry. The token is then POSTed in a JSON body, never in a query.
 *
 * ── What the page decides: nothing ──────────────────────────────────────────
 * The server returns the state, the language, the inviter's name, the note and
 * the offer. The page renders them in the INVITE's language (C-8), right to
 * left for Hebrew, and ignores the browser's language entirely.
 *
 * The personal note is rendered as text: React escapes it, and there is no
 * `dangerouslySetInnerHTML` anywhere on this path.
 *
 * Slice 0 has no signup form: a valid invite ends with the R-4 line saying
 * account creation is not available from here yet.
 *
 * ── Slice 1a ────────────────────────────────────────────────────────────────
 * `existing_account` (FR-8a): the invited email already has an account. The
 * page sends the person to the NORMAL sign-in page; it never signs anyone in
 * itself (BQ-7, "the link is never a credential").
 *
 * A signed-in visitor (requirement §4.3, L-8) on a `valid` or
 * `existing_account` invite is told who they are signed in as and asked to
 * sign out first. The offer is still shown, but nothing on the page invites
 * them to act as the signed-in account. This is display only; the Slice 1b
 * signup routes also refuse a session on the server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { marketingUrl } from '@/lib/utils/origins';

import { INVITE_PAGE_COPY, directionOf, inviteLocaleOf, type InviteLocale } from './invitePageCopy';
import { useSignedInVisitor } from './useSignedInVisitor';

type InviteAccess =
  | { kind: 'open_ended'; months: null }
  | { kind: 'months'; months: number }
  | { kind: 'while_paid'; months: null };

interface InviteOffer {
  planName: string;
  free: boolean;
  monthlyPriceUsd: number;
  access: InviteAccess;
  included: Array<{ category: string; label: string; summary: string }>;
}

type InviteResponse =
  | { state: 'not_recognised' }
  | {
      state: 'valid';
      language: string;
      inviterDisplayName: string;
      personalNote: string | null;
      linkExpiresAt: string;
      offer: InviteOffer;
    }
  | {
      state: 'existing_account' | 'expired' | 'revoked' | 'used' | 'unavailable';
      language: string;
      inviterDisplayName: string;
    };

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'result'; data: InviteResponse };

/** The token from a fragment such as `#t=abc`, or null. */
function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('t');
  return token && token.length > 0 ? token : null;
}

/** A calendar date in the invite's language, read in UTC like every entitlement date. */
function formatDate(iso: string, locale: InviteLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

export default function InvitePage() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const { visitor, signOut, signingOut } = useSignedInVisitor();
  // Held in memory only, so "try again" after a failed check needs no URL.
  const tokenRef = useRef<string | null>(null);
  // StrictMode runs effects twice in development; the fragment is gone after
  // the first run, so the second must not read it again.
  const started = useRef(false);

  const check = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      setView({ kind: 'result', data: { state: 'not_recognised' } });
      return;
    }

    setView({ kind: 'loading' });
    try {
      const response = await fetch('/api/public/invites/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success || !body.data) {
        setView({ kind: 'error' });
        return;
      }
      setView({ kind: 'result', data: body.data as InviteResponse });
    } catch {
      setView({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    tokenRef.current = tokenFromHash(window.location.hash);
    // D-11: the token leaves the address bar and this history entry BEFORE any
    // request is made.
    window.history.replaceState(null, '', '/invite');
    void check();
  }, [check]);

  const data = view.kind === 'result' ? view.data : null;
  const locale = inviteLocaleOf(data && data.state !== 'not_recognised' ? data.language : 'en');
  const copy = INVITE_PAGE_COPY[locale];
  // L-8: asked only where the page would otherwise lead somewhere.
  const showSignedInNotice =
    visitor.status === 'signed_in' && (data?.state === 'valid' || data?.state === 'existing_account');

  const handleSignOut = async () => {
    await signOut();
    // Re-ask the server as the signed-out visitor this now is.
    await check();
  };

  return (
    <main
      data-testid="invite-page"
      lang={locale}
      dir={directionOf(locale)}
      className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-12 text-slate-900"
    >
      <div className="w-full max-w-xl space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {view.kind === 'loading' && <p data-testid="invite-loading">{copy.loading}</p>}

        {view.kind === 'error' && (
          <div data-testid="invite-error" className="space-y-3">
            <p>{copy.errorHeading}</p>
            <button
              type="button"
              onClick={() => void check()}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              {copy.retry}
            </button>
          </div>
        )}

        {showSignedInNotice && visitor.status === 'signed_in' && (
          <section data-testid="invite-signed-in" className="space-y-3 rounded-lg bg-amber-50 p-4 text-amber-900">
            <h2 className="font-semibold">{copy.signedInHeading(visitor.email)}</h2>
            <p className="text-sm">{copy.signedInBody}</p>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {signingOut ? copy.signingOut : copy.signOut}
            </button>
          </section>
        )}

        {data?.state === 'existing_account' && (
          <section data-testid="invite-state-existing_account" className="space-y-3">
            <h1 className="text-xl font-semibold">{copy.existingAccountHeading}</h1>
            <p className="text-slate-600">{copy.existingAccountBody}</p>
            {/* QA-3: no Sign in button until the session check has answered, so a
                signed-in visitor never sees it flash before the notice. */}
            {visitor.status === 'signed_out' && (
              <a
                data-testid="invite-sign-in"
                href={marketingUrl('/login')}
                rel="noreferrer"
                className="inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                {copy.signIn}
              </a>
            )}
          </section>
        )}

        {data?.state === 'not_recognised' && (
          <section data-testid="invite-state-not_recognised" className="space-y-2">
            <h1 className="text-xl font-semibold">{copy.notRecognisedHeading}</h1>
            <p className="text-slate-600">{copy.notRecognisedBody}</p>
          </section>
        )}

        {data?.state === 'valid' && (
          <section data-testid="invite-state-valid" className="space-y-5">
            <h1 className="text-2xl font-semibold">{copy.validHeading(data.inviterDisplayName)}</h1>

            {data.personalNote && (
              <figure className="rounded-lg bg-slate-50 p-4">
                <figcaption className="mb-1 text-xs font-medium text-slate-500">
                  {copy.noteHeading(data.inviterDisplayName)}
                </figcaption>
                <blockquote data-testid="invite-note" className="whitespace-pre-line text-slate-800">
                  {data.personalNote}
                </blockquote>
              </figure>
            )}

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-500">{copy.offerHeading}</h2>
              <p data-testid="invite-plan" className="text-lg font-semibold">
                {data.offer.planName}
              </p>
              <p className="text-slate-700">
                {data.offer.free ? copy.free : copy.perMonth(data.offer.monthlyPriceUsd)}
                {' · '}
                {data.offer.access.kind === 'months'
                  ? copy.accessMonths(data.offer.access.months)
                  : data.offer.access.kind === 'while_paid'
                    ? copy.accessWhilePaid
                    : copy.accessOpenEnded}
              </p>
              {!data.offer.free && <p className="text-sm text-slate-600">{copy.paymentRequired}</p>}
            </div>

            {data.offer.included.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-slate-500">{copy.includedHeading}</h2>
                <ul className="space-y-1 text-sm text-slate-700">
                  {data.offer.included.map((row) => (
                    <li key={row.category}>
                      <span className="font-medium">{row.label}:</span> {row.summary}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-sm text-slate-600">{copy.linkExpires(formatDate(data.linkExpiresAt, locale))}</p>

            <p data-testid="invite-signup-not-yet" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {copy.signupNotYet(data.inviterDisplayName)}
            </p>
          </section>
        )}

        {data && (data.state === 'expired' || data.state === 'revoked' || data.state === 'unavailable') && (
          <section data-testid={`invite-state-${data.state}`} className="space-y-2">
            <h1 className="text-xl font-semibold">
              {data.state === 'expired'
                ? copy.expiredHeading
                : data.state === 'revoked'
                  ? copy.revokedHeading
                  : copy.unavailableHeading}
            </h1>
            <p className="text-slate-600">{copy.askForNew(data.inviterDisplayName)}</p>
          </section>
        )}

        {data?.state === 'used' && (
          <section data-testid="invite-state-used" className="space-y-3">
            <h1 className="text-xl font-semibold">{copy.usedHeading}</h1>
            <p className="text-slate-600">{copy.usedBody}</p>
            <a
              href={marketingUrl('/login')}
              rel="noreferrer"
              className="inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              {copy.signIn}
            </a>
          </section>
        )}
      </div>
    </main>
  );
}
