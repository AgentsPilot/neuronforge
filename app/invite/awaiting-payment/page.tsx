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
 *   held        → in the invite's own language, with Sign out, one of
 *                 (plan payments P-5a.2, `readHeldPaymentView`):
 *                   coming soon  any held-payment switch off: the message
 *                                above, unchanged (D5-3);
 *                   pay          "Finish your payment", the plan name, its
 *                                monthly price "excluding tax", and Pay;
 *                   processing   "Payment processing", no Pay, and a bounded
 *                                refresh (S5-6, W-7);
 *   error       → a neutral "try again", with Sign out. It NEVER redirects:
 *                 one failed read here must not release a friend the layout
 *                 just held.
 *
 * RELEASE (P5-C6): only the server re-read of the hold at the top of this page
 * lets a friend in (`not_held` → onboarding). The `?checkout=` marker Stripe's
 * return adds is pattern-checked and changes only what is shown.
 *
 * Imports nothing from the entitlements module: the plan name and price come
 * as data from `heldPaymentView.ts`, the registered importer (P5-C11).
 *
 * Referrer-Policy (P5-F4, workplan G-2): `no-referrer` here and in middleware.
 * If the live check shows Stripe's embedded checkout does not render under it,
 * the SA-pre-approved fallback is `strict-origin` for THIS path only, changed
 * together in two places: the `referrer` in this page's `metadata` below (it
 * overrides the segment layout's), and the header set in the `/invite` branch
 * of `middleware.ts`, narrowed to `pathname === AWAITING_PAYMENT_PATH`. The
 * rest of `/invite/*` keeps `no-referrer`.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AlertTriangle, CreditCard, Hourglass, LogIn } from 'lucide-react';

import { isCheckoutReturnMarker } from '@/lib/business-os/billing/checkoutReturnMarker';
import { readHeldPaymentView, type HeldPaymentView } from '@/lib/business-os/billing/heldPaymentView';
import { AWAITING_PAYMENT_PATH } from '@/lib/business-os/invites/paymentHold';
import { readHoldForSession } from '@/lib/business-os/invites/paymentHoldGate';
import { marketingUrl } from '@/lib/utils/origins';

import { awaitingPaymentCopyFor } from '../awaitingPaymentCopy';
import { INVITE_PRIMARY_BUTTON, InviteShell, InviteStateIcon } from '../InviteShell';
import { HeldPaymentCheckout } from './HeldPaymentCheckout';
import { PaymentProcessingRefresher } from './PaymentProcessingRefresher';
import { SignOutButton } from './SignOutButton';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AgentPilot',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/** `$79`: the tier matrix price is whole US dollars (BQ-P5: shown "excluding tax"). */
function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

export default async function AwaitingPaymentPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
} = {}) {
  const hold = await readHoldForSession();

  // Outside any try/catch: `redirect` throws NEXT_REDIRECT on purpose.
  if (hold.state === 'not_held') redirect('/onboarding-chat');

  // Display only (P5-C6): a malformed or repeated value is ignored.
  const checkoutReturned = isCheckoutReturnMarker(searchParams?.checkout);
  const view: HeldPaymentView | null =
    hold.state === 'held'
      ? await readHeldPaymentView({
          userId: hold.userId,
          accountId: hold.accountId,
          hold: hold.hold,
          language: hold.language,
          checkoutReturned,
        })
      : null;

  const { locale, copy } = awaitingPaymentCopyFor(hold.state === 'held' ? hold.language : 'en');
  const signInUrl = marketingUrl('/login');
  const dir: 'ltr' | 'rtl' = locale === 'he' ? 'rtl' : 'ltr';
  const signOut = (
    <SignOutButton label={copy.signOut} busyLabel={copy.signingOut} failedLabel={copy.signOutFailed} signInUrl={signInUrl} />
  );
  const [priceBefore, priceAfter = ''] = copy.payPrice.split('{price}');

  return (
    <InviteShell locale={locale} dir={dir}>
      <section data-testid={`awaiting-payment-${hold.state}`} className="space-y-4">
        {view?.kind === 'pay' ? (
          <div data-testid="awaiting-payment-pay" className="space-y-4">
            <InviteStateIcon tone="brand">
              <CreditCard className="h-6 w-6" />
            </InviteStateIcon>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{copy.payTitle}</h1>
            <p className="text-base leading-relaxed text-slate-700">{copy.payBody}</p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{copy.payPlanLabel}</p>
              <p data-testid="awaiting-payment-plan" className="text-lg font-semibold text-slate-900">
                {view.planName}
              </p>
              <p data-testid="awaiting-payment-price" className="text-sm text-slate-700">
                {priceBefore}
                <bdi dir="ltr">{formatUsd(view.monthlyPriceUsd)}</bdi>
                {priceAfter}
              </p>
            </div>
            <HeldPaymentCheckout tier={view.tier} locale={locale} copy={copy} returnPath={AWAITING_PAYMENT_PATH} />
            <div className="pt-2">{signOut}</div>
          </div>
        ) : null}

        {view?.kind === 'processing' ? (
          <div data-testid="awaiting-payment-processing" className="space-y-4">
            <InviteStateIcon tone="brand">
              <Hourglass className="h-6 w-6" />
            </InviteStateIcon>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{copy.processingTitle}</h1>
            <p className="text-base leading-relaxed text-slate-700">{copy.processingBody}</p>
            <PaymentProcessingRefresher
              delay={view.delay}
              markerOnly={view.markerOnly}
              slowLabel={copy.processingSlow}
              checkAgainLabel={copy.processingCheckAgain}
              checkAgainHref={AWAITING_PAYMENT_PATH}
            />
            <div className="pt-2">{signOut}</div>
          </div>
        ) : null}

        {view?.kind === 'coming_soon' ? (
          <>
            <InviteStateIcon tone="brand">
              <Hourglass className="h-6 w-6" />
            </InviteStateIcon>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{copy.title}</p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{copy.heldHeading}</h1>
            <p className="text-base leading-relaxed text-slate-700">{copy.heldBody}</p>
            <p className="text-base leading-relaxed text-slate-700">{copy.heldLater}</p>
            <div className="pt-2">{signOut}</div>
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
              {signOut}
            </div>
          </>
        ) : null}
      </section>
    </InviteShell>
  );
}
