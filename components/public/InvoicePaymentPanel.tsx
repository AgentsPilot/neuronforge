'use client';

import { useEffect, useState } from 'react';

import { StripePaymentForm } from '@/components/website/blocks/StripePaymentForm';
import type { Locale } from '@/lib/i18n/config';
import { publicT } from '@/lib/i18n/public-pages';

interface InvoicePaymentPanelProps {
  invoiceId: string;
  locale: Locale;
  isRTL: boolean;
  /** The brand colour the Payment Element is themed with. */
  primaryColor: string;
  borderRadius?: string;
  /** Where to send the client once Stripe says the payment went through. */
  successUrl: string;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; clientSecret: string; connectedAccountId: string; publishableKey: string; amount: number; currency: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'paid' };

/**
 * Paying an invoice WITHOUT leaving the business's page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Clicking Pay used to be a redirect, to `invoice.stripe.com` when the invoice
 * had a hosted URL and to `checkout.stripe.com` otherwise. The client finished
 * settling a bill on a page belonging to neither them nor the business.
 *
 * This mounts Stripe's Payment Element in place instead. The card fields are
 * still Stripe's own iframe — this component never sees a card number, and the
 * PCI position is unchanged — but everything around them is the business's.
 *
 * It asks the server for the invoice's EXISTING secret and confirms that. It
 * creates nothing: see the route for why stamping our metadata on an
 * invoice-backed intent would break how the payment gets recorded.
 *
 * WHEN IT RENDERS NOTHING
 *
 * The server answers `cannot_collect`, `not_billed_yet`, `already_paid` and
 * `no_secret` as ordinary states, not failures. In each of them this falls
 * back to whatever the page offers beside it — bank details, or an
 * explanation — rather than showing a broken card form. A bill a client cannot
 * act on is the fault the portal money guard exists to prevent.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function InvoicePaymentPanel({
  invoiceId,
  locale,
  isRTL,
  primaryColor,
  borderRadius,
  successUrl,
}: InvoicePaymentPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const t = (key: string) => publicT(locale, key);

  useEffect(() => {
    let live = true;

    fetch(`/api/public/invoice/${invoiceId}/intent`)
      .then(res => res.json())
      .then(data => {
        if (!live) return;
        if (data?.success) {
          setPhase({
            kind: 'ready',
            clientSecret: data.clientSecret,
            connectedAccountId: data.connectedAccountId,
            publishableKey: data.publishableKey,
            amount: data.amount,
            currency: data.currency,
          });
        } else if (data?.error === 'already_paid') {
          setPhase({ kind: 'paid' });
        } else {
          setPhase({ kind: 'unavailable', reason: String(data?.error ?? 'unknown') });
        }
      })
      .catch(() => {
        if (live) setPhase({ kind: 'unavailable', reason: 'network' });
      });

    return () => {
      live = false;
    };
  }, [invoiceId]);

  // Nothing to draw: the page's other payment options stand on their own.
  if (phase.kind === 'unavailable' || phase.kind === 'paid') return null;

  if (phase.kind === 'loading') {
    return (
      <div
        className="h-28 w-full animate-pulse"
        style={{ background: 'var(--ap-surface-2)', borderRadius: 'var(--ap-radius-md)' }}
        aria-label={t('loading')}
      />
    );
  }

  return (
    <div>
      <StripePaymentForm
        publishableKey={phase.publishableKey}
        clientSecret={phase.clientSecret}
        connectedAccountId={phase.connectedAccountId}
        amount={phase.amount}
        currency={phase.currency}
        primaryColor={primaryColor}
        locale={locale}
        isRTL={isRTL}
        borderRadius={borderRadius}
        onSuccess={() => {
          window.location.href = successUrl;
        }}
        /*
          Said out loud. The form renders no error of its own, so a refused
          card would otherwise look like a button that did nothing — on the one
          action here that moves real money.
        */
        onError={message => setError(message)}
      />

      {error && (
        <p
          className="mt-3 text-sm"
          style={{ color: 'var(--ap-danger)' }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
