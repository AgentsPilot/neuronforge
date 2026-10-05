/**
 * The holding screen: "payment coming soon" (invite-only signup Slice 5b;
 * FR-24, FR-35, BQ-13; T-13 layer 2; workplan D-10; SA Q-4, R-4).
 *
 *   /invite/awaiting-payment
 *
 * Where a champion's friend lands after signing up, and where the four gated
 * layouts send them while they have not paid. Until 5c there is NO checkout,
 * NO price, NO plan name and NO promise of an email: payment does not exist
 * yet, and there are no reminders (FR-24).
 *
 * Under `/invite/*` on purpose (SA Q-4): middleware lets it straight through
 * (no onboarding redirect, so no loop), with `Referrer-Policy: no-referrer`,
 * and the segment layout adds `noindex`.
 *
 * States (SA R-4):
 *   signed out  → a sign-in link, nothing else;
 *   not held    → redirect to onboarding (nobody else belongs here);
 *   held        → the message, in the invite's own language, and Sign out;
 *   error       → a neutral "try again", with Sign out. It NEVER redirects:
 *                 one failed read here must not release a friend the layout
 *                 just held.
 *
 * Imports nothing from the entitlements module.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AlertTriangle, Hourglass, LogIn } from 'lucide-react';

import { readHoldForSession } from '@/lib/business-os/invites/paymentHoldGate';
import { marketingUrl } from '@/lib/utils/origins';

import { awaitingPaymentCopyFor } from '../awaitingPaymentCopy';
import { INVITE_PRIMARY_BUTTON, InviteShell, InviteStateIcon } from '../InviteShell';
import { SignOutButton } from './SignOutButton';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AgentPilot',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function AwaitingPaymentPage() {
  const hold = await readHoldForSession();

  // Outside any try/catch: `redirect` throws NEXT_REDIRECT on purpose.
  if (hold.state === 'not_held') redirect('/onboarding-chat');

  const { locale, copy } = awaitingPaymentCopyFor(hold.state === 'held' ? hold.language : 'en');
  const signInUrl = marketingUrl('/login');
  const dir: 'ltr' | 'rtl' = locale === 'he' ? 'rtl' : 'ltr';

  return (
    <InviteShell locale={locale} dir={dir}>
      <section data-testid={`awaiting-payment-${hold.state}`} className="space-y-4">
        {hold.state === 'held' ? (
          <>
            <InviteStateIcon tone="brand">
              <Hourglass className="h-6 w-6" />
            </InviteStateIcon>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{copy.title}</p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{copy.heldHeading}</h1>
            <p className="text-base leading-relaxed text-slate-700">{copy.heldBody}</p>
            <p className="text-base leading-relaxed text-slate-700">{copy.heldLater}</p>
            <div className="pt-2">
              <SignOutButton label={copy.signOut} busyLabel={copy.signingOut} failedLabel={copy.signOutFailed} signInUrl={signInUrl} />
            </div>
          </>
        ) : null}

        {hold.state === 'signed_out' ? (
          <>
            <InviteStateIcon tone="neutral">
              <LogIn className="h-6 w-6" />
            </InviteStateIcon>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{copy.signedOutHeading}</h1>
            <p className="text-base leading-relaxed text-slate-700">{copy.signedOutBody}</p>
            <a data-testid="awaiting-payment-sign-in" href={signInUrl} className={INVITE_PRIMARY_BUTTON}>
              {copy.signIn}
            </a>
          </>
        ) : null}

        {hold.state === 'error' ? (
          <>
            <InviteStateIcon tone="warning">
              <AlertTriangle className="h-6 w-6" />
            </InviteStateIcon>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{copy.errorHeading}</h1>
            <p className="text-base leading-relaxed text-slate-700">{copy.errorBody}</p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a data-testid="awaiting-payment-try-again" href="/invite/awaiting-payment" className={INVITE_PRIMARY_BUTTON}>
                {copy.tryAgain}
              </a>
              <SignOutButton label={copy.signOut} busyLabel={copy.signingOut} failedLabel={copy.signOutFailed} signInUrl={signInUrl} />
            </div>
          </>
        ) : null}
      </section>
    </InviteShell>
  );
}
