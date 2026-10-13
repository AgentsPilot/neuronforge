'use client';

/**
 * The holding screen's Pay button (plan payments P-5a.2; workplan §3.3; SA
 * S5-6, Q-8).
 *
 * A thin island over the shared `PlanEmbeddedCheckout`: the invite-styled
 * button and copy, `returnTo: 'awaiting_payment'`, and the tier the server
 * page received from `heldPaymentOffer` (passed in as data; this file imports
 * nothing from the entitlements module).
 *
 * After Stripe's `onComplete` (card only, so no redirect), it replaces the URL
 * with the return marker (`?checkout=<session id>`). The server page then
 * renders "Payment processing" and the refresher takes over. The marker only
 * changes what is shown; the server's re-read of the hold is the only release
 * (P5-C6).
 *
 * A refused start shows a localized line keyed on the route's `code`, never
 * the server's English message (Q-8, W-10). A declined card stays inside
 * Stripe's form: nothing is recorded, and the friend can try again (BQ-8).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { PlanEmbeddedCheckout } from '@/components/business-os/billing/PlanEmbeddedCheckout';

import { heldPaymentRefusalMessage, type AwaitingPaymentCopy } from '../awaitingPaymentCopy';
import { INVITE_PRIMARY_BUTTON } from '../InviteShell';

export function HeldPaymentCheckout({
  tier,
  locale,
  copy,
  returnPath,
}: {
  tier: string;
  locale: string;
  copy: AwaitingPaymentCopy;
  /** The holding screen's own path, without a marker. */
  returnPath: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const formatTime = (iso: string): string | null => {
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return null;
    // The visitor's own clock and the invite's language.
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(at));
  };

  return (
    <div className="space-y-3">
      <PlanEmbeddedCheckout
        tier={tier}
        returnTo="awaiting_payment"
        labels={{ start: copy.payButton, starting: copy.payStarting, notConfigured: copy.payNotConfigured }}
        buttonClassName={INVITE_PRIMARY_BUTTON}
        frameClassName="rounded-xl border border-slate-200 p-2"
        testId="awaiting-payment-checkout"
        onRequest={() => setMessage(null)}
        onRefused={(refusal) => setMessage(heldPaymentRefusalMessage(copy, refusal, formatTime))}
        onRequestFailed={() => setMessage(copy.refusalGeneric)}
        onComplete={(sessionId) => router.replace(`${returnPath}?checkout=${encodeURIComponent(sessionId)}`)}
      />
      {message ? (
        <p role="alert" data-testid="awaiting-payment-refused" className="text-sm text-red-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}
