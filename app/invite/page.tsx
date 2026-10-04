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
 * Slice 1b: a valid invite ends with the signup form (`SignupForm.tsx`) for a
 * signed-out visitor. The Slice 0 "not from this page yet" line is gone.
 *
 * Slice 3b: above that form, "Continue with Google" (`GoogleSignupButton.tsx`),
 * only when `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` is set (D-9). Unset, the page
 * loads no Google script and shows no button. Once a Google signup has created
 * the account, the code form is hidden: the invite is used.
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
 *
 * ── Slice 5b ────────────────────────────────────────────────────────────────
 * A champion's friend invite is `valid`, with the signup form and the Google
 * button (FR-34). Under a PAID offer the page adds one honest line: the
 * account can be created now, and payment opens later (workplan D-11). After
 * signup the server sends the friend to the payment hold (FR-35). The 5a
 * `signup_opens_soon` state is gone (SA Q-8).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Link as LinkIcon,
  Loader2,
  Sparkles,
  UserCheck,
} from 'lucide-react';

import { googleSignInClientId } from '@/lib/business-os/invites/googleSignInConfig';
import { planCategoryLine } from '@/lib/business-os/planCategoryLine';
import { marketingUrl } from '@/lib/utils/origins';

import { GoogleSignupButton } from './GoogleSignupButton';
import { INVITE_PRIMARY_BUTTON, INVITE_SECONDARY_BUTTON, InviteShell, InviteStateIcon } from './InviteShell';
import {
  INVITE_PAGE_COPY,
  directionOf,
  inviteLocaleOf,
  type InviteLocale,
  type InvitePageCopy as InvitePageCopyShape,
} from './invitePageCopy';
import { SignupForm } from './SignupForm';
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
  /**
   * `noteKey`: the sentence under the row (credits only today), worded by `copy.planCategoryNote`.
   * `features`: name and value per feature, for `planCategoryLine` (a row whose only
   * feature is named like its heading prints the value alone). Optional: a body
   * without it prints the summary, as before.
   */
  included: Array<{
    category: string;
    labelKey: string;
    noteKey: string | null;
    features?: Array<{ label: string; value: string }>;
    summary: string;
  }>;
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
      /** Slice 1b (R-6): the invited address, masked. The full email arrives only after signup. */
      maskedEmail: string;
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

/** What `valid` shows above the form: who invited, the note, the offer and the expiry. */
type OfferState = Extract<InviteResponse, { state: 'valid' }>;

function InviteOfferDetails({ data, copy, locale }: { data: OfferState; copy: InvitePageCopyShape; locale: InviteLocale }) {
  return (
    <>
      <div className="space-y-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {copy.eyebrow}
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{copy.validHeading(data.inviterDisplayName)}</h1>
      </div>

      {data.personalNote && (
        <figure className="rounded-e-lg border-s-4 border-indigo-500 bg-slate-50 px-4 py-3">
          <figcaption className="mb-1 text-xs font-semibold text-slate-500">
            {copy.noteHeading(data.inviterDisplayName)}
          </figcaption>
          <blockquote data-testid="invite-note" className="whitespace-pre-line text-slate-800">
            {data.personalNote}
          </blockquote>
        </figure>
      )}

      <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-5">
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{copy.offerHeading}</h2>
          <p data-testid="invite-plan" className="text-xl font-bold text-slate-900">
            {data.offer.planName}
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-white px-2.5 py-0.5 font-medium text-indigo-700 ring-1 ring-indigo-200">
              {data.offer.free ? copy.free : copy.perMonth(data.offer.monthlyPriceUsd)}
            </span>
            <span className="rounded-full bg-white px-2.5 py-0.5 font-medium text-slate-700 ring-1 ring-slate-200">
              {data.offer.access.kind === 'months'
                ? copy.accessMonths(data.offer.access.months)
                : data.offer.access.kind === 'while_paid'
                  ? copy.accessWhilePaid
                  : copy.accessOpenEnded}
            </span>
          </div>
          {/*
            SA CR-1 (Slice 5b): no "Payment is required at signup" here. While
            payment is not live, the only paid offer that reaches `valid` is a
            champion's friend invite (admin Paid invites are refused until 5c),
            and it gets ONE payment statement, `paymentOpensLater`, under the
            offer. 5c brings `copy.paymentRequired` back when checkout exists.
          */}
        </div>

        {data.offer.included.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-indigo-100 pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{copy.includedHeading}</h2>
            <ul className="space-y-2 text-sm text-slate-700">
              {data.offer.included.map((row) => {
                /*
                  `describePlanOffer` names the heading, it does not word
                  it. Falls back to the raw key rather than hiding the
                  row: a missing heading should be visible and fixable,
                  not silently drop something the invite is offering.
                */
                const heading = copy.planCategory[row.labelKey] ?? row.labelKey;
                // "Credits: 19,750 per month", never "Credits: Credits (…)"
                // (user decision, 2026-10-02). `null` = the heading says it all.
                const line = planCategoryLine(heading, row);
                return (
                  <li key={row.category} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
                    <div>
                      <span className="font-medium text-slate-900">
                        {heading}
                        {line !== null && ':'}
                      </span>
                      {line !== null && <>{' '}{line}</>}
                      {/*
                        Credit deduction slice 6 (D-h): what a credit is, under the
                        credits row, monthly or one-off by the allowance's shape —
                        chosen server-side. A key this page has no words for shows
                        nothing rather than a raw key to a prospect; a test holds
                        that every key the module can name is worded here.
                      */}
                      {row.noteKey && copy.planCategoryNote[row.noteKey] && (
                        <p className="mt-0.5 text-xs text-slate-500" data-testid={`invite-category-note-${row.category}`}>
                          {copy.planCategoryNote[row.noteKey]}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <p className="flex items-center gap-2 text-sm text-slate-600">
        <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        {copy.linkExpires(formatDate(data.linkExpiresAt, locale))}
      </p>
    </>
  );
}

export default function InvitePage() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const { visitor, signOut, signingOut } = useSignedInVisitor();
  // Slice 3b (D-9): null unless the dedicated Google client id is configured.
  const googleClientId = googleSignInClientId();
  // Slice 3b: a Google signup created the account; the code form no longer applies.
  const [googleAccountReady, setGoogleAccountReady] = useState(false);
  const markGoogleAccountReady = useCallback(() => setGoogleAccountReady(true), []);
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
    <InviteShell testId="invite-page" locale={locale} dir={directionOf(locale)}>
      {view.kind === 'loading' && (
        <p data-testid="invite-loading" className="flex items-center gap-2 text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-600" aria-hidden="true" />
          {copy.loading}
        </p>
      )}

      {view.kind === 'error' && (
        <div data-testid="invite-error" className="space-y-4">
          <InviteStateIcon tone="warning">
            <AlertTriangle className="h-6 w-6" />
          </InviteStateIcon>
          <p className="text-slate-700">{copy.errorHeading}</p>
          <button type="button" onClick={() => void check()} className={INVITE_PRIMARY_BUTTON}>
            {copy.retry}
          </button>
        </div>
      )}

      {showSignedInNotice && visitor.status === 'signed_in' && (
        <section data-testid="invite-signed-in" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <h2 className="font-semibold">{copy.signedInHeading(visitor.email)}</h2>
          <p className="text-sm">{copy.signedInBody}</p>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className={INVITE_SECONDARY_BUTTON}
          >
            {signingOut ? copy.signingOut : copy.signOut}
          </button>
        </section>
      )}

      {data?.state === 'existing_account' && (
        <section data-testid="invite-state-existing_account" className="space-y-4">
          <InviteStateIcon tone="brand">
            <UserCheck className="h-6 w-6" />
          </InviteStateIcon>
          <h1 className="text-2xl font-bold tracking-tight">{copy.existingAccountHeading}</h1>
          <p className="text-slate-600">{copy.existingAccountBody}</p>
          {/* QA-3: no Sign in button until the session check has answered, so a
              signed-in visitor never sees it flash before the notice. */}
          {visitor.status === 'signed_out' && (
            <a data-testid="invite-sign-in" href={marketingUrl('/login')} rel="noreferrer" className={INVITE_PRIMARY_BUTTON}>
              {copy.signIn}
            </a>
          )}
        </section>
      )}

      {data?.state === 'not_recognised' && (
        <section data-testid="invite-state-not_recognised" className="space-y-4">
          <InviteStateIcon tone="neutral">
            <LinkIcon className="h-6 w-6" />
          </InviteStateIcon>
          <h1 className="text-2xl font-bold tracking-tight">{copy.notRecognisedHeading}</h1>
          <p className="text-slate-600">{copy.notRecognisedBody}</p>
        </section>
      )}

      {data?.state === 'valid' && (
        <section data-testid="invite-state-valid" className="space-y-6">
          <InviteOfferDetails data={data} copy={copy} locale={locale} />

          {/* Slice 5b (D-11): a paid offer, while payment is not live. */}
          {!data.offer.free && (
            <p data-testid="invite-payment-opens-later" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {copy.paymentOpensLater}
            </p>
          )}

          {/* Slice 1b: the form, only for a visitor the session check says is
              signed out (L-8). A signed-in visitor sees the notice above. */}
          {visitor.status === 'signed_out' && tokenRef.current && (
            <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              {googleClientId && (
                <GoogleSignupButton
                  token={tokenRef.current}
                  clientId={googleClientId}
                  locale={locale}
                  maskedEmail={data.maskedEmail}
                  copy={copy.signup}
                  signInLabel={copy.signIn}
                  onAccountReady={markGoogleAccountReady}
                />
              )}
              {!googleAccountReady && (
                <SignupForm
                  token={tokenRef.current}
                  maskedEmail={data.maskedEmail}
                  copy={copy.signup}
                  signInLabel={copy.signIn}
                />
              )}
            </div>
          )}
        </section>
      )}

      {data && (data.state === 'expired' || data.state === 'revoked' || data.state === 'unavailable') && (
        <section data-testid={`invite-state-${data.state}`} className="space-y-4">
          <InviteStateIcon tone="warning">
            <Clock className="h-6 w-6" />
          </InviteStateIcon>
          <h1 className="text-2xl font-bold tracking-tight">
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
        <section data-testid="invite-state-used" className="space-y-4">
          <InviteStateIcon tone="success">
            <CheckCircle2 className="h-6 w-6" />
          </InviteStateIcon>
          <h1 className="text-2xl font-bold tracking-tight">{copy.usedHeading}</h1>
          <p className="text-slate-600">{copy.usedBody}</p>
          <a href={marketingUrl('/login')} rel="noreferrer" className={INVITE_PRIMARY_BUTTON}>
            {copy.signIn}
          </a>
        </section>
      )}
    </InviteShell>
  );
}
