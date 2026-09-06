/**
 * What the money actions actually do, defined once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The reports list and the CRM drawer both act on the same invoices, and they
 * had their own copies of these callbacks. Both copies carried the same two
 * defects — voiding with `PATCH` against a route that exports only GET/PUT/
 * DELETE, and reading `data.url` from an endpoint that returns `payment_url` —
 * because the second was written from the first.
 *
 * That is the argument for this file. The callbacks are small; the cost was
 * never their length, it was that a fix applied to one surface silently left the
 * other broken, and neither failure was visible: the action menu showed a
 * success tick either way.
 *
 * Each surface still supplies its own `refresh`, because what needs reloading
 * after a void differs between a page and a drawer.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/entryActions
 */

import type { MoneyEntry } from './moneyItems';

export interface EntryActionOptions {
  /** Called after any action that changes what a row should say. */
  refresh: () => Promise<void> | void;
  /** Translation lookup, for the confirm prompt and error text. */
  t: (key: string) => string;
  /** Opens the refund dialog. Refunds are never fired straight from a menu. */
  onRefund: (entry: MoneyEntry) => void;
}

/** POST/PUT against one invoice, refreshing afterwards. */
async function invoiceAction(
  entry: MoneyEntry,
  path: string,
  init: RequestInit | undefined,
  refresh: () => Promise<void> | void
) {
  if (!entry.invoiceId) return;

  const response = await fetch(`/api/payments/invoices/${entry.invoiceId}${path}`, init);
  const result = await response.json().catch(() => ({ success: response.ok }));

  if (!response.ok || result.success === false) {
    throw new Error(result.error || 'Action failed');
  }

  await refresh();
  return result;
}

export function buildEntryActions({ refresh, t, onRefund }: EntryActionOptions) {
  return {
    onSend: (entry: MoneyEntry) => invoiceAction(entry, '/send', { method: 'POST' }, refresh),
    onResend: (entry: MoneyEntry) => invoiceAction(entry, '/send', { method: 'POST' }, refresh),

    onCopyLink: async (entry: MoneyEntry) => {
      // The hosted URL when the row already holds it — no round trip to learn
      // something already on screen.
      if (entry.stripeHostedUrl) {
        await navigator.clipboard.writeText(entry.stripeHostedUrl);
        return;
      }
      if (!entry.invoiceId) return;

      const response = await fetch(`/api/payments/invoices/${entry.invoiceId}/payment-link`);
      const result = await response.json();

      // `payment_url`, not `url`. Reading the wrong key put nothing on the
      // clipboard while the menu still reported success — the worst shape a
      // failure can take, because the user pastes an old link and never knows.
      const link = result?.data?.payment_url;
      if (!link) throw new Error(t('payments.link_failed') || 'Could not get a payment link');

      await navigator.clipboard.writeText(link);
    },

    onDownloadPdf: async (entry: MoneyEntry) => {
      // Opened rather than fetched: the route streams a file, and letting the
      // browser take it avoids holding a PDF in memory only to re-offer it.
      if (entry.invoiceId) window.open(`/api/payments/invoices/${entry.invoiceId}/pdf`, '_blank');
    },

    onViewInStripe: (entry: MoneyEntry) => {
      if (entry.stripeHostedUrl) window.open(entry.stripeHostedUrl, '_blank');
    },

    onVoid: async (entry: MoneyEntry) => {
      // `void_title` is the question; `void_confirm` is the button label on the
      // app's own dialog. Using the button text as the prompt would ask
      // "Void invoice" as though it were a question.
      if (!window.confirm(t('payments.void_title') || 'Void this invoice?')) return;

      await invoiceAction(
        entry,
        '',
        {
          // PUT, not PATCH. The route exports GET/PUT/DELETE, so every PATCH
          // returned 405 — and the menu ticked anyway, so voiding has never
          // once worked from either surface.
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' }),
        },
        refresh
      );
    },

    onMarkPaid: (entry: MoneyEntry) =>
      // Through mark-paid rather than a status edit: recording payment must also
      // record the PAYMENT, or the money is invisible to revenue and can never
      // be refunded.
      invoiceAction(
        entry,
        '/mark-paid',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_method: 'bank_transfer' }),
        },
        refresh
      ),

    onRefund,
  };
}
