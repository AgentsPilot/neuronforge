'use client';

import { useEffect, useState } from 'react';
import { CheckCircle } from 'lucide-react';

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
  /**
   * The invoice's signed access token.
   *
   * The intent endpoint applies the same rule as the invoice page: a signed
   * `?t=` naming this invoice, or a bare id only while the invoice is newer
   * than the token window. Both mounts hold one — the invoice page from its
   * own URL, the portal from `payment.invoiceToken` — so neither has to rely
   * on the invoice being young.
   */
  accessToken?: string | null;
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
  accessToken,
}: InvoicePaymentPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const t = (key: string) => publicT(locale, key);

  useEffect(() => {
    let live = true;

    fetch(
      `/api/public/invoice/${invoiceId}/intent${
        accessToken ? `?t=${encodeURIComponent(accessToken)}` : ''
      }`
    )
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
  }, [invoiceId, accessToken]);

  /*
    Nothing to draw. The page's other options stand on their own, and every
    reason here is a complete answer rather than a failure: the business takes
    no cards, the bill is not billable, or we could not reach Stripe.

    `not_billed_yet` is no longer one of them in practice — an invoice is
    raised at Stripe when the quote is accepted, so by the time a client can
    open this there is something to confirm.
  */
  if (phase.kind === 'unavailable') return null;

  if (phase.kind === 'paid') {
    /*
      ─────────────────────────────────────────────────────────────────────────
      SAID, BECAUSE SILENCE HERE IS WORSE THAN THE BILL.

      This returned null, on the reasoning that the page's other options stand
      on their own. They do not when the page is simultaneously showing an
      amount and a Pay button, which it does whenever our invoice row says
      `overdue` and the processor says settled — ten invoices on this database
      are in exactly that state, and the client sees a demand for money they
      have already handed over.

      Stripe's answer is the one that knows whether money moved, so it is said
      out loud, and it points at the business rather than asserting our own
      record — our record is the one that may be wrong.
      ─────────────────────────────────────────────────────────────────────────
    */
    return (
      <div
        className="flex items-start gap-3 p-4"
        style={{
          background: 'var(--ap-surface)',
          border: '1px solid var(--ap-border)',
          borderRadius: 'var(--ap-radius-md)',
        }}
        role="status"
      >
        <CheckCircle
          className="mt-0.5 h-5 w-5 shrink-0"
          style={{ color: '#15803D' }}
          aria-hidden
        />
        <p className="text-sm" style={{ color: 'var(--ap-text)' }}>
          {t('payAlreadySettled')}
        </p>
      </div>
    );
  }

  if (phase.kind === 'loading') {
    /*
      ─────────────────────────────────────────────────────────────────────────
      SAID, NOT MIMED.

      This was a bare `animate-pulse` box filled with `--ap-surface-2`, which
      `PublicThemeStyle` sets to the brand's own `surface`. On a pale brand
      that is near-white on a near-white ground: an invisible rectangle, with
      the label only in `aria-label` where a sighted client never sees it.

      So the gap between paint and the secret arriving — under a second in
      production, far longer on a cold route — read as "this business does not
      take cards", directly above the bank details that are the fallback. It
      was reported as exactly that: "payment option is not available".

      A visible border, a real background and the words. Whatever the wait is,
      it now says what it is waiting for.
      ─────────────────────────────────────────────────────────────────────────
    */
    return (
      <div
        className="flex h-28 w-full items-center justify-center gap-3 px-4"
        style={{
          background: 'var(--ap-surface)',
          border: '1px solid var(--ap-border)',
          borderRadius: 'var(--ap-radius-md)',
        }}
        role="status"
      >
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          style={{ color: 'var(--ap-brand)' }}
          aria-hidden
        />
        <span className="text-sm" style={{ color: 'var(--ap-text-muted)' }}>
          {t('payByCardLoading')}
        </span>
      </div>
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
