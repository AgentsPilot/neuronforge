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

import { readHoldForSession } from '@/lib/business-os/invites/paymentHoldGate';
import { marketingUrl } from '@/lib/utils/origins';

import { awaitingPaymentCopyFor } from '../awaitingPaymentCopy';
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
  const dir = locale === 'he' ? 'rtl' : 'ltr';

  return (
    <main dir={dir} lang={locale} className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <section
        data-testid={`awaiting-payment-${hold.state}`}
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm"
      >
        {hold.state === 'held' ? (
          <>
            <p className="mb-2 text-sm font-medium text-gray-500">{copy.title}</p>
            <h1 className="mb-4 text-2xl font-semibold text-gray-900">{copy.heldHeading}</h1>
            <p className="mb-2 text-base leading-relaxed text-gray-700">{copy.heldBody}</p>
            <p className="mb-6 text-base leading-relaxed text-gray-700">{copy.heldLater}</p>
            <SignOutButton label={copy.signOut} busyLabel={copy.signingOut} failedLabel={copy.signOutFailed} signInUrl={signInUrl} />
          </>
        ) : null}

        {hold.state === 'signed_out' ? (
          <>
            <h1 className="mb-4 text-2xl font-semibold text-gray-900">{copy.signedOutHeading}</h1>
            <p className="mb-6 text-base leading-relaxed text-gray-700">{copy.signedOutBody}</p>
            <a
              data-testid="awaiting-payment-sign-in"
              href={signInUrl}
              className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              {copy.signIn}
            </a>
          </>
        ) : null}

        {hold.state === 'error' ? (
          <>
            <h1 className="mb-4 text-2xl font-semibold text-gray-900">{copy.errorHeading}</h1>
            <p className="mb-6 text-base leading-relaxed text-gray-700">{copy.errorBody}</p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                data-testid="awaiting-payment-try-again"
                href="/invite/awaiting-payment"
                className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                {copy.tryAgain}
              </a>
              <SignOutButton label={copy.signOut} busyLabel={copy.signingOut} failedLabel={copy.signOutFailed} signInUrl={signInUrl} />
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
